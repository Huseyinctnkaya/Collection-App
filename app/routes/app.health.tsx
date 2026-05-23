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
  Banner,
  DataTable,
  Thumbnail,
  ProgressBar,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { authenticate } from "../shopify.server";
import { PlanGate } from "../components/PlanGate";
import { COLLECTIONS_LIST } from "../graphql/mutations";
import { getCachedPlan } from "../services/plan.server";

interface CollectionNode {
  id: string;
  title: string;
  handle: string;
  updatedAt: string;
  image: { src: string; altText: string | null } | null;
  productsCount: { count: number };
  ruleSet: { rules: unknown[] } | null;
  seo: { title: string | null; description: string | null } | null;
}

interface HealthIssue {
  type: "empty" | "no_image" | "no_seo" | "no_seo_description";
  label: string;
  severity: "critical" | "warning" | "info";
}

interface HealthResult {
  collection: CollectionNode;
  issues: HealthIssue[];
  score: number; // 0-100
}

function analyzeCollection(c: CollectionNode): HealthResult {
  const issues: HealthIssue[] = [];
  const isSmartCollection = c.ruleSet && c.ruleSet.rules.length > 0;

  if (c.productsCount.count === 0 && !isSmartCollection) {
    issues.push({ type: "empty", label: "No products", severity: "critical" });
  }

  if (!c.image) {
    issues.push({ type: "no_image", label: "No image", severity: "warning" });
  }

  if (!c.seo?.title) {
    issues.push({ type: "no_seo", label: "No SEO title", severity: "warning" });
  }

  if (!c.seo?.description) {
    issues.push({ type: "no_seo_description", label: "No SEO description", severity: "info" });
  }

  // Deduct points: critical = 40, warning = 20, info = 10
  const deductions = issues.reduce((acc, i) => {
    if (i.severity === "critical") return acc + 40;
    if (i.severity === "warning") return acc + 20;
    return acc + 10;
  }, 0);

  return { collection: c, issues, score: Math.max(0, 100 - deductions) };
}

