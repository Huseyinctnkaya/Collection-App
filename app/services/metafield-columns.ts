/**
 * Reading metafield values out of a parsed spreadsheet row.
 *
 * Column shape: metafield.<namespace>.<key>[.<type>], e.g.
 * `metafield.custom.care_instructions.multi_line_text_field`.
 *
 * Pure module: unit tested with bare `node --test`.
 */

export interface MetafieldColumn {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

const DEFAULT_TYPE = "single_line_text_field";

export function extractMetafields(rawRow: Record<string, string>): MetafieldColumn[] {
  const result: MetafieldColumn[] = [];

  for (const [col, value] of Object.entries(rawRow)) {
    if (!col.startsWith("metafield.") || !value) continue;

    const parts = col.split(".");
    if (parts.length < 3) continue;

    const [, namespace, key] = parts;
    if (!namespace || !key) continue;

    // Everything after the key is the type. Shopify's list types contain a dot
    // of their own ("list.single_line_text_field"), so taking only the next
    // segment would send the type as "list" and the import would be rejected.
    const type = parts.slice(3).join(".") || DEFAULT_TYPE;

    result.push({ namespace, key, type, value });
  }

  return result;
}
