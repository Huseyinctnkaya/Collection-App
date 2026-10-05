import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseBulkResults } from "./bulk-results.parse.ts";

const createLine = (lineNumber: number, id: string, handle: string) =>
  JSON.stringify({
    data: { collectionCreate: { collection: { id, handle }, userErrors: [] } },
    __lineNumber: lineNumber,
  });

const updateLine = (lineNumber: number, id: string) =>
  JSON.stringify({
    data: { collectionUpdate: { collection: { id, handle: "summer-sale" }, userErrors: [] } },
    __lineNumber: lineNumber,
  });

const errorLine = (lineNumber: number, message: string) =>
  JSON.stringify({
    data: { collectionCreate: { collection: null, userErrors: [{ field: ["handle"], message }] } },
    __lineNumber: lineNumber,
  });

describe("parseBulkResults", () => {
  test("counts a collectionUpdate pass as success", () => {
    // The old parser only knew collectionCreate, so every row of an update
    // pass would have been reported as "no collection and no error".
    const { tally, created, failed } = parseBulkResults(
      [updateLine(0, "gid://shopify/Collection/1"), updateLine(1, "gid://shopify/Collection/2")].join("\n"),
      [4, 9]
    );

    assert.deepEqual(tally, { successCount: 2, errorCount: 0, processedRows: 2 });
    assert.deepEqual(created, []);
    assert.deepEqual(failed, []);
  });

  test("records created collections so rollback can delete them", () => {
    const { created } = parseBulkResults(createLine(0, "gid://shopify/Collection/7", "winter"), [12]);
    assert.deepEqual(created, [{ row: 12, id: "gid://shopify/Collection/7", handle: "winter" }]);
  });

  test("maps line numbers back to this pass's spreadsheet rows", () => {
    // Each pass has its own JSONL numbering, so the mapping is per-operation.
    const { failed } = parseBulkResults(errorLine(1, "handle has already been taken"), [4, 9]);
    assert.deepEqual(failed, [{ row: 9, message: "handle has already been taken" }]);
  });

  test("falls back to line order when the mapping is missing", () => {
    const { failed } = parseBulkResults(errorLine(0, "boom"), []);
    assert.equal(failed[0].row, 2);
  });

  test("counts a line with neither collection nor error as failed", () => {
    const line = JSON.stringify({ data: { collectionUpdate: {} }, __lineNumber: 0 });
    const { tally, failed } = parseBulkResults(line, [3]);
    assert.equal(tally.errorCount, 1);
    assert.match(failed[0].message, /no collection and no error/);
  });

  test("skips blank lines and survives malformed ones", () => {
    const { tally } = parseBulkResults(`${createLine(0, "gid://1", "a")}\n\nnot json\n`, [2, 3]);
    assert.equal(tally.successCount, 1);
    assert.equal(tally.errorCount, 1);
  });
});
