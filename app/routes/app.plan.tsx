import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Form } from "@remix-run/react";
import { useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Divider,
  Banner,
  Icon,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { PLANS, type PlanName } from "../services/plan.shared";
import { APP_SUBSCRIPTION_CREATE, APP_SUBSCRIPTION_CANCEL, CURRENT_APP_SUBSCRIPTION } from "../graphql/mutations";

const PLAN_ORDER: PlanName[] = ["free", "pro", "premium"];

const PLAN_FEATURES: Record<PlanName, string[]> = {
  free: [
    "Up to 100 rows per import",
    "2 imports per month",
    "CSV files only",
    "Basic import history",
    "Community support",
  ],
  pro: [
    "Up to 2,000 rows per import",
    "50 imports per month",
    "CSV + Excel files",
    "Google Sheets import",
    "5 scheduled imports",
    "Bulk operations",
    "Rollback imports",
    "Collection Health Checker",
    "Email + Slack notifications",
    "Shopify Flow webhook",
    "Priority email support",
  ],
  premium: [
    "Unlimited rows per import",
    "Unlimited imports",
    "CSV + Excel + Google Sheets",
    "Unlimited scheduled imports",
    "Bulk operations",
    "Rollback imports",
    "Collection Health Checker",
    "All notifications (+ Flow webhook)",
    "External webhook trigger API",
    "API key management",
    "Priority support + onboarding",
  ],
};

const PLAN_BADGES: Partial<Record<PlanName, { label: string; tone: "success" | "warning" | "info" }>> = {
  pro: { label: "Most Popular", tone: "success" },
  premium: { label: "Best Value", tone: "warning" },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const activated = url.searchParams.get("activated");

  // Single Shopify API call — fetch subscriptions and derive plan
  let currentPlan: PlanName = "free";
  let subscriptionId: string | null = null;

  try {
    const subRes = await admin.graphql(CURRENT_APP_SUBSCRIPTION);
    const { data } = await subRes.json();
    const subs: Array<{ id: string; name: string; status: string }> =
      data?.currentAppInstallation?.activeSubscriptions ?? [];

    const activeSub = subs.find((s) => s.status === "ACTIVE");
    subscriptionId = activeSub?.id ?? null;

    if (activeSub) {
      const lower = activeSub.name.toLowerCase();
      currentPlan = lower.includes("premium") ? "premium" : lower.includes("pro") ? "pro" : "free";
    }

    // Sync cache
    await import("../db.server").then(({ default: prisma }) =>
      prisma.shopPlan.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, plan: currentPlan, subscriptionId },
        update: { plan: currentPlan, subscriptionId },
      })
    );
  } catch (err) {
    console.error("Failed to fetch subscription from Shopify:", err);
    // Fall back to cached value
    currentPlan = await import("../services/plan.server").then((m) =>
      m.getCachedPlan(session.shop)
    );
  }

  return json({
    currentPlan,
    subscriptionId,
    activated: activated === "true",
    shop: session.shop,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "subscribe") {
    const plan = formData.get("plan") as PlanName;
    const planDef = PLANS[plan];
    if (!planDef || plan === "free") return json({ error: "Invalid plan" }, { status: 400 });

    const appUrl = process.env.SHOPIFY_APP_URL ?? `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}`;
    const returnUrl = `${appUrl}/app/plan?activated=true`;

    const res = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
      variables: {
        name: `Collection Studio ${planDef.label}`,
        returnUrl,
        test: process.env.NODE_ENV !== "production",
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: planDef.price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    });

    const { data } = await res.json();
    const errors = data?.appSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) return json({ error: errors[0].message }, { status: 422 });

    const confirmationUrl = data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) return json({ error: "Failed to create subscription" }, { status: 500 });

    // Return the URL to the client — the component uses window.top.location.href
    // because server-side redirect() can't break out of the Shopify embedded app iframe
    return json({ confirmationUrl });
  }

  if (intent === "cancel") {
    const subscriptionId = formData.get("subscriptionId") as string;
    if (!subscriptionId) return json({ error: "No active subscription" }, { status: 400 });

    await admin.graphql(APP_SUBSCRIPTION_CANCEL, { variables: { id: subscriptionId } });
    // Clear the cached plan back to free
    const prisma = (await import("../db.server")).default;
    await prisma.shopPlan.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, plan: "free", subscriptionId: null },
      update: { plan: "free", subscriptionId: null },
    });
    return redirect("/app/plan");
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

