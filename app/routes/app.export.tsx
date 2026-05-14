import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const COLLECTIONS_QUERY = `#graphql
  query getCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          descriptionHtml
          sortOrder
          image { url }
          seo { title description }
          products(first: 1) { edges { node { id } } }
          ruleSet {
            appliedDisjunctively
            rules { column relation condition }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface Collection {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  sortOrder: string;
  image: { url: string } | null;
  seo: { title: string; description: string };
  ruleSet: {
    appliedDisjunctively: boolean;
    rules: Array<{ column: string; relation: string; condition: string }>;
  } | null;
}

type GraphQLFn = (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;

async function fetchAllCollections(graphql: GraphQLFn): Promise<Collection[]> {
  const all: Collection[] = [];
  let cursor: string | null = null;

  do {
    const res = await graphql(COLLECTIONS_QUERY, {
      variables: { first: 250, after: cursor },
    });
    const { data } = await res.json();
    const page = data?.collections;
    all.push(...page.edges.map((e: { node: Collection }) => e.node));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return all;
}

function buildCSVRow(c: Collection): string {
  const rules = c.ruleSet
    ? c.ruleSet.rules.map((r) => `${r.column.toLowerCase()}:${r.condition}`).join(",")
    : "";
  const sortOrder = c.sortOrder.toLowerCase().replace(/_/g, "-");
  const desc = c.descriptionHtml.replace(/<[^>]+>/g, "").replace(/"/g, '""');

  const fields = [
    c.title,
    c.handle,
    desc,
    c.image?.url ?? "",
    sortOrder,
    "",
    rules,
    c.seo?.title ?? "",
    c.seo?.description ?? "",
    "true",
  ];

  return fields.map((f) => (f.includes(",") || f.includes('"') ? `"${f}"` : f)).join(",");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const collections = await fetchAllCollections(admin.graphql.bind(admin));

  const headers = [
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
  ].join(",");

  const rows = collections.map(buildCSVRow);
  const csv = [headers, ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="collections-export-${Date.now()}.csv"`,
    },
  });
}
