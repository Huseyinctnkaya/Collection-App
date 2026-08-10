import prisma from "../db.server";

// One line of the results JSONL produced by bulkOperationRunMutation.
// Shape: {"data":{"collectionCreate":{"collection":{...},"userErrors":[]}},"__lineNumber":0}
interface BulkResultLine {
  data?: {
    collectionCreate?: {
      collection?: { id: string; title?: string; handle?: string } | null;
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  __lineNumber?: number;
}

export interface BulkTally {
  successCount: number;
  errorCount: number;
  processedRows: number;
}

/**
 * Parse the results JSONL and record per-row outcomes.
 *
 * The bulk path previously recorded nothing, which left every job showing
 * 0 processed / 0 success / 0 errors and made rollback a no-op because it
 * iterates over ImportAction rows.
 *
 * `__lineNumber` is a 0-based index into the JSONL we uploaded, which was
 * built from the valid rows only. `validRowNumbers` maps it back to the
 * original spreadsheet row so reported errors point at the right line.
 */
export function parseBulkResults(
  jsonl: string,
  validRowNumbers: number[]
): { tally: BulkTally; created: Array<{ row: number; id: string; handle: string }>; failed: Array<{ row: number; message: string }> } {
  const created: Array<{ row: number; id: string; handle: string }> = [];
  const failed: Array<{ row: number; message: string }> = [];

  for (const raw of jsonl.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    let parsed: BulkResultLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A malformed line still represents a row we could not confirm.
      failed.push({ row: 0, message: "Unreadable result line from Shopify" });
      continue;
    }

    const lineNumber = parsed.__lineNumber ?? -1;
    const row = validRowNumbers[lineNumber] ?? lineNumber + 2;

    const result = parsed.data?.collectionCreate;
    const userErrors = result?.userErrors ?? [];

    if (userErrors.length > 0) {
      failed.push({ row, message: userErrors.map((e) => e.message).join("; ") });
    } else if (result?.collection?.id) {
      created.push({ row, id: result.collection.id, handle: result.collection.handle ?? "" });
    } else {
      failed.push({ row, message: "Shopify returned no collection and no error" });
    }
  }

  return {
    tally: {
      successCount: created.length,
      errorCount: failed.length,
      processedRows: created.length + failed.length,
    },
    created,
    failed,
  };
}

/** Download the results file and persist counts, errors and rollback actions. */
export async function recordBulkResults({
  jobId,
  resultsUrl,
  validRowNumbers,
}: {
  jobId: string;
  resultsUrl: string;
  validRowNumbers: number[];
}): Promise<BulkTally> {
  const res = await fetch(resultsUrl);
  if (!res.ok) throw new Error(`Failed to download bulk results: ${res.status} ${res.statusText}`);

  const { tally, created, failed } = parseBulkResults(await res.text(), validRowNumbers);

  if (created.length > 0) {
    // Recorded so rollback can delete what this job created.
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

  return tally;
}
