import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  composeTarget,
  normalizeLocale,
  validateTarget,
  CORE_FIELDS,
  METAFIELD_TYPES,
} from "./template-target.ts";

describe("composeTarget", () => {
  test("an ignored column maps to nothing", () => {
    assert.equal(composeTarget({ kind: "ignore" }), "");
  });

  test("a core field maps to itself", () => {
    assert.equal(composeTarget({ kind: "core", field: "title" }), "title");
  });

  test("builds a translation header", () => {
    assert.equal(
      composeTarget({ kind: "translation", field: "description", locale: "fr" }),
      "description_fr"
    );
  });

  test("builds a metafield header with its type", () => {
    assert.equal(
      composeTarget({
        kind: "metafield",
        namespace: "custom",
        key: "care_instructions",
        type: "multi_line_text_field",
      }),
      "metafield.custom.care_instructions.multi_line_text_field"
    );
  });

  test("lower-cases namespace and key, because headers are matched lower-cased", () => {
    assert.equal(
      composeTarget({ kind: "metafield", namespace: "Custom", key: "Season", type: "date" }),
      "metafield.custom.season.date"
    );
  });

  test("a half-filled mapping produces nothing rather than a broken header", () => {
    assert.equal(composeTarget({ kind: "metafield", namespace: "custom", key: "", type: "date" }), "");
    assert.equal(composeTarget({ kind: "translation", field: "title", locale: "  " }), "");
  });
});

describe("normalizeLocale", () => {
  test("keeps the region upper-case, as the translation extractor requires", () => {
    assert.equal(normalizeLocale("pt-br"), "pt-BR");
    assert.equal(normalizeLocale("PT-BR"), "pt-BR");
    assert.equal(normalizeLocale("FR"), "fr");
  });
});

describe("validateTarget", () => {
  test("accepts every core field", () => {
    for (const field of CORE_FIELDS) assert.equal(validateTarget(field), null, field);
  });

  test("accepts an empty target as 'ignore this column'", () => {
    assert.equal(validateTarget(""), null);
  });

  test("accepts translations for the fields Shopify can translate", () => {
    assert.equal(validateTarget("title_fr"), null);
    assert.equal(validateTarget("seo_description_de"), null);
    assert.equal(validateTarget("description_pt-BR"), null);
  });

  test("accepts every metafield type the editor offers", () => {
    for (const type of METAFIELD_TYPES) {
      assert.equal(validateTarget(`metafield.custom.field_x.${type}`), null, type);
    }
  });

  test("accepts a metafield without an explicit type", () => {
    assert.equal(validateTarget("metafield.custom.subtitle"), null);
  });

  test("rejects a malformed metafield and says why", () => {
    // Namespace too short, and the merchant needs to know which part is wrong.
    assert.match(validateTarget("metafield.c.key") ?? "", /namespace of 3-255/);
    assert.match(validateTarget("metafield.custom") ?? "", /metafield\.namespace\.key\.type/);
    assert.match(validateTarget("metafield.custom.A b") ?? "", /not a valid metafield/);
  });

  test("rejects a bad locale with a translation-specific message", () => {
    assert.match(validateTarget("title_french") ?? "", /locale must look like/);
    assert.match(validateTarget("title_pt-br") ?? "", /locale must look like/);
  });

  test("rejects an unknown field", () => {
    assert.match(validateTarget("supplier_sku") ?? "", /not a field this importer knows/);
  });

  test("round-trips everything the editor can compose", () => {
    const mappings = [
      { kind: "core", field: "handle" },
      { kind: "translation", field: "title", locale: "de" },
      { kind: "metafield", namespace: "custom", key: "season", type: "list.single_line_text_field" },
    ] as const;

    for (const mapping of mappings) {
      const target = composeTarget(mapping);
      assert.equal(validateTarget(target), null, target);
    }
  });
});
