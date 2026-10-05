// Run with: npm test  (node:test + native TS type stripping, no extra deps)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  handleize,
  buildExistingIndex,
  matchExisting,
  buildCollectionInput,
  planImport,
  readCollectionLookup,
  handleSearchQuery,
  rowLookupHandle,
  chunk,
  type ExistingCollection,
} from "./import-plan.server.ts";
import type { CollectionRow } from "./parser.server";

function row(overrides: Partial<CollectionRow> = {}): CollectionRow {
  return {
    title: "Summer Sale",
    sort_order: "manual",
    published: true,
    ...overrides,
  } as CollectionRow;
}

const existing = (over: Partial<ExistingCollection> = {}): ExistingCollection => ({
  id: "gid://shopify/Collection/1",
  handle: "summer-sale",
  title: "Summer Sale",
  ...over,
});

describe("handleize", () => {
  test("matches Shopify for titles the old regex mangled", () => {
    // The old code deleted punctuation instead of replacing it, producing
    // "salt--pepper" and missing the real collection.
    assert.equal(handleize("Salt & Pepper"), "salt-pepper");
    assert.equal(handleize("Shoes / Boots"), "shoes-boots");
    assert.equal(handleize("Sale!!!"), "sale");
  });

  test("normalizes a merchant-supplied handle", () => {
    assert.equal(handleize("  Summer-Sale  "), "summer-sale");
    assert.equal(handleize("Summer Sale"), "summer-sale");
    assert.equal(handleize("summer-sale"), "summer-sale");
  });
});

describe("matchExisting", () => {
  test("matches on an explicit handle regardless of casing/spacing", () => {
    const index = buildExistingIndex([existing()]);
    const result = matchExisting(row({ handle: " Summer Sale " }), index);
    assert.deepEqual(result, { kind: "existing", collection: existing() });
  });

  test("matches on title when the sheet has no handle column", () => {
    // The reported bug: metafield-only sheets carry title + metafield columns,
    // so existence has to be resolved without a handle.
    const index = buildExistingIndex([existing({ handle: "summer-sale-2024" })]);
    const result = matchExisting(row({ title: "summer sale" }), index);
    assert.equal(result.kind, "existing");
  });

  test("reports ambiguity instead of silently creating a duplicate", () => {
    const index = buildExistingIndex([
      existing({ id: "gid://shopify/Collection/1", handle: "sale-a" }),
      existing({ id: "gid://shopify/Collection/2", handle: "sale-b" }),
    ]);
    assert.deepEqual(matchExisting(row(), index), { kind: "ambiguous", count: 2 });
  });

  test("an explicit handle that does not exist is a new collection", () => {
    const index = buildExistingIndex([existing()]);
    assert.deepEqual(matchExisting(row({ handle: "brand-new" }), index), { kind: "new" });
  });
});

describe("buildCollectionInput", () => {
  test("sends the normalized handle so lookup and create agree", () => {
    const input = buildCollectionInput(row({ handle: "Summer Sale" }), []);
    assert.equal(input.handle, "summer-sale");
  });

  test("omits handle entirely when the sheet has none, so updates never rename", () => {
    const input = buildCollectionInput(row(), []);
    assert.equal("handle" in input, false);
  });

  test("carries metafields inline (bulk operations cannot call metafieldsSet)", () => {
    const input = buildCollectionInput(row(), [
      { namespace: "custom", key: "subtitle", type: "single_line_text_field", value: "Hot" },
    ]);
    assert.deepEqual(input.metafields, [
      { namespace: "custom", key: "subtitle", type: "single_line_text_field", value: "Hot" },
    ]);
  });

  test("replaces every hyphen in sortOrder, not just the first", () => {
    assert.equal(buildCollectionInput(row({ sort_order: "created-desc" }), []).sortOrder, "CREATED_DESC");
  });

  describe("update mode only touches columns the sheet actually has", () => {
    // A metafield-only sheet carries title + metafield columns. Sending the
    // zod defaults ("" description, MANUAL sort order) would wipe live data.
    const columns = new Set(["title", "metafield.custom.subtitle"]);

    test("omits description when there is no description column", () => {
      const input = buildCollectionInput(row(), [], { mode: "update", columns });
      assert.equal("descriptionHtml" in input, false);
    });

    test("omits sortOrder when there is no sort_order column", () => {
      const input = buildCollectionInput(row(), [], { mode: "update", columns });
      assert.equal("sortOrder" in input, false);
    });

    test("clears description when the column exists but the cell is empty", () => {
      const input = buildCollectionInput(row({ description: "" }), [], {
        mode: "update",
        columns: new Set(["title", "description"]),
      });
      assert.equal(input.descriptionHtml, "");
    });

    test("still writes the columns the sheet does have", () => {
      const input = buildCollectionInput(row({ description: "<p>Hi</p>" }), [], {
        mode: "update",
        columns: new Set(["title", "description"]),
      });
      assert.equal(input.descriptionHtml, "<p>Hi</p>");
    });

    test("create mode keeps the defaults", () => {
      const input = buildCollectionInput(row(), [], { mode: "create", columns });
      assert.equal(input.descriptionHtml, "");
      assert.equal(input.sortOrder, "MANUAL");
    });
  });
});

