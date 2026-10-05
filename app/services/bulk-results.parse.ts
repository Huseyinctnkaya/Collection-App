/**
 * Pure parsing of the results JSONL that a bulk operation produces.
 *
 * No runtime imports, so this is unit tested with bare `node --test`.
 */

/**
 * One line of the results JSONL. The key under `data` is whichever mutation the
 * operation ran, so an import that updates existing collections produces
 * `collectionUpdate` lines and one that creates them produces
 * `collectionCreate` lines.
 */
interface BulkResultLine {
  data?: Record<
    string,
    {
      collection?: { id: string; title?: string; handle?: string } | null;
      userErrors?: Array<{ field?: string[]; message: string }>;
    }
  > | null;
  __lineNumber?: number;
}

export interface BulkTally {
  successCount: number;
  errorCount: number;
  processedRows: number;
}

export interface BulkResults {
  tally: BulkTally;
  /** Successful rows of a collectionCreate pass, recorded so rollback can delete them. */
  created: Array<{ row: number; id: string; handle: string }>;
  failed: Array<{ row: number; message: string }>;
}

/**
 * @param rowNumbers Spreadsheet row numbers indexed by JSONL line number. Each
 * pass of an import has its own JSONL and therefore its own numbering, so this
 * has to be the mapping for *this* operation.
 */
export function parseBulkResults(jsonl: string, rowNumbers: number[]): BulkResults {
  const created: BulkResults["created"] = [];
  const failed: BulkResults["failed"] = [];
  let updated = 0;

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
    const row = rowNumbers[lineNumber] ?? lineNumber + 2;

    const entries = Object.entries(parsed.data ?? {});
    const [mutation, result] = entries[0] ?? [];

    if (!result) {
      failed.push({ row, message: "Shopify returned no result for this row" });
      continue;
    }

    const userErrors = result.userErrors ?? [];
    if (userErrors.length > 0) {
      failed.push({ row, message: userErrors.map((e) => e.message).join("; ") });
      continue;
    }

    if (!result.collection?.id) {
      failed.push({ row, message: "Shopify returned no collection and no error" });
      continue;
    }

    if (mutation === "collectionCreate") {
      created.push({ row, id: result.collection.id, handle: result.collection.handle ?? "" });
    } else {
      updated++;
    }
  }

  const successCount = created.length + updated;

  return {
    tally: {
      successCount,
      errorCount: failed.length,
      processedRows: successCount + failed.length,
    },
    created,
    failed,
  };
}
