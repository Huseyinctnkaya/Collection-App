import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { notifyImportFinished } from "../services/notify.server";
import { recordBulkResults } from "../services/bulk-results.server";
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

  const job = await prisma.importJob.findFirst({
    where: { shop, bulkOperationId: bulkOpId },
  });

  if (!job) return new Response("Job not found", { status: 200 });

  // The webhook payload carries no per-row outcome, so the counters stay at 0
  // unless we download the results file Shopify produced for this operation.
  let tally = { successCount: 0, errorCount: 0, processedRows: 0 };
  let resultsRead = false;

  if (admin && status === "completed") {
    try {
      const opRes = await admin.graphql(BULK_OPERATION_BY_ID, { variables: { id: bulkOpId } });
      const opData = await opRes.json();
      const resultsUrl: string | null = opData?.data?.node?.url ?? null;

      if (resultsUrl) {
        tally = await recordBulkResults({
          jobId: job.id,
          resultsUrl,
          validRowNumbers: [],
        });
        resultsRead = true;
      }
    } catch (err) {
      // Keep the job status accurate even if the results file is unavailable.
      console.error(`Failed to record bulk results for job ${job.id}:`, err);
    }
  }

  const finalStatus =
    status === "failed"
      ? "FAILED"
      : status !== "completed"
        ? "PARTIAL"
        : !resultsRead
          ? "COMPLETED"
          : tally.errorCount === 0
            ? "COMPLETED"
            : tally.successCount > 0
              ? "PARTIAL"
              : "FAILED";

  const updatedJob = await prisma.importJob.update({
    where: { id: job.id },
    data: resultsRead
      ? {
          status: finalStatus,
          processedRows: tally.processedRows,
          successCount: tally.successCount,
          errorCount: tally.errorCount,
        }
      : { status: finalStatus },
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
