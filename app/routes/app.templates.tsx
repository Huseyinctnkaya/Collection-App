import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Button,
  Banner,
  Divider,
  DataTable,
  Select,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parse as parseCSV } from "csv-parse/sync";

const CANONICAL_FIELDS = [
  "title", "handle", "description", "image_url", "sort_order",
  "products", "rules", "seo_title", "seo_description", "published",
];
const IGNORE = "";

function normalizeKey(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function detectCSVColumns(buffer: Buffer): Promise<string[]> {
  const rows = parseCSV(buffer as Buffer, { to_line: 1, columns: false }) as string[][];
  return rows[0] ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const templates = await prisma.importTemplate.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return json({ templates });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: 1 * 1024 * 1024 });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);
  const intent = formData.get("intent") as string;

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await prisma.importTemplate.deleteMany({ where: { id, shop: session.shop } });
    return json({ deleted: true });
  }

  if (intent === "detect") {
    const file = formData.get("file") as File | null;
    if (!file) return json({ error: "No file provided" }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const columns = await detectCSVColumns(buffer as Buffer);
    return json({ columns });
  }

  if (intent === "save") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return json({ error: "Template name is required" }, { status: 400 });

    // Collect col_{rawColName} = canonicalField entries
    const columnMap: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("col_") && value && value !== IGNORE) {
        const rawCol = key.slice(4); // strip "col_"
        columnMap[normalizeKey(rawCol)] = value as string;
      }
    }

    if (Object.keys(columnMap).length === 0) {
      return json({ error: "Map at least one column to a canonical field" }, { status: 400 });
    }

    await prisma.importTemplate.upsert({
      where: { shop_name: { shop: session.shop, name } },
      create: { shop: session.shop, name, columnMap: JSON.stringify(columnMap) },
      update: { columnMap: JSON.stringify(columnMap) },
    });

    return json({ saved: true, name });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [showForm, setShowForm] = useState(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const fd = new FormData();
    fd.append("intent", "detect");
    fd.append("file", f);
    const res = await fetch("/app/templates", { method: "POST", body: fd });
    const data = await res.json() as { columns?: string[] };

    if (data.columns && data.columns.length > 0) {
      setDetectedColumns(data.columns);
      const initial: Record<string, string> = {};
      for (const col of data.columns) {
        const norm = normalizeKey(col);
        initial[col] = CANONICAL_FIELDS.includes(norm) ? norm : IGNORE;
      }
      setColumnMapping(initial);
      setShowForm(true);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("id", id);
    await fetch("/app/templates", { method: "POST", body: fd });
    window.location.reload();
  }, []);

  const canonicalOptions = [
    { label: "(ignore)", value: IGNORE },
    ...CANONICAL_FIELDS.map((f) => ({ label: f, value: f })),
  ];

  return (
    <Page
      title="Import Templates"
      subtitle="Save column mappings to reuse with different CSV formats"
      backAction={{ content: "Import", url: "/app/import" }}
    >
      <TitleBar title="Import Templates" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Create New Template</Text>
              <Divider />

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  Upload a sample CSV to detect columns
                </Text>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  style={{ fontSize: 14 }}
                />
              </BlockStack>

              {showForm && detectedColumns.length > 0 && (
                <form method="post" encType="multipart/form-data">
                  <input type="hidden" name="intent" value="save" />
                  <BlockStack gap="400">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Map each column to a canonical field
                    </Text>

                    {detectedColumns.map((col) => (
                      <InlineStack key={col} gap="400" blockAlign="center">
                        <div style={{ minWidth: 180 }}>
                          <Badge>{col}</Badge>
                        </div>
                        <div style={{ flex: 1 }}>
                          <input type="hidden" name={`col_${col}`} value={columnMapping[col] ?? IGNORE} />
                          <Select
                            label=""
                            labelHidden
                            options={canonicalOptions}
                            value={columnMapping[col] ?? IGNORE}
                            onChange={(v) => setColumnMapping((prev) => ({ ...prev, [col]: v }))}
                          />
                        </div>
                      </InlineStack>
                    ))}

                    <TextField
                      label="Template name"
                      name="name"
                      value={templateName}
                      onChange={setTemplateName}
                      placeholder="e.g. Supplier Format A"
                      autoComplete="off"
                    />

                    {"error" in (actionData ?? {}) && (
                      <Banner tone="critical">
                        <p>{(actionData as { error: string }).error}</p>
                      </Banner>
                    )}
                    {"saved" in (actionData ?? {}) && (
                      <Banner tone="success">
                        <p>Template &ldquo;{(actionData as { name: string }).name}&rdquo; saved.</p>
                      </Banner>
                    )}

                    <Button
                      variant="primary"
                      submit
                      loading={isSaving}
                      disabled={!templateName || isSaving}
                    >
                      Save Template
                    </Button>
                  </BlockStack>
                </form>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Saved Templates</Text>
              <Divider />
              {templates.length === 0 ? (
                <Text as="p" tone="subdued">No templates saved yet.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Name", "Mappings", "Created", ""]}
                  rows={templates.map((t) => {
                    const map = JSON.parse(t.columnMap) as Record<string, string>;
                    const entries = Object.entries(map);
                    const summary = entries.slice(0, 3).map(([k, v]) => `${k}→${v}`).join(", ");
                    return [
                      t.name,
                      entries.length > 3 ? `${summary} …` : summary,
                      new Date(t.createdAt).toLocaleDateString(),
                      <Button key={t.id} variant="plain" tone="critical" onClick={() => handleDelete(t.id)}>
                        Delete
                      </Button>,
                    ];
                  })}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">How it works</Text>
              <Divider />
              <Text as="p" tone="subdued" variant="bodySm">
                If your supplier&rsquo;s CSV uses <strong>Name</strong> instead of <strong>title</strong>, create a template that maps their columns to the expected field names.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                On the Import page, select a saved template before uploading. Column names are remapped automatically before processing.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
