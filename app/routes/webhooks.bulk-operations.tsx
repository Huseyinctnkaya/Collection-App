import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { notifyImportFinished } from "../services/notify.server";
import { recordBulkResults } from "../services/bulk-results.server";
import { startNextBulkPass } from "../services/importer.server";
import { BULK_OPERATION_BY_ID } from "../graphql/mutations";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  if (topic !== "BULK_OPERATIONS_FINISH") {
    return new Response("Unhandled topic", { status: 200 });
  }

  const { admin_graphql_api_id: bulkOpId, status } = payload as {
    admin_graphql_api_id: string;
    status: string;
  };

  // An import can run a collectionCreate pass and a collectionUpdate pass, so
  // the operation id — not the job — identifies which pass just finished.
  const operation = await prisma.bulkOperation.findFirst({
    where: { operationId: bulkOpId, job: { shop } },
    include: { job: true },
  });

  // Jobs started before multi-pass imports existed have no BulkOperation row,
  // so they are matched the old way. Without this, an import that is already
  // running when this version deploys would never be finalised.
  const legacyJob = operation
    ? null
    : await prisma.importJob.findFirst({ where: { shop, bulkOperationId: bulkOpId } });

  if (!operation && !legacyJob) return new Response("Operation not found", { status: 200 });

  const job = operation?.job ?? legacyJob!;
  const mutationName = operation?.mutation ?? "collectionCreate";
  const rowNumbers: number[] = operation ? (JSON.parse(operation.rowNumbers) as number[]) : [];
  let resultsRead = false;

  if (admin && status === "completed") {
    try {
      const opRes = await admin.graphql(BULK_OPERATION_BY_ID, { variables: { id: bulkOpId } });
      const opData = await opRes.json();
      const resultsUrl: string | null = opData?.data?.node?.url ?? null;

      if (resultsUrl) {
        // Each pass has its own JSONL, so results map back through that pass's
        // own row numbers.
        await recordBulkResults({
          jobId: job.id,
          resultsUrl,
          rowNumbers,
        });
        resultsRead = true;
      }
    } catch (err) {
      // Keep the job status accurate even if the results file is unavailable.
      console.error(`Failed to record bulk results for job ${job.id}:`, err);
    }
  }

  if (operation) {
    await prisma.bulkOperation.update({
      where: { id: operation.id },
      data: { status: "DONE" },
    });
  }

  if (status === "failed") {
    await prisma.importError.create({
      data: {
        jobId: job.id,
        row: 0,
        message: `Shopify reported the ${mutationName} pass as failed`,
      },
    });
    await prisma.importJob.update({
      where: { id: job.id },
      data: { errorCount: { increment: 1 } },
    });
  }

  // Passes run one at a time, so starting the next one is what keeps the job
  // moving. Only once nothing is left does the job get a final status.
  if (admin && status === "completed") {
    try {
      const startedNext = await startNextBulkPass(admin, job.id);
      if (startedNext) return new Response("OK", { status: 200 });
    } catch (err) {
      console.error(`Failed to start the next bulk pass for job ${job.id}:`, err);
      await prisma.importError.create({
        data: {
          jobId: job.id,
          row: 0,
          message: err instanceof Error ? err.message : "Could not start the next import pass",
        },
      });
      await prisma.importJob.update({
        where: { id: job.id },
        data: { errorCount: { increment: 1 } },
      });
    }
  }

  const pending = await prisma.bulkOperation.count({
    where: { jobId: job.id, status: { not: "DONE" } },
  });
  if (pending > 0) return new Response("OK", { status: 200 });

  // recordBulkResults incremented the counters, so read them back rather than
  // using this one pass's tally as the whole job's outcome.
  const counted = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });

  const finalStatus =
    status !== "completed" && !resultsRead && counted.successCount === 0
      ? "FAILED"
      : counted.errorCount === 0
        ? "COMPLETED"
        : counted.successCount > 0
          ? "PARTIAL"
          : "FAILED";

  const updatedJob = await prisma.importJob.update({
    where: { id: job.id },
    data: { status: finalStatus },
  });

  notifyImportFinished(shop, {
    id: updatedJob.id,
    fileName: updatedJob.fileName,
    status: finalStatus,
    successCount: updatedJob.successCount,
    errorCount: updatedJob.errorCount,
    totalRows: updatedJob.totalRows,
  }).catch(console.error);

  return new Response("OK", { status: 200 });
}
