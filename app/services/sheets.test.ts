import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseGoogleSheetsUrl } from "./sheets.logic.ts";

describe("parseGoogleSheetsUrl", () => {
  test("reads the id and gid from a normal sheet URL", () => {
    assert.deepEqual(
      parseGoogleSheetsUrl("https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=456"),
      { sheetId: "1AbC-dEf_123", gid: "456" }
    );
  });

  test("defaults to the first tab when there is no gid", () => {
    assert.deepEqual(
      parseGoogleSheetsUrl("https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit"),
      { sheetId: "1AbC-dEf_123", gid: "0" }
    );
  });

  test("reads a gid given as a query parameter", () => {
    // Sheets uses ?gid= on some share links and #gid= on others.
    assert.equal(
      parseGoogleSheetsUrl("https://docs.google.com/spreadsheets/d/XYZ/edit?gid=789")?.gid,
      "789"
    );
  });

  test("handles a /copy or /view link", () => {
    assert.equal(
      parseGoogleSheetsUrl("https://docs.google.com/spreadsheets/d/XYZ/copy")?.sheetId,
      "XYZ"
    );
  });

  test("handles a link already pointing at the CSV export", () => {
    const parsed = parseGoogleSheetsUrl(
      "https://docs.google.com/spreadsheets/d/XYZ/export?format=csv&gid=12"
    );
    assert.deepEqual(parsed, { sheetId: "XYZ", gid: "12" });
  });

  test("rejects anything that is not a sheets URL", () => {
    assert.equal(parseGoogleSheetsUrl("https://example.com/foo"), null);
    assert.equal(parseGoogleSheetsUrl("not a url"), null);
    assert.equal(parseGoogleSheetsUrl(""), null);
  });

  test("rejects a Google Docs or Slides link", () => {
    // Easy mistake to make, and the error should say so rather than 404 later.
    assert.equal(parseGoogleSheetsUrl("https://docs.google.com/document/d/XYZ/edit"), null);
  });
});
