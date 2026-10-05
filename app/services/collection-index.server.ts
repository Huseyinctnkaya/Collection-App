import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { COLLECTIONS_FOR_IMPORT } from "../graphql/mutations";
import { graphqlRequest } from "./shopify-graphql.server";
import {
  buildExistingIndex,
  chunk,
  handleSearchQuery,
  readCollectionLookup,
  rowLookupHandle,
  type ExistingCollection,
  type ExistingIndex,
  type PlanRow,
} from "./import-plan.server";

const PAGE_SIZE = 250;
/** Handles per lookup query. Keeps the search string well inside Shopify's limit. */
const HANDLES_PER_QUERY = 20;
/** Safety valve for shops with a very large collection catalogue. */
const MAX_PAGES = 400;

/**
 * Resolve every collection an import might be about, once per job.
 *
 * The old code ran one `collectionByHandle` per row from inside a
 * `Promise.all` of 10, which both invited throttling and treated a throttled
 * response as "does not exist". Resolving up front means the create/update
 * decision is made from one consistent snapshot, and it is the same snapshot
 * the dry-run preview can show the merchant.
 *
 * Rows that carry a handle are resolved with a `handle:` search, which is
 * exact and proportional to the import size. As soon as one row has no handle
 * we have to match on title, and Shopify's `title:` filter is a token search
 * rather than an exact match, so the whole catalogue is listed instead. That is
 * more requests but it cannot miss, and missing is what created duplicates.
 */
export async function fetchExistingIndex(
  admin: AdminApiContext,
  rows: PlanRow[]
): Promise<ExistingIndex> {
  const needsTitleMatching = rows.some((r) => rowLookupHandle(r.data) === null);

  const collections = needsTitleMatching
    ? await listAllCollections(admin)
    : await listCollectionsByHandle(admin, rows);

  return buildExistingIndex(collections);
}

async function listCollectionsByHandle(
  admin: AdminApiContext,
  rows: PlanRow[]
): Promise<ExistingCollection[]> {
  const handles = [
    ...new Set(rows.map((r) => rowLookupHandle(r.data)).filter((h): h is string => h !== null)),
  ];

  const collections: ExistingCollection[] = [];
  for (const group of chunk(handles, HANDLES_PER_QUERY)) {
    const query = handleSearchQuery(group);
    if (!query) continue;
    collections.push(...(await listPages(admin, query)));
  }

  return collections;
}

function listAllCollections(admin: AdminApiContext): Promise<ExistingCollection[]> {
  return listPages(admin, "");
}

async function listPages(admin: AdminApiContext, query: string): Promise<ExistingCollection[]> {
  const collections: ExistingCollection[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const payload = await graphqlRequest(admin, COLLECTIONS_FOR_IMPORT, {
      first: PAGE_SIZE,
      after,
      query,
    });

    // Throws on GraphQL errors rather than reporting an empty page, so a
    // failed lookup can never be mistaken for "no such collection".
    collections.push(...readCollectionLookup(payload));

    const pageInfo = (payload as {
      data?: { collections?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
    })?.data?.collections?.pageInfo;

    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) return collections;
    after = pageInfo.endCursor;
  }

  throw new Error(
    `Could not list collections: stopped after ${MAX_PAGES} pages. Add a handle column to the sheet so the import can look up collections directly.`
  );
}