function CheckItem({ text }: { text: string }) {
  return (
    <InlineStack gap="200" blockAlign="start" wrap={false}>
      <div style={{ color: "#008060", flexShrink: 0, marginTop: 2 }}>
        <Icon source={CheckIcon} />
      </div>
      <Text as="span" variant="bodyMd">{text}</Text>
    </InlineStack>
  );
}

export default function PlanPage() {
  const { currentPlan, subscriptionId, activated } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  // Which plan button is currently submitting
  const submittingPlan = navigation.state !== "idle"
    ? (navigation.formData?.get("plan") as string | null)
    : null;
  const submittingIntent = navigation.state !== "idle"
    ? (navigation.formData?.get("intent") as string | null)
    : null;

  // Redirect to Shopify billing confirmation page — must use window.top to break out of iframe
  useEffect(() => {
    if (actionData && "confirmationUrl" in actionData) {
      window.top!.location.href = (actionData as { confirmationUrl: string }).confirmationUrl;
    }
  }, [actionData]);

  return (
    <Page
      title="Plans & Billing"
      subtitle="Choose the right plan for your store"
      backAction={{ content: "Home", url: "/app" }}
    >
      <TitleBar title="Plans & Billing" />
      <Layout>
        {activated && (
          <Layout.Section>
            <Banner tone="success" title="Plan activated successfully!">
              <Text as="p">Your new plan is now active. All features are unlocked immediately.</Text>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            {PLAN_ORDER.map((planKey) => {
              const planDef = PLANS[planKey];
              const features = PLAN_FEATURES[planKey];
              const badge = PLAN_BADGES[planKey];
              const isCurrent = currentPlan === planKey;
              const isUpgrade = PLAN_ORDER.indexOf(planKey) > PLAN_ORDER.indexOf(currentPlan);
              const isDowngrade = PLAN_ORDER.indexOf(planKey) < PLAN_ORDER.indexOf(currentPlan);

              return (
                <div
                  key={planKey}
                  style={{
                    display: "grid",
                    borderRadius: 16,
                    border: isCurrent
                      ? "2px solid #008060"
                      : planKey === "pro"
                        ? "2px solid #005bd3"
                        : "1px solid #e1e3e5",
                    overflow: "hidden",
                    boxShadow: planKey === "pro"
                      ? "0 8px 24px rgba(0,91,211,0.15)"
                      : "0 2px 8px rgba(0,0,0,0.06)",
                    position: "relative",
                  }}
                >
                  {/* Header */}
                  <div style={{
                    background: planKey === "premium"
                      ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)"
                      : planKey === "pro"
                        ? "linear-gradient(135deg, #005bd3 0%, #0070f3 100%)"
                        : "#f6f6f7",
                    padding: "28px 24px 24px",
                    color: planKey === "free" ? "#1a1a1a" : "#fff",
                  }}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingLg" fontWeight="bold">
                          {planDef.label}
                        </Text>
                        {badge && (
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        )}
                        {isCurrent && (
                          <Badge tone="success">Current Plan</Badge>
                        )}
                      </InlineStack>
                      <InlineStack gap="100" blockAlign="end">
                        <Text
                          as="p"
                          variant="heading2xl"
                          fontWeight="bold"
                        >
                          {planDef.price === 0 ? "Free" : `$${planDef.price}`}
                        </Text>
                        {planDef.price > 0 && (
                          <Text as="p" variant="bodyMd">
                            / month
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </div>

                  {/* Features */}
                  <div style={{ background: "#fff", padding: "24px", flex: 1 }}>
                    <BlockStack gap="300">
                      {features.map((f) => (
                        <CheckItem key={f} text={f} />
                      ))}
                    </BlockStack>
                  </div>

                  {/* CTA */}
                  <div style={{ background: "#fff", padding: "0 24px 24px" }}>
                    <Divider />
                    <div style={{ paddingTop: 20 }}>
                      {isCurrent ? (
                        planKey !== "free" && subscriptionId ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="cancel" />
                            <input type="hidden" name="plan" value={planKey} />
                            <input type="hidden" name="subscriptionId" value={subscriptionId} />
                            <Button
                              fullWidth
                              variant="plain"
                              tone="critical"
                              submit
                              loading={submittingIntent === "cancel" && submittingPlan === planKey}
                              disabled={submittingIntent !== null}
                            >
                              Cancel Plan
                            </Button>
                          </Form>
                        ) : (
                          <Button fullWidth disabled>Current Plan</Button>
                        )
                      ) : isUpgrade ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="subscribe" />
                          <input type="hidden" name="plan" value={planKey} />
                          <Button
                            fullWidth
                            variant="primary"
                            submit
                            loading={submittingIntent === "subscribe" && submittingPlan === planKey}
                            disabled={submittingIntent !== null}
                          >
                            Upgrade to {planDef.label}
                          </Button>
                        </Form>
                      ) : isDowngrade ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="subscribe" />
                          <input type="hidden" name="plan" value={planKey} />
                          <Button
                            fullWidth
                            submit
                            loading={submittingIntent === "subscribe" && submittingPlan === planKey}
                            disabled={submittingIntent !== null || planKey === "free"}
                          >
                            {planKey === "free" ? "Cancel to downgrade" : `Downgrade to ${planDef.label}`}
                          </Button>
                        </Form>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Layout.Section>

        {/* Feature comparison table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Feature Comparison</Text>
              <Divider />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e1e3e5" }}>
                      <th style={{ textAlign: "left", padding: "10px 16px", fontWeight: 600 }}>Feature</th>
                      {PLAN_ORDER.map((p) => (
                        <th
                          key={p}
                          style={{
                            textAlign: "center",
                            padding: "10px 16px",
                            fontWeight: 600,
                            color: currentPlan === p ? "#008060" : undefined,
                          }}
                        >
                          {PLANS[p].label}
                          {currentPlan === p && " ✓"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Rows per import", values: ["100", "2,000", "Unlimited"] },
                      { label: "Imports per month", values: ["2", "50", "Unlimited"] },
                      { label: "Excel (.xlsx) support", values: ["—", "✓", "✓"] },
                      { label: "Google Sheets import", values: ["—", "✓", "✓"] },
                      { label: "Scheduled imports", values: ["—", "5", "Unlimited"] },
                      { label: "Bulk operations (50+)", values: ["—", "✓", "✓"] },
                      { label: "Rollback imports", values: ["—", "✓", "✓"] },
                      { label: "Health Checker", values: ["—", "✓", "✓"] },
                      { label: "Shopify Flow webhook", values: ["—", "✓", "✓"] },
                      { label: "External webhook API", values: ["—", "—", "✓"] },
                      { label: "Support", values: ["Community", "Priority Email", "Priority + Onboarding"] },
                    ].map((row, i) => (
                      <tr key={row.label} style={{ background: i % 2 === 0 ? "#f9fafb" : "#fff", borderBottom: "1px solid #e1e3e5" }}>
                        <td style={{ padding: "12px 16px", fontWeight: 500 }}>{row.label}</td>
                        {row.values.map((val, vi) => (
                          <td
                            key={vi}
                            style={{
                              textAlign: "center",
                              padding: "12px 16px",
                              color: val === "—" ? "#8c9196" : val === "✓" ? "#008060" : undefined,
                              fontWeight: val === "✓" ? 600 : undefined,
                            }}
                          >
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* FAQ */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Frequently Asked Questions</Text>
              <Divider />
              {[
                {
                  q: "Can I change my plan at any time?",
                  a: "Yes. Upgrades take effect immediately. When you cancel a paid plan, you revert to Free at the end of the billing cycle.",
                },
                {
                  q: "Are charges prorated?",
                  a: "Shopify handles prorations automatically when you upgrade or downgrade mid-cycle.",
                },
                {
                  q: "What happens to my data if I downgrade?",
                  a: "All your import history and settings are preserved. You simply lose access to premium features going forward.",
                },
                {
                  q: "Is there a trial period?",
                  a: "During development mode, all subscriptions are in test mode and no real charge is made. Contact us for trial options.",
                },
              ].map(({ q, a }) => (
                <BlockStack key={q} gap="100">
                  <Text as="p" fontWeight="semibold">{q}</Text>
                  <Text as="p" tone="subdued">{a}</Text>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
