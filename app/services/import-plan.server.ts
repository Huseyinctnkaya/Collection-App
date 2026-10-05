/**
 * Pure import-planning logic: deciding which spreadsheet row maps to which
 * Shopify collection, and what input to send for it.
 *
 * This module deliberately has no runtime imports (only `import type`), so it
 * can be unit tested with bare `node --test` and so the create/update decision
 * is impossible to get wrong in one code path but right in another. Both the
 * batched path and the bulk-operation path go through `planImport`.
 */
import type { CollectionRow } from "./parser.server";

export type DuplicateStrategy = "skip" | "overwrite";

export interface MetafieldInput {
  namespace: string;
  key: string;
  type: string;
  value: string;
}

/** A collection that already exists in the shop, as returned by the lookup query. */
export interface ExistingCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string | null;
  sortOrder?: string | null;
  image?: { src?: string | null; altText?: string | null } | null;
  seo?: { title?: string | null; description?: string | null } | null;
  ruleSet?: unknown;
}

export interface ExistingIndex {
  byHandle: Map<string, ExistingCollection>;
  byTitle: Map<string, ExistingCollection[]>;
}

export type MatchResult =
  | { kind: "existing"; collection: ExistingCollection }
  | { kind: "new" }
  | { kind: "ambiguous"; count: number };

export interface PlanRow {
  /** 1-based spreadsheet row, used when reporting errors back to the merchant. */
  row: number;
  data: CollectionRow;
  metafields: MetafieldInput[];
}

export interface PlannedRow {
  row: number;
  handle: string;
  input: Record<string, unknown>;
  /** Present for updates: the pre-update state, snapshotted for rollback. */
  existing?: ExistingCollection;
}

export interface ImportPlan {
  creates: PlannedRow[];
  updates: PlannedRow[];
  skipped: Array<{ row: number; collectionId: string }>;
  failed: Array<{ row: number; message: string }>;
}

/**
 * Shopify's handleization: lowercase, every run of non-alphanumeric characters
 * becomes a single hyphen, no leading or trailing hyphens.
 *
 * The previous implementation *deleted* punctuation instead of replacing it, so
 * "Salt & Pepper" produced "salt--pepper" while Shopify produced "salt-pepper".
 * The lookup therefore missed, the row fell through to collectionCreate, and
 * Shopify rejected it with "handle has already been taken".
 */
export function handleize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // "Café" -> "Cafe", not "Caf-"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildExistingIndex(collections: ExistingCollection[]): ExistingIndex {
  const byHandle = new Map<string, ExistingCollection>();
  const byTitle = new Map<string, ExistingCollection[]>();

  for (const collection of collections) {
    byHandle.set(handleize(collection.handle), collection);

    const titleKey = normalizeTitle(collection.title);
    const bucket = byTitle.get(titleKey);
    if (bucket) bucket.push(collection);
    else byTitle.set(titleKey, [collection]);
  }

  return { byHandle, byTitle };
}

/**
 * Decide whether a row refers to a collection that already exists.
 *
 * A handle in the sheet is authoritative — if the merchant spelled out a handle
 * that doesn't exist, they mean a new collection, not a title match. Without a
 * handle column we fall back to an exact title match, which is what a
 * metafield-only sheet relies on. Titles are not unique in Shopify, so several
 * matches are reported as ambiguous rather than guessed at.
 */
export function matchExisting(row: CollectionRow, index: ExistingIndex): MatchResult {
  if (row.handle && row.handle.trim()) {
    const found = index.byHandle.get(handleize(row.handle));
    return found ? { kind: "existing", collection: found } : { kind: "new" };
  }

  const matches = index.byTitle.get(normalizeTitle(row.title)) ?? [];
  if (matches.length === 0) return { kind: "new" };
  if (matches.length > 1) return { kind: "ambiguous", count: matches.length };
  return { kind: "existing", collection: matches[0] };
}

/** Spreadsheet column that supplies each collection field. */
const FIELD_COLUMNS = {
  descriptionHtml: "description",
  handle: "handle",
  sortOrder: "sort_order",
  seo: "seo_title",
  image: "image_url",
  ruleSet: "rules",
} as const;

