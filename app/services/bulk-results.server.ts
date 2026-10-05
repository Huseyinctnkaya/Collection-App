import prisma from "../db.server";
import { parseBulkResults, type BulkTally } from "./bulk-results.parse";

export { parseBulkResults, type BulkTally };

/**
 * Download one bulk operation's results file and persist its outcomes.
 *
 * Counters are incremented rather than overwritten, because an import can run
 * two passes (collectionCreate for new rows, collectionUpdate for existing
 * ones) and each pass reports through its own webhook.
 */
export async function recordBulkResults({
  jobId,
  resultsUrl,
  rowNumbers,
}: {
  jobId: string;
  resultsUrl: string;
  rowNumbers: number[];
}): Promise<BulkTally> {
  const res = await fetch(resultsUrl);
  if (!res.ok) throw new Error(`Failed to download bulk results: ${res.status} ${res.statusText}`);

  const { tally, created, failed } = parseBulkResults(await res.text(), rowNumbers);

  if (created.length > 0) {
    // Recorded so rollback can delete what this job created. Updates are
    // snapshotted before the pass runs, while their previous state still
    // exists, so they are not recorded here.
    await prisma.importAction.createMany({
      data: created.map((c) => ({
        jobId,
        collectionId: c.id,
        collectionHandle: c.handle,
        action: "created",
      })),
    });
  }

  if (failed.length > 0) {
    await prisma.importError.createMany({
      data: failed.map((f) => ({ jobId, row: f.row, message: f.message })),
    });
  }

  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      processedRows: { increment: tally.processedRows },
      successCount: { increment: tally.successCount },
      errorCount: { increment: tally.errorCount },
    },
  });

  return tally;
}
