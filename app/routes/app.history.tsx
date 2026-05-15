import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  Divider,
  Box,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [allJobs, recentJobs] = await Promise.all([
    prisma.importJob.findMany({
      where: { shop },
      select: {
        status: true,
        successCount: true,
        errorCount: true,
        totalRows: true,
        createdAt: true,
        rolledBack: true,
      },
    }),
    prisma.importJob.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        fileName: true,
        status: true,
        successCount: true,
        errorCount: true,
        totalRows: true,
        rolledBack: true,
        createdAt: true,
      },
    }),
  ]);

  const totalImports = allJobs.length;
  const totalCollections = allJobs.reduce((s, j) => s + j.successCount, 0);
  const totalErrors = allJobs.reduce((s, j) => s + j.errorCount, 0);
  const completedJobs = allJobs.filter((j) => j.status === "COMPLETED").length;
  const successRate = totalImports > 0 ? Math.round((completedJobs / totalImports) * 100) : 0;
  const rolledBackCount = allJobs.filter((j) => j.rolledBack).length;

  // Monthly breakdown for last 6 months
  const now = new Date();
  const monthly: Record<string, { imports: number; collections: number; errors: number }> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly[key] = { imports: 0, collections: 0, errors: 0 };
  }
  for (const job of allJobs) {
    const d = new Date(job.createdAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthly[key]) {
      monthly[key].imports++;
      monthly[key].collections += job.successCount;
      monthly[key].errors += job.errorCount;
    }
  }

  const statusBreakdown = {
    COMPLETED: allJobs.filter((j) => j.status === "COMPLETED").length,
    PARTIAL: allJobs.filter((j) => j.status === "PARTIAL").length,
    FAILED: allJobs.filter((j) => j.status === "FAILED").length,
  };

  return json({
    stats: { totalImports, totalCollections, totalErrors, successRate, rolledBackCount },
    statusBreakdown,
    monthly,
    recentJobs,
  });
}

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info"> = {
  COMPLETED: "success",
  PARTIAL: "warning",
  FAILED: "critical",
  RUNNING: "info",
  PENDING: "info",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HistoryPage() {
  const { stats, statusBreakdown, monthly, recentJobs } = useLoaderData<typeof loader>();

  const statCards = [
    { label: "Total Imports", value: stats.totalImports },
    { label: "Collections Created", value: stats.totalCollections },
    { label: "Success Rate", value: `${stats.successRate}%` },
    { label: "Total Errors", value: stats.totalErrors },
    { label: "Rolled Back", value: stats.rolledBackCount },
  ];

  const maxCollections = Math.max(...Object.values(monthly).map((m) => m.collections), 1);

  return (
    <Page
      title="Import History"
      subtitle="Statistics and trends for all your imports"
      backAction={{ content: "Import", url: "/app/import" }}
    >
      <TitleBar title="Import History" />
      <BlockStack gap="600">

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {statCards.map(({ label, value }) => (
            <Box key={label} background="bg-surface" borderWidth="025" borderColor="border" borderRadius="300" padding="400">
              <BlockStack gap="100">
                <Text as="p" variant="headingXl" fontWeight="bold">{value}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
              </BlockStack>
            </Box>
          ))}
        </div>

        <Layout>
          <Layout.Section>
            {/* Monthly chart (bar-style) */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Collections per Month</Text>
                <Divider />
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 120 }}>
                  {Object.entries(monthly).map(([key, val]) => {
                    const [year, month] = key.split("-");
                    const label = `${MONTH_NAMES[parseInt(month) - 1]} ${year.slice(2)}`;
                    const height = Math.max(4, Math.round((val.collections / maxCollections) * 100));
                    return (
                      <div key={key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <Text as="p" variant="bodySm" tone="subdued">{val.collections}</Text>
                        <div style={{
                          width: "100%",
                          height: `${height}px`,
                          background: "var(--p-color-bg-fill-brand)",
                          borderRadius: "4px 4px 0 0",
                          minHeight: 4,
                        }} />
                        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            {/* Status breakdown */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Status Breakdown</Text>
                <Divider />
                <BlockStack gap="300">
                  {(Object.entries(statusBreakdown) as [string, number][]).map(([status, count]) => {
                    const pct = stats.totalImports > 0 ? Math.round((count / stats.totalImports) * 100) : 0;
                    return (
                      <BlockStack gap="100" key={status}>
                        <InlineStack align="space-between">
                          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                          <Text as="span" variant="bodySm">{count} ({pct}%)</Text>
                        </InlineStack>
                        <div style={{ height: 6, background: "var(--p-color-bg-surface-secondary)", borderRadius: 3 }}>
                          <div style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: status === "COMPLETED"
                              ? "var(--p-color-bg-fill-success)"
                              : status === "FAILED"
                              ? "var(--p-color-bg-fill-critical)"
                              : "var(--p-color-bg-fill-caution)",
                            borderRadius: 3,
                            transition: "width 0.3s ease",
                          }} />
                        </div>
                      </BlockStack>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Recent jobs table */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Recent Jobs</Text>
            <Divider />
            {recentJobs.length === 0 ? (
              <Text as="p" tone="subdued">No imports yet.</Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                headings={["File", "Status", "Total", "Success", "Errors", "Date", ""]}
                rows={recentJobs.map((j) => [
                  <span key={j.id} title={j.fileName} style={{ display: "block", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.rolledBack ? <s>{j.fileName}</s> : j.fileName}
                  </span>,
                  <InlineStack gap="100" key={j.id}>
                    <Badge tone={STATUS_TONE[j.status] ?? "info"}>{j.status}</Badge>
                    {j.rolledBack && <Badge tone="warning">Rolled back</Badge>}
                  </InlineStack>,
                  j.totalRows,
                  j.successCount,
                  j.errorCount,
                  new Date(j.createdAt).toLocaleDateString(),
                  <Button key={j.id} variant="plain" url={`/app/jobs/${j.id}`}>View</Button>,
                ])}
              />
            )}
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