export function buildCollectionInput(
  row: CollectionRow,
  metafields: MetafieldInput[],
  options: { mode?: "create" | "update"; columns?: ReadonlySet<string> } = {}
): Record<string, unknown> {
  const { mode = "create", columns } = options;

  // On update, a field is only sent when the sheet actually has its column.
  // Zod fills in defaults for absent columns (description -> "", sort_order ->
  // "manual"), so sending them unconditionally would blank out live
  // descriptions and reset sort order on every metafield-only import.
  const provides = (field: keyof typeof FIELD_COLUMNS): boolean =>
    mode === "create" || !columns || columns.has(FIELD_COLUMNS[field]);

  const input: Record<string, unknown> = { title: row.title };

  if (provides("descriptionHtml")) input.descriptionHtml = row.description ?? "";

  const handle = row.handle?.trim() ? handleize(row.handle) : "";
  if (handle && provides("handle")) input.handle = handle;

  if (row.sort_order && provides("sortOrder")) {
    input.sortOrder = row.sort_order.toUpperCase().replace(/-/g, "_");
  }

  if (row.seo_title && provides("seo")) {
    input.seo = { title: row.seo_title, description: row.seo_description };
  }

  if (row.image_url && provides("image")) input.image = { src: row.image_url };

  if (row.rules && provides("ruleSet")) input.ruleSet = buildRuleSet(row.rules);

  if (metafields.length > 0) input.metafields = metafields;

  return input;
}

export function planImport({
  rows,
  index,
  duplicateStrategy,
  columns,
}: {
  rows: PlanRow[];
  index: ExistingIndex;
  duplicateStrategy: DuplicateStrategy;
  columns: ReadonlySet<string>;
}): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], skipped: [], failed: [] };

  for (const { row, data, metafields } of rows) {
    const match = matchExisting(data, index);

    if (match.kind === "ambiguous") {
      plan.failed.push({
        row,
        message: `${match.count} collections are named "${data.title}". Add a handle column to say which one to update.`,
      });
      continue;
    }

    if (match.kind === "new") {
      plan.creates.push({
        row,
        handle: data.handle?.trim() ? handleize(data.handle) : handleize(data.title),
        input: buildCollectionInput(data, metafields, { mode: "create", columns }),
      });
      continue;
    }

    if (duplicateStrategy === "skip") {
      plan.skipped.push({ row, collectionId: match.collection.id });
      continue;
    }

    plan.updates.push({
      row,
      handle: match.collection.handle,
      existing: match.collection,
      input: {
        id: match.collection.id,
        ...buildCollectionInput(data, metafields, { mode: "update", columns }),
      },
    });
  }

  return plan;
}

export class GraphqlLookupError extends Error {
  readonly throttled: boolean;

  constructor(message: string, throttled: boolean) {
    super(message);
    this.name = "GraphqlLookupError";
    this.throttled = throttled;
  }
}

/**
 * Read the collections lookup response, failing loudly on GraphQL errors.
 *
 * Shopify answers a throttled request with HTTP 200, `data: null` and a
 * THROTTLED error. The previous code read `data?.collectionByHandle` directly,
 * so a throttled lookup was indistinguishable from "this collection does not
 * exist" and the row was created instead of updated.
 */
export function readCollectionLookup(payload: unknown): ExistingCollection[] {
  const body = payload as {
    data?: { collections?: { nodes?: ExistingCollection[] } } | null;
    errors?: Array<{ message?: string; extensions?: { code?: string } }>;
  };

  const errors = body?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const throttled = errors.some(
      (e) => e.extensions?.code === "THROTTLED" || /throttled/i.test(e.message ?? "")
    );
    throw new GraphqlLookupError(
      errors.map((e) => e.message ?? "Unknown GraphQL error").join("; "),
      throttled
    );
  }

  const nodes = body?.data?.collections?.nodes;
  if (!Array.isArray(nodes)) {
    throw new GraphqlLookupError("Shopify returned no collection data", false);
  }

  return nodes;
}

const RULE_COLUMN_ALIASES: Record<string, string> = {
  PRODUCT_TYPE: "TYPE",
  PRODUCT_VENDOR: "VENDOR",
  PRODUCT_TAG: "TAG",
  PRODUCT_TITLE: "TITLE",
};

export function buildRuleSet(rulesStr: string) {
  const rules = rulesStr
    .split(",")
    .map((r) => {
      const colonIdx = r.indexOf(":");
      if (colonIdx === -1) return null;
      const rawColumn = r.slice(0, colonIdx).trim().toUpperCase();
      const condition = r.slice(colonIdx + 1).trim();
      const column = RULE_COLUMN_ALIASES[rawColumn] ?? rawColumn;
      return { column, relation: "EQUALS", condition };
    })
    .filter(Boolean);

  return { rules, appliedDisjunctively: false };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build a Shopify search query for a chunk of handles.
 *
 * `collections(query:)` supports a `handle:` filter, so existing collections
 * can be resolved a chunk at a time instead of one request per row. A malformed
 * query returns zero results, which would look like "nothing exists" and bring
 * the create-instead-of-update bug straight back, so handles are handleized
 * first (they contain no characters needing quoting afterwards).
 */
export function handleSearchQuery(handles: string[]): string {
  return handles
    .map((h) => handleize(h))
    .filter(Boolean)
    .map((h) => `handle:${h}`)
    .join(" OR ");
}

/** Handles a row needs resolved, or null when the row has to match on title. */
export function rowLookupHandle(row: CollectionRow): string | null {
  return row.handle?.trim() ? handleize(row.handle) : null;
}
