import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { COLLECTION_DELETE, COLLECTION_UPDATE } from "../graphql/mutations";

export async function rollbackJob(admin: AdminApiContext, jobId: string, shop: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, shop },
    include: { actions: true },
  });

  if (!job) throw new Error("Job not found");
  if (job.rolledBack) throw new Error("Already rolled back");
  if (!["COMPLETED", "PARTIAL"].includes(job.status)) {
    throw new Error("Only completed or partial imports can be rolled back");
  }

  const errors: string[] = [];

  for (const action of job.actions) {
    try {
      if (action.action === "created") {
        // Delete the collection that was created
        const res = await admin.graphql(COLLECTION_DELETE, {
          variables: { input: { id: action.collectionId } },
        });
        const { data } = await res.json();
        if (data?.collectionDelete?.userErrors?.length > 0) {
          errors.push(`${action.collectionHandle}: ${data.collectionDelete.userErrors[0].message}`);
        }
      } else if (action.action === "updated" && action.previousData) {
        // Restore the previous state
        const prev = JSON.parse(action.previousData) as Record<string, unknown>;
        const input: Record<string, unknown> = {
          id: action.collectionId,
          title: prev.title,
          descriptionHtml: prev.descriptionHtml ?? "",
          handle: prev.handle,
          sortOrder: prev.sortOrder,
          seo: prev.seo ?? undefined,
          image: (prev.image as { src?: string } | null)?.src
            ? { src: (prev.image as { src: string }).src }
            : undefined,
        };
        if (prev.ruleSet) input.ruleSet = prev.ruleSet;

        const res = await admin.graphql(COLLECTION_UPDATE, { variables: { input } });
        const { data } = await res.json();
        if (data?.collectionUpdate?.userErrors?.length > 0) {
          errors.push(`${action.collectionHandle}: ${data.collectionUpdate.userErrors[0].message}`);
        }
      }
    } catch (err) {
      errors.push(`${action.collectionHandle}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: { rolledBack: true },
  });

  return { rolledBack: job.actions.length, errors };
}