async function fetchAllCollections(admin: AdminApiContext): Promise<CollectionNode[]> {
  const all: CollectionNode[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const variables: Record<string, unknown> = { first: 250 };
    if (cursor) variables.after = cursor;

    const res = await admin.graphql(COLLECTIONS_LIST, { variables });
    const { data } = await res.json();
    const edges: Array<{ node: CollectionNode }> = data?.collections?.edges ?? [];
    const pageInfo = data?.collections?.pageInfo ?? {};

    all.push(...edges.map((e) => e.node));
    hasMore = !!pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return all;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const currentPlan = await getCachedPlan(session.shop);

  // Return early for free plan — don't fetch all collections unnecessarily
  if (currentPlan === "free") {
    return json({ currentPlan, results: [], totalScore: 0, totalCollections: 0, criticalCount: 0, warningCount: 0, healthyCount: 0, issueSummary: { empty: 0, no_image: 0, no_seo: 0, no_seo_description: 0 } });
  }

  const collections = await fetchAllCollections(admin);
  const results = collections.map(analyzeCollection);

  const totalScore = results.length > 0
    ? Math.round(results.reduce((acc, r) => acc + r.score, 0) / results.length)
    : 100;

  const criticalCount = results.filter((r) => r.issues.some((i) => i.severity === "critical")).length;
  const warningCount = results.filter((r) => r.issues.some((i) => i.severity === "warning" && !r.issues.some((j) => j.severity === "critical"))).length;
  const healthyCount = results.filter((r) => r.issues.length === 0).length;

  const issueSummary = {
    empty: results.filter((r) => r.issues.some((i) => i.type === "empty")).length,
    no_image: results.filter((r) => r.issues.some((i) => i.type === "no_image")).length,
    no_seo: results.filter((r) => r.issues.some((i) => i.type === "no_seo")).length,
    no_seo_description: results.filter((r) => r.issues.some((i) => i.type === "no_seo_description")).length,
  };

  return json({
    currentPlan,
    results: results.sort((a, b) => a.score - b.score),
    totalScore,
    totalCollections: collections.length,
    criticalCount,
    warningCount,
    healthyCount,
    issueSummary,
  });
}

function scoreBadgeTone(score: number): "success" | "warning" | "critical" {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "critical";
}

function scoreBarTone(score: number): "success" | "critical" | "highlight" {
  if (score >= 80) return "success";
  if (score >= 50) return "highlight";
  return "critical";
}

function ScoreBadge({ score }: { score: number }) {
  const tone = scoreBadgeTone(score);
  return <Badge tone={tone}>{`${score}/100`}</Badge>;
}

export default function HealthPage() {
  const { currentPlan, results, totalScore, totalCollections, criticalCount, warningCount, healthyCount, issueSummary } =
    useLoaderData<typeof loader>();

  const rows = results.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => [
    <InlineStack key={r.collection.id} gap="200" blockAlign="center">
      <Thumbnail
        source={r.collection.image?.src ?? ""}
        alt={r.collection.image?.altText ?? r.collection.title}
        size="small"
      />
      <Text as="span" fontWeight="semibold">{r.collection.title}</Text>
    </InlineStack>,
    <Text as="span" tone="subdued">{r.collection.handle}</Text>,
    <ScoreBadge key={r.collection.id + "-score"} score={r.score} />,
    r.issues.length === 0 ? (
      <Badge key="ok" tone="success">Healthy</Badge>
    ) : (
      <InlineStack key="issues" gap="100" wrap>
        {r.issues.map((issue) => (
          <Badge
            key={issue.type}
            tone={issue.severity === "critical" ? "critical" : issue.severity === "warning" ? "warning" : "info"}
          >
            {issue.label}
          </Badge>
        ))}
      </InlineStack>
    ),
  ]);

  return (
    <Page
      title="Collection Health"
      subtitle="Scan all collections for SEO, content, and product issues"
      backAction={{ content: "Home", url: "/app" }}
    >
      <TitleBar title="Collection Health" />
      <Layout>
        <Layout.Section>
          <PlanGate
            currentPlan={currentPlan}
            requiredPlan="pro"
            featureName="Collection Health Checker"
            description="Scan all your collections for missing images, SEO issues, and empty collections. Available on Pro and Premium plans."
          >
            <BlockStack gap="500">
              {criticalCount > 0 && (
                <Banner tone="critical" title={`${criticalCount} collection(s) need immediate attention`}>
                  <Text as="p">These collections have no products and no smart rules — they appear empty to shoppers.</Text>
                </Banner>
              )}

              {/* Overall score */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <Text as="h2" variant="headingMd">Overall Health Score</Text>
                      <Text as="p" tone="subdued">{totalCollections} collections scanned</Text>
                    </BlockStack>
                    <Text as="p" variant="heading2xl" fontWeight="bold">{totalScore}<Text as="span" tone="subdued" variant="bodyMd">/100</Text></Text>
                  </InlineStack>
                  <ProgressBar progress={totalScore} tone={scoreBarTone(totalScore)} size="large" />
                </BlockStack>
              </Card>

              {/* Stat cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div style={{ display: "grid" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued" variant="bodyMd">Healthy</Text>
                      <Text as="p" variant="headingXl" fontWeight="bold">{healthyCount}</Text>
                      <Badge tone="success">No issues</Badge>
                    </BlockStack>
                  </Card>
                </div>
                <div style={{ display: "grid" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued" variant="bodyMd">Warnings</Text>
                      <Text as="p" variant="headingXl" fontWeight="bold">{warningCount}</Text>
                      <Badge tone="warning">Needs attention</Badge>
                    </BlockStack>
                  </Card>
                </div>
                <div style={{ display: "grid" }}>
                  <Card>
                    <BlockStack gap="200">
                      <Text as="p" tone="subdued" variant="bodyMd">Critical</Text>
                      <Text as="p" variant="headingXl" fontWeight="bold">{criticalCount}</Text>
                      <Badge tone="critical">Action required</Badge>
                    </BlockStack>
                  </Card>
                </div>
              </div>

              {/* Issue breakdown */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Issue Breakdown</Text>
                  <Divider />
                  <BlockStack gap="300">
                    {[
                      { label: "Empty collections (no products, no rules)", count: issueSummary.empty, severity: "critical" as const },
                      { label: "Missing collection image", count: issueSummary.no_image, severity: "warning" as const },
                      { label: "Missing SEO title", count: issueSummary.no_seo, severity: "warning" as const },
                      { label: "Missing SEO description", count: issueSummary.no_seo_description, severity: "info" as const },
                    ].map(({ label, count, severity }) => (
                      <InlineStack key={label} align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone={severity === "critical" ? "critical" : severity === "warning" ? "warning" : "info"}>
                            {count.toString()}
                          </Badge>
                          <Text as="span">{label}</Text>
                        </InlineStack>
                        {totalCollections > 0 && (
                          <Text as="span" tone="subdued">
                            {Math.round((count / totalCollections) * 100)}%
                          </Text>
                        )}
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Per-collection table */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Collection Details</Text>
                  <Text as="p" tone="subdued">Sorted by health score — worst first</Text>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={["Collection", "Handle", "Score", "Issues"]}
                    rows={rows}
                    hoverable
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          </PlanGate>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
