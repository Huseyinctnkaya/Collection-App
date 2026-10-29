import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { extractMetafields } from "./metafield-columns.ts";

describe("extractMetafields", () => {
  test("reads namespace, key and type from the column name", () => {
    assert.deepEqual(
      extractMetafields({ "metafield.custom.care.multi_line_text_field": "Hand wash" }),
      [{ namespace: "custom", key: "care", type: "multi_line_text_field", value: "Hand wash" }]
    );
  });

  test("keeps a dotted list type whole", () => {
    // Shopify's list types contain a dot. Taking only the segment after the
    // key sent the type as "list" and Shopify rejected the metafield.
    assert.deepEqual(
      extractMetafields({ "metafield.custom.tags.list.single_line_text_field": '["a","b"]' }),
      [
        {
          namespace: "custom",
          key: "tags",
          type: "list.single_line_text_field",
          value: '["a","b"]',
        },
      ]
    );
  });

  test("defaults the type when the column does not give one", () => {
    assert.equal(extractMetafields({ "metafield.custom.subtitle": "Hot" })[0].type, "single_line_text_field");
  });

  test("ignores non-metafield columns and empty cells", () => {
    assert.deepEqual(
      extractMetafields({
        title: "Summer",
        "metafield.custom.subtitle": "",
        "metafield.custom.season": "summer",
      }),
      [{ namespace: "custom", key: "season", type: "single_line_text_field", value: "summer" }]
    );
  });

  test("ignores a column that is missing a key", () => {
    assert.deepEqual(extractMetafields({ "metafield.custom": "x", "metafield..key": "y" }), []);
  });

  test("reads every metafield column on the row", () => {
    const found = extractMetafields({
      title: "Summer",
      "metafield.custom.a": "1",
      "metafield.other.b.number_integer": "2",
    });
    assert.deepEqual(found.map((m) => `${m.namespace}.${m.key}:${m.type}`), [
      "custom.a:single_line_text_field",
      "other.b:number_integer",
    ]);
  });
});
