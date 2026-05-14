import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit, useRevalidator } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Banner,
  DropZone,
  List,
  Badge,
  InlineStack,
  ProgressBar,
  DataTable,
  Divider,
  Select,
} from "@shopify/polaris";
import { useState, useCallback, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseFile } from "../services/parser.server";
import { runImport } from "../services/importer.server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BULK_THRESHOLD = 50;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [recentJobs, templates] = await Promise.all([
    prisma.importJob.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { errors: { take: 5 } },
    }),
    prisma.importTemplate.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, columnMap: true },
    }),
  ]);

  return json({ recentJobs, templates });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_FILE_SIZE });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const file = formData.get("file") as File | null;
  const duplicateStrategy = (formData.get("duplicateStrategy") as string) === "overwrite" ? "overwrite" : "skip";
  const isDryRun = formData.get("dryRun") === "true";
  const templateId = formData.get("templateId") as string | null;
  if (!file) return json({ error: "No file uploaded" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "csv" && ext !== "xlsx") {
    return json({ error: "Only CSV and XLSX files are supported" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let columnMap: Record<string, string> | undefined;
  if (templateId) {
    const tmpl = await prisma.importTemplate.findFirst({ where: { id: templateId, shop: session.shop } });
    if (tmpl) columnMap = JSON.parse(tmpl.columnMap) as Record<string, string>;
  }

  let parseResult;
  try {
    parseResult = await parseFile(buffer, ext as "csv" | "xlsx", columnMap);
  } catch (err) {
    return json({ error: `Parse error: ${err instanceof Error ? err.message : "Unknown"}` }, { status: 422 });
  }

  const job = await prisma.importJob.create({
    data: {
      shop: session.shop,
      fileName: file.name,
      fileType: ext,
      status: "PARSING",
      totalRows: parseResult.totalRows,
    },
  });

  // Save parse errors
  const parseErrors = parseResult.rows.filter((r) => r.errors.length > 0);
  if (parseErrors.length > 0) {
    await prisma.importError.createMany({
      data: parseErrors.flatMap((r) =>
        r.errors.map((e) => ({
          jobId: job.id,
          row: r.row,
          field: e.field,
          message: e.message,
        }))
      ),
    });
  }

  const useBulk = parseResult.validRows > BULK_THRESHOLD;

  // Dry run: return preview without importing
  if (isDryRun) {
    return json({
      dryRun: true,
      totalRows: parseResult.totalRows,
      validRows: parseResult.validRows,
      errorRows: parseResult.errorRows,
      preview: parseResult.rows.slice(0, 20).map((r) => ({
        row: r.row,
        valid: r.errors.length === 0,
        title: r.data?.title ?? "—",
        handle: r.data?.handle ?? "—",
        type: r.data?.rules ? "smart" : "manual",
        errors: r.errors,
      })),
    });
  }

  // Run import in background (fire and forget for long jobs)
  runImport({
    jobId: job.id,
    shop: session.shop,
    admin,
    rows: parseResult.rows,
    useBulk,
    duplicateStrategy,
  }).catch(async (err) => {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "FAILED" },
    });
    console.error("Import job failed:", err);
  });

  return json({
    jobId: job.id,
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows,
    errorRows: parseResult.errorRows,
    useBulk,
  });
}

