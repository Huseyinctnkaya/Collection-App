import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

const CSV_HEADERS = [
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
  "title_fr",
  "description_fr",
  "title_de",
  "description_de",
];

const SAMPLE_ROWS = [
  [
    "Summer Collection",
    "summer-collection",
    "Our best summer styles",
    "https://cdn.shopify.com/s/files/example.jpg",
    "manual",
    "blue-tshirt,white-shorts,sun-hat",
    "",
    "Summer Collection 2025",
    "Shop our best summer styles",
    "true",
    "Collection Été",
    "Nos meilleures tenues d'été",
    "Sommerkollektion",
    "Unsere besten Sommer-Styles",
  ],
  [
    "Sale Items",
    "sale-items",
    "Items on sale this week",
    "",
    "best-selling",
    "",
    "tag:sale,vendor:Nike",
    "",
    "",
    "true",
    "Articles en Solde",
    "",
    "Sonderangebote",
    "",
  ],
  [
    "New Arrivals",
    "new-arrivals",
    "",
    "",
    "created-desc",
    "",
    "tag:new",
    "New Arrivals",
    "Latest products just added to our store",
    "true",
    "",
    "",
    "",
    "",
  ],
];

function buildCSV(headers: string[], rows: string[][]): string {
  const escape = (val: string) =>
    val.includes(",") || val.includes('"') || val.includes("\n")
      ? `"${val.replace(/"/g, '""')}"`
      : val;

  const lines = [
    headers.join(","),
    ...rows.map((row) => row.map(escape).join(",")),
  ];
  return lines.join("\n");
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const csv = buildCSV(CSV_HEADERS, SAMPLE_ROWS);

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="collections-template.csv"',
    },
  });
}
