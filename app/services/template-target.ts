/**
 * What a spreadsheet column can be mapped to in an import template.
 *
 * A template rewrites header names at parse time, so a mapping target is just
 * the header the importer would have wanted to see. That means metafield and
 * translation columns need no new plumbing — they only need to be expressible
 * here, which until now they were not.
 *
 * Pure module: unit tested with bare `node --test`.
 */

/** Columns the collection importer reads directly. */
export const CORE_FIELDS = [
  "title",
  "handle",
  "description",
  "image_url",
  "sort_order",
  "products",
  "rules",
  "seo_title",
  "seo_description",
  "published",
] as const;

/** The fields Shopify lets us translate on a collection. */
export const TRANSLATABLE_FIELDS = ["title", "description", "seo_title", "seo_description"] as const;

/**
 * Metafield types offered in the template editor. Reference types (which need
 * resource GIDs) are left out — they are not something a merchant pastes into
 * a spreadsheet cell.
 */
export const METAFIELD_TYPES = [
  "single_line_text_field",
  "multi_line_text_field",
  "number_integer",
  "number_decimal",
  "boolean",
  "date",
  "date_time",
  "url",
  "color",
  "rating",
  "money",
  "json",
  "list.single_line_text_field",
] as const;

export type ColumnMapping =
  | { kind: "ignore" }
  | { kind: "core"; field: string }
  | { kind: "translation"; field: string; locale: string }
  | { kind: "metafield"; namespace: string; key: string; type: string };

// Locale regions are upper-case ("pt-BR"); the translation extractor matches
// on that exact shape, so the target has to preserve it.
const TRANSLATION_TARGET = /^(title|description|seo_title|seo_description)_([a-z]{2}(?:-[A-Z]{2})?)$/;

// Shopify: namespace 3-255 characters, key 2-64, both alphanumeric plus
// hyphen and underscore. The type may itself contain a dot ("list.…").
const METAFIELD_TARGET = /^metafield\.([a-z0-9_-]{3,255})\.([a-z0-9_-]{2,64})(?:\.([a-z0-9_]+(?:\.[a-z0-9_]+)?))?$/;

/**
 * Turn an editor mapping into the header the importer should see.
 * Returns "" for a column that is ignored or not filled in yet.
 */
export function composeTarget(mapping: ColumnMapping): string {
  switch (mapping.kind) {
    case "ignore":
      return "";
    case "core":
      return mapping.field;
    case "translation": {
      const locale = mapping.locale.trim();
      if (!mapping.field || !locale) return "";
      return `${mapping.field}_${normalizeLocale(locale)}`;
    }
    case "metafield": {
      const namespace = mapping.namespace.trim().toLowerCase();
      const key = mapping.key.trim().toLowerCase();
      if (!namespace || !key) return "";
      const type = mapping.type || "single_line_text_field";
      return `metafield.${namespace}.${key}.${type}`;
    }
  }
}

/** "pt-br" and "PT-BR" both mean "pt-BR"; "FR" means "fr". */
export function normalizeLocale(locale: string): string {
  const [language, region] = locale.trim().split("-");
  const lower = language.toLowerCase();
  return region ? `${lower}-${region.toUpperCase()}` : lower;
}

/**
 * Check a target before it is stored. Returns null when fine, otherwise a
 * message for the merchant — a typo here would otherwise surface much later
 * as "Title is required" on every row of their import.
 */
export function validateTarget(target: string): string | null {
  if (target === "") return null;

  if ((CORE_FIELDS as readonly string[]).includes(target)) return null;

  if (target.startsWith("metafield.")) {
    if (METAFIELD_TARGET.test(target)) return null;
    return `"${target}" is not a valid metafield column. Use metafield.namespace.key.type, with a namespace of 3-255 and a key of 2-64 lowercase letters, numbers, hyphens or underscores.`;
  }

  if (TRANSLATION_TARGET.test(target)) return null;

  const translatablePrefix = (TRANSLATABLE_FIELDS as readonly string[]).some((f) =>
    target.startsWith(`${f}_`)
  );
  if (translatablePrefix) {
    return `"${target}" is not a valid translation column. The locale must look like "fr" or "pt-BR".`;
  }

  return `"${target}" is not a field this importer knows.`;
}
