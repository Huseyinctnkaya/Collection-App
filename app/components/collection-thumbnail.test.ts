import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pickColor, initial, TILE_COLORS } from "./collection-thumbnail.logic.ts";

describe("initial", () => {
  test("uses the first letter of the title", () => {
    assert.equal(initial("UFC"), "U");
    assert.equal(initial("Star Trek"), "S");
  });

  test("uses a digit when the title starts with one", () => {
    // "50c" rendered nothing when only letters were considered.
    assert.equal(initial("50c"), "5");
  });

  test("skips leading punctuation and whitespace", () => {
    assert.equal(initial("  — Summer Sale"), "S");
  });

  test("handles non-latin titles", () => {
    assert.equal(initial("Çocuk"), "Ç");
    assert.equal(initial("日本"), "日");
  });

  test("falls back rather than rendering an empty tile", () => {
    assert.equal(initial("!!!"), "?");
    assert.equal(initial(""), "?");
  });
});

describe("pickColor", () => {
  test("always returns a colour from the palette", () => {
    for (const seed of ["ufc", "50-cent", "star-trek", "", "ß", "a".repeat(500)]) {
      assert.ok(TILE_COLORS.includes(pickColor(seed)), `${seed} produced ${pickColor(seed)}`);
    }
  });

  test("is stable for the same handle", () => {
    // The tile must not change colour between renders or between servers.
    assert.equal(pickColor("summer-sale"), pickColor("summer-sale"));
  });

  test("spreads different handles across the palette", () => {
    const handles = Array.from({ length: 60 }, (_, i) => `collection-${i}`);
    const used = new Set(handles.map(pickColor));
    assert.ok(used.size >= TILE_COLORS.length - 1, `only used ${used.size} colours`);
  });
});