export default function ImportPage() {
  const { recentJobs, templates } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const { revalidate } = useRevalidator();

  const [file, setFile] = useState<File | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "overwrite">("skip");
  const [templateId, setTemplateId] = useState("");
  const isSubmitting = navigation.state === "submitting";

  const activeJobId =
    actionData && "jobId" in actionData ? (actionData as { jobId: string }).jobId : null;
  const jobFetcher = useFetcher<{ job: { status: string; processedRows: number; totalRows: number; successCount: number; errorCount: number } }>();
  const activeJob = jobFetcher.data?.job;
  const isJobRunning = activeJob?.status === "RUNNING" || activeJob?.status === "PARSING" || activeJob?.status === "PENDING";

  useEffect(() => {
    if (!activeJobId) return;
    jobFetcher.load(`/app/jobs/${activeJobId}`);
  }, [activeJobId]);

  useEffect(() => {
    if (!activeJobId || !isJobRunning) return;
    const timer = setInterval(() => {
      jobFetcher.load(`/app/jobs/${activeJobId}`);
      if (!isJobRunning) revalidate();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeJobId, isJobRunning, revalidate]);

  const handleDrop = useCallback((_: File[], acceptedFiles: File[]) => {
    setFile(acceptedFiles[0] ?? null);
  }, []);

  const handleSubmit = useCallback((dryRun = false) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("duplicateStrategy", duplicateStrategy);
    fd.append("dryRun", String(dryRun));
    if (templateId) fd.append("templateId", templateId);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [file, duplicateStrategy, templateId, submit]);

  const statusBadge = (status: string) => {
    const map: Record<string, "success" | "warning" | "critical" | "info"> = {
      COMPLETED: "success",
      PARTIAL: "warning",
      FAILED: "critical",
      RUNNING: "info",
      PENDING: "info",
      PARSING: "info",
    };
    return <Badge tone={map[status] ?? "info"}>{status}</Badge>;
  };

  return (
    <Page
      title="Collection Importer"
      subtitle="Upload a CSV or Excel file to bulk-create Shopify collections"
      secondaryActions={[
        { content: "Download CSV Template", url: "/app/template", external: true },
        { content: "Export Existing Collections", url: "/app/export", external: true },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Upload File</Text>

              <DropZone
                accept=".csv,.xlsx"
                type="file"
                allowMultiple={false}
                onDrop={handleDrop}
                label="Drop CSV or XLSX file here"
              >
                {file ? (
                  <DropZone.FileUpload actionTitle={file.name} actionHint="File ready to import" />
                ) : (
                  <DropZone.FileUpload actionTitle="Add CSV or XLSX" actionHint="or drag and drop" />
                )}
              </DropZone>

              {file && (
                <InlineStack gap="200" align="center">
                  <Text as="span" tone="subdued">{file.name} — {(file.size / 1024).toFixed(1)} KB</Text>
                  <Button onClick={() => setFile(null)} variant="plain" tone="critical">Remove</Button>
                </InlineStack>
              )}

              {templates.length > 0 && (
                <Select
                  label="Column mapping template"
                  options={[
                    { label: "None (use default column names)", value: "" },
                    ...templates.map((t) => ({ label: t.name, value: t.id })),
                  ]}
                  value={templateId}
                  onChange={setTemplateId}
                  helpText="Apply a saved column mapping if your CSV uses different header names"
                />
              )}

              <Select
                label="If collection already exists"
                options={[
                  { label: "Skip (keep existing)", value: "skip" },
                  { label: "Overwrite (update existing)", value: "overwrite" },
                ]}
                value={duplicateStrategy}
                onChange={(v) => setDuplicateStrategy(v as "skip" | "overwrite")}
              />

              <InlineStack gap="300">
                <Button
                  variant="primary"
                  disabled={!file || isSubmitting}
                  loading={isSubmitting}
                  onClick={() => handleSubmit(false)}
                >
                  {isSubmitting ? "Importing..." : "Start Import"}
                </Button>
                <Button
                  disabled={!file || isSubmitting}
                  onClick={() => handleSubmit(true)}
                >
                  Preview
                </Button>
              </InlineStack>

              {"dryRun" in (actionData ?? {}) && (() => {
                const d = actionData as { dryRun: true; totalRows: number; validRows: number; errorRows: number; preview: Array<{ row: number; valid: boolean; title: string; handle: string; type: string; errors: Array<{ field: string; message: string }> }> };
                return (
                  <BlockStack gap="300">
                    <Banner tone={d.errorRows > 0 ? "warning" : "success"}>
                      <Text as="p" fontWeight="bold">
                        Preview — {d.validRows} valid, {d.errorRows} errors (nothing was imported)
                      </Text>
                    </Banner>
                    <DataTable
                      columnContentTypes={["numeric", "text", "text", "text", "text"]}
                      headings={["Row", "Title", "Handle", "Type", "Status"]}
                      rows={d.preview.map((p) => [
                        p.row,
                        p.title,
                        p.handle,
                        p.type,
                        p.valid
                          ? <Badge tone="success">Valid</Badge>
                          : <Badge tone="critical">{p.errors[0]?.message ?? "Error"}</Badge>,
                      ])}
                    />
                  </BlockStack>
                );
              })()}

              {"error" in (actionData ?? {}) && (
                <Banner tone="critical">
                  <p>{(actionData as { error: string }).error}</p>
                </Banner>
              )}

              {"jobId" in (actionData ?? {}) && (() => {
                const d = actionData as { jobId: string; totalRows: number; validRows: number; errorRows: number; useBulk: boolean };
                const progress = activeJob && activeJob.totalRows > 0
                  ? Math.round((activeJob.processedRows / activeJob.totalRows) * 100)
                  : 0;
                const isDone = activeJob && ["COMPLETED", "FAILED", "PARTIAL"].includes(activeJob.status);
                return (
                  <BlockStack gap="300">
                    <Banner tone={d.errorRows > 0 ? "warning" : "success"}>
                      <BlockStack gap="200">
                        <Text as="p" fontWeight="bold">Import started</Text>
                        <List>
                          <List.Item>Total rows: {d.totalRows}</List.Item>
                          <List.Item>Valid: {d.validRows}</List.Item>
                          {d.errorRows > 0 && <List.Item>Parse errors: {d.errorRows}</List.Item>}
                          <List.Item>Mode: {d.useBulk ? "Bulk Operation (async)" : "Standard (batched)"}</List.Item>
                        </List>
                      </BlockStack>
                    </Banner>
                    {activeJob && (
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">
                              {isDone ? "Import complete" : "Importing…"}
                            </Text>
                            {statusBadge(activeJob.status)}
                          </InlineStack>
                          {!d.useBulk && (
                            <ProgressBar progress={progress} tone={isDone && activeJob.errorCount > 0 ? "critical" : "highlight"} />
                          )}
                          <InlineStack gap="400">
                            <Text as="span" variant="bodySm" tone="subdued">Processed: {activeJob.processedRows}/{activeJob.totalRows}</Text>
                            <Text as="span" variant="bodySm" tone="success">Success: {activeJob.successCount}</Text>
                            {activeJob.errorCount > 0 && (
                              <Text as="span" variant="bodySm" tone="critical">Errors: {activeJob.errorCount}</Text>
                            )}
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    )}
                  </BlockStack>
                );
              })()}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Recent Import Jobs</Text>
              <Divider />
              {recentJobs.length === 0 ? (
                <Text as="p" tone="subdued">No imports yet.</Text>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                  headings={["File", "Status", "Total", "Success", "Errors", "Date", ""]}
                  rows={recentJobs.map((j) => [
                    j.fileName,
                    statusBadge(j.status),
                    j.totalRows,
                    j.successCount,
                    j.errorCount,
                    new Date(j.createdAt).toLocaleDateString(),
                    <Button variant="plain" url={`/app/jobs/${j.id}`} key={j.id}>View</Button>,
                  ])}
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">CSV Format</Text>
              <Text as="p" tone="subdued">Required columns:</Text>
              <List type="bullet">
                <List.Item><strong>title</strong> — Collection name (required)</List.Item>
                <List.Item><strong>handle</strong> — URL slug (optional)</List.Item>
                <List.Item><strong>description</strong> — HTML description</List.Item>
                <List.Item><strong>image_url</strong> — Cover image URL</List.Item>
                <List.Item><strong>sort_order</strong> — manual, alpha-asc…</List.Item>
                <List.Item><strong>products</strong> — Comma-separated handles</List.Item>
                <List.Item><strong>rules</strong> — tag:summer,vendor:Nike</List.Item>
                <List.Item><strong>seo_title / seo_description</strong></List.Item>
                <List.Item><strong>published</strong> — true / false</List.Item>
                <List.Item><strong>title_fr</strong> — French translation (any locale suffix works, e.g. title_de, description_fr)</List.Item>
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
