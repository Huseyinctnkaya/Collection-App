import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
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
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { parseFile } from "../services/parser.server";
import { runImport } from "../services/importer.server";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const BULK_THRESHOLD = 50;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const recentJobs = await prisma.importJob.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { errors: { take: 5 } },
  });

  return json({ recentJobs });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_FILE_SIZE });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const file = formData.get("file") as File | null;
  if (!file) return json({ error: "No file uploaded" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext !== "csv" && ext !== "xlsx") {
    return json({ error: "Only CSV and XLSX files are supported" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parseResult;
  try {
    parseResult = await parseFile(buffer, ext as "csv" | "xlsx");
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

  // Run import in background (fire and forget for long jobs)
  runImport({
    jobId: job.id,
    shop: session.shop,
    admin,
    rows: parseResult.rows,
    useBulk,
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
  const { recentJobs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [file, setFile] = useState<File | null>(null);
  const isSubmitting = navigation.state === "submitting";

  const handleDrop = useCallback((_: File[], acceptedFiles: File[]) => {
    setFile(acceptedFiles[0] ?? null);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }, [file, submit]);

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

              <Button
                variant="primary"
                disabled={!file || isSubmitting}
                loading={isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? "Importing..." : "Start Import"}
              </Button>

              {"error" in (actionData ?? {}) && (
                <Banner tone="critical">
                  <p>{(actionData as { error: string }).error}</p>
                </Banner>
              )}

              {"jobId" in (actionData ?? {}) && (() => {
                const d = actionData as { jobId: string; totalRows: number; validRows: number; errorRows: number; useBulk: boolean };
                return (
                  <Banner tone={d.errorRows > 0 ? "warning" : "success"}>
                    <BlockStack gap="200">
                      <Text as="p" fontWeight="bold">Import started — Job ID: {d.jobId}</Text>
                      <List>
                        <List.Item>Total rows: {d.totalRows}</List.Item>
                        <List.Item>Valid: {d.validRows}</List.Item>
                        {d.errorRows > 0 && <List.Item>Parse errors: {d.errorRows}</List.Item>}
                        <List.Item>Mode: {d.useBulk ? "Bulk Operation (async)" : "Standard (batched)"}</List.Item>
                      </List>
                    </BlockStack>
                  </Banner>
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
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                  headings={["File", "Status", "Total", "Success", "Errors", "Date"]}
                  rows={recentJobs.map((j) => [
                    j.fileName,
                    statusBadge(j.status),
                    j.totalRows,
                    j.successCount,
                    j.errorCount,
                    new Date(j.createdAt).toLocaleDateString(),
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
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
