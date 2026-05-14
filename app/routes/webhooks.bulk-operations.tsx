import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);

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

  const finalStatus =
    status === "completed" ? "COMPLETED" : status === "failed" ? "FAILED" : "PARTIAL";

  await prisma.importJob.update({
    where: { id: job.id },
    data: { status: finalStatus },
  });

  return new Response("OK", { status: 200 });
}