describe("planImport", () => {
  const metafields = [
    { namespace: "custom", key: "subtitle", type: "single_line_text_field", value: "Hot" },
  ];
  const columns = new Set(["title", "handle", "description", "sort_order"]);

  test("overwrite mode updates an existing collection instead of creating it", () => {
    // This is the customer-reported regression: "handle already taken" even
    // though update-existing was selected.
    const plan = planImport({
      rows: [{ row: 2, data: row(), metafields }],
      index: buildExistingIndex([existing()]),
      duplicateStrategy: "overwrite",
      columns,
    });

    assert.equal(plan.creates.length, 0);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].input.id, "gid://shopify/Collection/1");
    assert.deepEqual(plan.updates[0].input.metafields, metafields);
  });

  test("skip mode skips existing rows but still creates new ones", () => {
    const plan = planImport({
      rows: [
        { row: 2, data: row(), metafields: [] },
        { row: 3, data: row({ title: "Winter Sale" }), metafields: [] },
      ],
      index: buildExistingIndex([existing()]),
      duplicateStrategy: "skip",
      columns,
    });

    assert.deepEqual(plan.skipped.map((s) => s.row), [2]);
    assert.equal(plan.updates.length, 0);
    assert.deepEqual(plan.creates.map((c) => c.row), [3]);
  });

  test("ambiguous titles become row errors, never creates", () => {
    const plan = planImport({
      rows: [{ row: 7, data: row(), metafields: [] }],
      index: buildExistingIndex([
        existing({ id: "gid://shopify/Collection/1", handle: "a" }),
        existing({ id: "gid://shopify/Collection/2", handle: "b" }),
      ]),
      duplicateStrategy: "overwrite",
      columns,
    });

    assert.equal(plan.creates.length, 0);
    assert.equal(plan.updates.length, 0);
    assert.equal(plan.failed.length, 1);
    assert.equal(plan.failed[0].row, 7);
    assert.match(plan.failed[0].message, /2 collections/i);
  });

  test("keeps the spreadsheet row number for each JSONL line", () => {
    const plan = planImport({
      rows: [
        { row: 5, data: row({ title: "New A" }), metafields: [] },
        { row: 2, data: row(), metafields: [] },
        { row: 9, data: row({ title: "New B" }), metafields: [] },
      ],
      index: buildExistingIndex([existing()]),
      duplicateStrategy: "overwrite",
      columns,
    });

    // Each bulk operation gets its own 0-based line numbering, so the mapping
    // back to spreadsheet rows has to be per-operation.
    assert.deepEqual(plan.creates.map((c) => c.row), [5, 9]);
    assert.deepEqual(plan.updates.map((u) => u.row), [2]);
  });
});

describe("readCollectionLookup", () => {
  test("throws on a throttled response instead of reporting 'no collections'", () => {
    // The old code read payload.data?.collectionByHandle, so a THROTTLED
    // response (HTTP 200, data: null) looked exactly like "does not exist"
    // and the row fell through to collectionCreate.
    assert.throws(
      () =>
        readCollectionLookup({
          data: null,
          errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        }),
      /throttled/i
    );
  });

  test("throws on any other GraphQL error", () => {
    assert.throws(
      () => readCollectionLookup({ errors: [{ message: "Access denied" }] }),
      /Access denied/
    );
  });

  test("returns the collections for a healthy response", () => {
    const result = readCollectionLookup({
      data: { collections: { nodes: [existing()] } },
    });
    assert.deepEqual(result, [existing()]);
  });
});

describe("lookup query building", () => {
  test("builds a handle filter Shopify understands", () => {
    assert.equal(
      handleSearchQuery(["Summer Sale", "winter-sale"]),
      "handle:summer-sale OR handle:winter-sale"
    );
  });

  test("drops handles that handleize to nothing", () => {
    assert.equal(handleSearchQuery(["!!!", "sale"]), "handle:sale");
  });

  test("rowLookupHandle returns null when the row must match on title", () => {
    assert.equal(rowLookupHandle(row()), null);
    assert.equal(rowLookupHandle(row({ handle: "Summer Sale" })), "summer-sale");
  });

  test("chunk splits without dropping or duplicating", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});
