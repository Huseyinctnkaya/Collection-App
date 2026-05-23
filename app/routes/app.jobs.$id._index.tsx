import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  Banner,
  Button,
  Divider,
  ProgressBar,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rollbackJob } from "../services/rollback.server";
import { getCachedPlan } from "../services/plan.server";
import { hasAccess } from "../components/PlanGate";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const [job, currentPlan] = await Promise.all([
    prisma.importJob.findFirst({
      where: { id: params.id, shop: session.shop },
      include: {
        errors: { orderBy: { row: "asc" } },
        actions: { select: { id: true, action: true, collectionHandle: true } },
      },
    }),
    getCachedPlan(session.shop),
  ]);

  if (!job) throw new Response("Not Found", { status: 404 });
  return json({ job, currentPlan });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "rollback") {
    const plan = await getCachedPlan(session.shop);
    if (!hasAccess(plan, "pro")) {
      return json({ error: "Rollback is available on Pro and Premium plans" }, { status: 403 });
    }
    try {
      const result = await rollbackJob(admin, params.id!, session.shop);
      return json({ rollback: result });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : "Rollback failed" }, { status: 400 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info"> = {
  COMPLETED: "success",
  PARTIAL: "warning",
  FAILED: "critical",
  RUNNING: "info",
  PENDING: "info",
  PARSING: "info",
};

export default function JobDetail() {
  const { job, currentPlan } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isRollingBack = navigation.state === "submitting";
  const progress = job.totalRows > 0 ? Math.round((job.processedRows / job.totalRows) * 100) : 0;
  const isDone = ["COMPLETED", "FAILED", "PARTIAL"].includes(job.status);
  const canRollback = isDone && !job.rolledBack && job.actions.length > 0 && job.status !== "FAILED" && hasAccess(currentPlan, "pro");
  const createdCount = job.actions.filter((a) => a.action === "created").length;
  const updatedCount = job.actions.filter((a) => a.action === "updated").length;

  const handleRollback = () => {
    if (!confirm(`This will delete ${createdCount} created and restore ${updatedCount} updated collections. Continue?`)) return;
    const fd = new FormData();
    fd.append("intent", "rollback");
    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="Import Job"
      subtitle={job.fileName}
      backAction={{ content: "Import", onAction: () => navigate("/app/import") }}
    >
      <TitleBar title="Import Job Detail" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="h2" variant="headingMd">Status</Text>
                  <Badge tone={STATUS_TONE[job.status] ?? "info"}>{job.status}</Badge>
                  {job.rolledBack && <Badge tone="warning">Rolled back</Badge>}
                </InlineStack>
                {canRollback && (
                  <Button
                    tone="critical"
                    loading={isRollingBack}
                    disabled={isRollingBack}
                    onClick={handleRollback}
                  >
                    Rollback Import
                  </Button>
                )}
              </InlineStack>
              <Divider />
              {!isDone && <ProgressBar progress={progress} tone="highlight" />}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[
                  { label: "Total rows", value: job.totalRows },
                  { label: "Processed", value: job.processedRows },
                  { label: "Success", value: job.successCount },
                  { label: "Errors", value: job.errorCount },
                ].map(({ label, value }) => (
                  <Box key={label} background="bg-surface-secondary" borderRadius="200" padding="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="headingLg" fontWeight="bold">{value}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                    </BlockStack>
                  </Box>
                ))}
              </div>
              {job.actions.length > 0 && (
                <InlineStack gap="400">
                  {createdCount > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {createdCount} collection{createdCount !== 1 ? "s" : ""} created
                    </Text>
                  )}
                  {updatedCount > 0 && (
                    <Text as="span" variant="bodySm" tone="subdued">
                      {updatedCount} collection{updatedCount !== 1 ? "s" : ""} updated
                    </Text>
                  )}
                </InlineStack>
              )}
              <InlineStack gap="200">
                <Text as="span" variant="bodySm" tone="subdued">
                  File: <strong>{job.fileName}</strong> ({job.fileType.toUpperCase()})
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  Started: {new Date(job.createdAt).toLocaleString()}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {job.errors.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Errors ({job.errors.length})</Text>
                  <Button
                    variant="plain"
                    onClick={() => {
                      const csv = [
                        "row,field,message,raw_data",
                        ...job.errors.map((e) =>
                          [e.row, e.field ?? "", e.message, e.rawData ?? ""]
                            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                            .join(",")
                        ),
                      ].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `errors-${job.id}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    Download error CSV
                  </Button>
                </InlineStack>
                {job.status === "PARTIAL" && (
                  <Banner tone="warning">
                    <p>Import completed partially. {job.successCount} collections were created, {job.errorCount} rows failed.</p>
                  </Banner>
                )}
                <DataTable
                  columnContentTypes={["numeric", "text", "text", "text"]}
                  headings={["Row", "Field", "Error", "Raw data"]}
                  rows={job.errors.map((e) => [
                    e.row,
                    e.field ?? "—",
                    e.message,
                    e.rawData ? JSON.stringify(JSON.parse(e.rawData)).slice(0, 80) + "…" : "—",
                  ])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {job.errors.length === 0 && isDone && (
          <Layout.Section>
            <Banner tone="success">
              <p>All {job.successCount} collections were imported successfully.</p>
            </Banner>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
