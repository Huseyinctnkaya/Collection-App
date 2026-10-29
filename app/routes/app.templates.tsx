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
  DropZone,
  Select,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parse as parseCSV } from "csv-parse/sync";
import ExcelJS from "exceljs";
import {
  CORE_FIELDS,
  METAFIELD_TYPES,
  TRANSLATABLE_FIELDS,
  composeTarget,
  validateTarget,
  type ColumnMapping,
} from "../services/template-target";

const IGNORE = "";
const MAX_SAMPLE_SIZE = 2 * 1024 * 1024;

function normalizeKey(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

async function detectColumns(file: File): Promise<string[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.toLowerCase();

  // Suppliers send spreadsheets as often as CSVs, and the mapping works the
  // same for both, so a sample should not have to be converted first.
  if (ext === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (workbook.xlsx.load as any)(buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const values = (worksheet.getRow(1).values as (string | null)[]).slice(1);
    return values.map((v) => String(v ?? "").trim()).filter(Boolean);
  }

  const rows = parseCSV(buffer, { to_line: 1, columns: false, bom: true }) as string[][];
  return (rows[0] ?? []).map((h) => h.trim()).filter(Boolean);
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
  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_SAMPLE_SIZE });
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

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "xlsx") {
      return json({ error: "Upload a CSV or XLSX file" }, { status: 400 });
    }

    try {
      const columns = await detectColumns(file);
      if (columns.length === 0) {
        return json({ error: "No column headers found in the first row" }, { status: 400 });
      }
      return json({ columns });
    } catch (err) {
      return json(
        { error: `Could not read that file: ${err instanceof Error ? err.message : "Unknown error"}` },
        { status: 422 }
      );
    }
  }

  if (intent === "save") {
    const name = (formData.get("name") as string)?.trim();
    if (!name) return json({ error: "Template name is required" }, { status: 400 });

    // Collect col_{rawColName} = target entries
    const columnMap: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("col_") || typeof value !== "string" || value === IGNORE) continue;

      // A bad target would otherwise surface much later, as every row of the
      // merchant's next import failing validation.
      const problem = validateTarget(value);
      if (problem) return json({ error: problem }, { status: 400 });

      columnMap[normalizeKey(key.slice(4))] = value;
    }

    if (Object.keys(columnMap).length === 0) {
      return json({ error: "Map at least one column to a field" }, { status: 400 });
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

const KIND_OPTIONS = [
  { label: "(ignore this column)", value: "ignore" },
  { label: "Collection field", value: "core" },
  { label: "Translation", value: "translation" },
  { label: "Metafield", value: "metafield" },
];

export default function TemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [templateName, setTemplateName] = useState("");
  const [sampleName, setSampleName] = useState("");
  const [detectError, setDetectError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleDrop = useCallback(async (_: File[], accepted: File[]) => {
    const file = accepted[0];
    if (!file) return;

    setDetectError(null);
    setSampleName(file.name);

    const fd = new FormData();
    fd.append("intent", "detect");
    fd.append("file", file);
    const res = await fetch("/app/templates", { method: "POST", body: fd });
    const data = (await res.json()) as { columns?: string[]; error?: string };

    if (data.error || !data.columns?.length) {
      setDetectError(data.error ?? "No columns detected");
      setShowForm(false);
      return;
    }

    // Columns that already carry a known name are mapped for free, so the
    // merchant only has to deal with the ones that differ.
    const initial: Record<string, ColumnMapping> = {};
    for (const col of data.columns) {
      const norm = normalizeKey(col);
      initial[col] = (CORE_FIELDS as readonly string[]).includes(norm)
        ? { kind: "core", field: norm }
        : { kind: "ignore" };
    }

    setDetectedColumns(data.columns);
    setMappings(initial);
    setShowForm(true);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("id", id);
    await fetch("/app/templates", { method: "POST", body: fd });
    window.location.reload();
  }, []);

  const setMapping = useCallback((col: string, mapping: ColumnMapping) => {
    setMappings((prev) => ({ ...prev, [col]: mapping }));
  }, []);

  const changeKind = useCallback(
    (col: string, kind: string) => {
      if (kind === "core") setMapping(col, { kind: "core", field: CORE_FIELDS[0] });
      else if (kind === "translation") setMapping(col, { kind: "translation", field: "title", locale: "" });
      else if (kind === "metafield")
        setMapping(col, { kind: "metafield", namespace: "custom", key: "", type: METAFIELD_TYPES[0] });
      else setMapping(col, { kind: "ignore" });
    },
    [setMapping]
  );

  return (
    <Page
      title="Import Templates"
      subtitle="Save column mappings to reuse with different file formats"
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
                  Upload a sample file to detect its columns
                </Text>
                <DropZone accept=".csv,.xlsx" type="file" allowMultiple={false} onDrop={handleDrop}>
                  {sampleName
                    ? <DropZone.FileUpload actionTitle={sampleName} actionHint="Columns detected below" />
                    : <DropZone.FileUpload actionTitle="Add CSV or XLSX" actionHint="or drag and drop" />}
                </DropZone>
                <Text as="p" tone="subdued" variant="bodySm">
                  Only the header row is read. Nothing is imported.
                </Text>
              </BlockStack>

              {detectError && (
                <Banner tone="critical"><p>{detectError}</p></Banner>
              )}

              {showForm && detectedColumns.length > 0 && (
                <form method="post" encType="multipart/form-data">
                  <input type="hidden" name="intent" value="save" />
                  <BlockStack gap="400">
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Map each column to a field
                    </Text>

                    {detectedColumns.map((col) => {
                      const mapping = mappings[col] ?? { kind: "ignore" as const };
                      const target = composeTarget(mapping);

                      return (
                        <BlockStack key={col} gap="200">
                          <InlineStack gap="400" blockAlign="center" wrap={false}>
                            <div style={{ minWidth: 180 }}>
                              <Badge>{col}</Badge>
                            </div>
                            <div style={{ flex: 1, minWidth: 180 }}>
                              <input type="hidden" name={`col_${col}`} value={target} />
                              <Select
                                label=""
                                labelHidden
                                options={KIND_OPTIONS}
                                value={mapping.kind}
                                onChange={(v) => changeKind(col, v)}
                              />
                            </div>
                          </InlineStack>

                          {mapping.kind === "core" && (
                            <div style={{ paddingInlineStart: 196, maxWidth: 420 }}>
                              <Select
                                label="Field"
                                labelHidden
                                options={CORE_FIELDS.map((f) => ({ label: f, value: f }))}
                                value={mapping.field}
                                onChange={(v) => setMapping(col, { kind: "core", field: v })}
                              />
                            </div>
                          )}

                          {mapping.kind === "translation" && (
                            <InlineStack gap="200" wrap>
                              <div style={{ paddingInlineStart: 196 }} />
                              <div style={{ minWidth: 200 }}>
                                <Select
                                  label="Translate"
                                  options={TRANSLATABLE_FIELDS.map((f) => ({ label: f, value: f }))}
                                  value={mapping.field}
                                  onChange={(v) => setMapping(col, { ...mapping, field: v })}
                                />
                              </div>
                              <div style={{ minWidth: 140 }}>
                                <TextField
                                  label="Locale"
                                  value={mapping.locale}
                                  onChange={(v) => setMapping(col, { ...mapping, locale: v })}
                                  placeholder="fr"
                                  helpText="e.g. fr, de, pt-BR"
                                  autoComplete="off"
                                />
                              </div>
                            </InlineStack>
                          )}

                          {mapping.kind === "metafield" && (
                            <InlineStack gap="200" wrap>
                              <div style={{ paddingInlineStart: 196 }} />
                              <div style={{ minWidth: 160 }}>
                                <TextField
                                  label="Namespace"
                                  value={mapping.namespace}
                                  onChange={(v) => setMapping(col, { ...mapping, namespace: v })}
                                  placeholder="custom"
                                  autoComplete="off"
                                />
                              </div>
                              <div style={{ minWidth: 180 }}>
                                <TextField
                                  label="Key"
                                  value={mapping.key}
                                  onChange={(v) => setMapping(col, { ...mapping, key: v })}
                                  placeholder="care_instructions"
                                  autoComplete="off"
                                />
                              </div>
                              <div style={{ minWidth: 220 }}>
                                <Select
                                  label="Type"
                                  options={METAFIELD_TYPES.map((t) => ({ label: t, value: t }))}
                                  value={mapping.type}
                                  onChange={(v) => setMapping(col, { ...mapping, type: v })}
                                />
                              </div>
                            </InlineStack>
                          )}

                          {target && (
                            <div style={{ paddingInlineStart: 196 }}>
                              <Text as="p" tone="subdued" variant="bodySm">
                                {`${col} → ${target}`}
                              </Text>
                            </div>
                          )}
                        </BlockStack>
                      );
                    })}

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
                If your supplier&rsquo;s file uses <strong>Name</strong> instead of <strong>title</strong>, create a template that maps their columns to the fields this importer expects.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Columns can also be mapped to a <strong>metafield</strong> or to a <strong>translation</strong> of the title, description or SEO fields — so a supplier column named &ldquo;Care Instructions&rdquo; can be imported as <code>metafield.custom.care_instructions</code> without renaming anything in the file.
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                On the Import page, select a saved template before uploading, or before importing from Google Sheets. Column names are remapped automatically before processing.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
