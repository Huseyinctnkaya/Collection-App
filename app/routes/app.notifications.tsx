import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  Divider,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { TitleBar, SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { authenticate } from "../shopify.server";
import { PlanGate } from "../components/PlanGate";
import prisma from "../db.server";
import { getCachedPlan } from "../services/plan.server";
import { sendEmail } from "../services/notify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const [settings, currentPlan] = await Promise.all([
    prisma.notificationSetting.findUnique({ where: { shop: session.shop } }),
    getCachedPlan(session.shop),
  ]);
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return json({ settings, currentPlan, smtpConfigured });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "test-email") {
    const email = formData.get("email") as string;
    if (!email) return json({ error: "Enter an email address first" }, { status: 400 });
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (!smtpConfigured) return json({ error: "SMTP is not configured on the server" }, { status: 400 });

    await sendEmail(email, "✅ Test email from Collection Studio", "Email notifications are working correctly.");
    return json({ tested: true });
  }

  const email = (formData.get("email") as string) || null;
  const slackWebhookUrl = (formData.get("slackWebhookUrl") as string) || null;
  const flowWebhookUrl = (formData.get("flowWebhookUrl") as string) || null;
  const notifyOnComplete = formData.get("notifyOnComplete") === "true";
  const notifyOnFail = formData.get("notifyOnFail") === "true";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Invalid email address" }, { status: 400 });
  }

  if (slackWebhookUrl && !slackWebhookUrl.startsWith("https://hooks.slack.com/")) {
    return json({ error: "Slack webhook URL must start with https://hooks.slack.com/" }, { status: 400 });
  }

  if (flowWebhookUrl && !flowWebhookUrl.startsWith("https://")) {
    return json({ error: "Flow webhook URL must start with https://" }, { status: 400 });
  }

  await prisma.notificationSetting.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, email, slackWebhookUrl, flowWebhookUrl, notifyOnComplete, notifyOnFail },
    update: { email, slackWebhookUrl, flowWebhookUrl, notifyOnComplete, notifyOnFail },
  });

  return json({ saved: true });
}

export default function NotificationsPage() {
  const { settings, currentPlan, smtpConfigured } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);

  const initialEmail = settings?.email ?? "";
  const initialSlack = settings?.slackWebhookUrl ?? "";
  const initialFlow = settings?.flowWebhookUrl ?? "";
  const initialNotifyOnComplete = settings?.notifyOnComplete ?? true;
  const initialNotifyOnFail = settings?.notifyOnFail ?? true;

  const [email, setEmail] = useState(initialEmail);
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(initialSlack);
  const [flowWebhookUrl, setFlowWebhookUrl] = useState(initialFlow);
  const [notifyOnComplete, setNotifyOnComplete] = useState(initialNotifyOnComplete);
  const [notifyOnFail, setNotifyOnFail] = useState(initialNotifyOnFail);

  useEffect(() => {
    if (actionData && "saved" in actionData) {
      shopify.saveBar.hide("notifications-save-bar");
    }
  }, [actionData, shopify]);

  const markDirty = useCallback(() => shopify.saveBar.show("notifications-save-bar"), [shopify]);

  const handleDiscard = useCallback(() => {
    setEmail(initialEmail);
    setSlackWebhookUrl(initialSlack);
    setFlowWebhookUrl(initialFlow);
    setNotifyOnComplete(initialNotifyOnComplete);
    setNotifyOnFail(initialNotifyOnFail);
    shopify.saveBar.hide("notifications-save-bar");
  }, [initialEmail, initialSlack, initialFlow, initialNotifyOnComplete, initialNotifyOnFail, shopify]);

  const handleNotifyOnComplete = useCallback((v: boolean) => { setNotifyOnComplete(v); markDirty(); }, [markDirty]);
  const handleNotifyOnFail = useCallback((v: boolean) => { setNotifyOnFail(v); markDirty(); }, [markDirty]);

  return (
    <Page
      title="Notification Settings"
      subtitle="Get notified when imports finish or fail"
      backAction={{ content: "Import", url: "/app/import" }}
    >
      <TitleBar title="Notifications" />
      <SaveBar id="notifications-save-bar">
        <button variant="primary" onClick={() => formRef.current?.submit()}>Save</button>
        <button onClick={handleDiscard}>Discard</button>
      </SaveBar>
      <Layout>
        <Layout.Section>
          <Form method="post" ref={formRef}>
            <input type="hidden" name="notifyOnComplete" value={String(notifyOnComplete)} />
            <input type="hidden" name="notifyOnFail" value={String(notifyOnFail)} />

            <BlockStack gap="500">
              {"error" in (actionData ?? {}) && (
                <Banner tone="critical">
                  <p>{(actionData as { error: string }).error}</p>
                </Banner>
              )}

              {"saved" in (actionData ?? {}) && (
                <Banner tone="success">
                  <p>Settings saved successfully.</p>
                </Banner>
              )}

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Email Notifications</Text>
                  <Divider />
                  <TextField
                    label="Email address"
                    type="email"
                    name="email"
                    value={email}
                    onChange={(v) => { setEmail(v); markDirty(); }}
                    helpText="Leave blank to disable email notifications"
                    autoComplete="email"
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Slack Notifications</Text>
                    <Badge tone="info">Incoming Webhook</Badge>
                  </InlineStack>
                  <Divider />
                  <TextField
                    label="Slack webhook URL"
                    name="slackWebhookUrl"
                    value={slackWebhookUrl}
                    onChange={(v) => { setSlackWebhookUrl(v); markDirty(); }}
                    placeholder="https://hooks.slack.com/services/..."
                    helpText="Create an Incoming Webhook in your Slack workspace settings"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

              <PlanGate
                currentPlan={currentPlan}
                requiredPlan="pro"
                featureName="Flow / Automation Webhook"
                description="Send a POST request to any automation platform when an import finishes. Available on Pro and Premium plans."
              >
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Shopify Flow / Automation Webhook</Text>
                      <Badge tone="info">POST on finish</Badge>
                    </InlineStack>
                    <Divider />
                    <TextField
                      label="Webhook URL"
                      name="flowWebhookUrl"
                      value={flowWebhookUrl}
                      onChange={(v) => { setFlowWebhookUrl(v); markDirty(); }}
                      placeholder="https://your-flow-endpoint.com/webhook"
                      helpText="A POST request with import summary JSON will be sent here when an import finishes. Works with Shopify Flow 'Receive webhook', Make, Zapier, or any HTTP trigger."
                      autoComplete="off"
                    />
                  </BlockStack>
                </Card>
              </PlanGate>

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">When to Notify</Text>
                  <Divider />
                  <Checkbox
                    label="Notify on successful import (Completed or Partial)"
                    checked={notifyOnComplete}
                    onChange={handleNotifyOnComplete}
                  />
                  <Checkbox
                    label="Notify on failed import"
                    checked={notifyOnFail}
                    onChange={handleNotifyOnFail}
                  />
                </BlockStack>
              </Card>

            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Email Status</Text>
                <Divider />
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={smtpConfigured ? "success" : "critical"}>
                    {smtpConfigured ? "SMTP Configured" : "SMTP Not Configured"}
                  </Badge>
                </InlineStack>
                {smtpConfigured && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="test-email" />
                    <input type="hidden" name="email" value={email} />
                    <Button submit disabled={!email || isSaving}>
                      Send Test Email
                    </Button>
                  </Form>
                )}
                {"tested" in (actionData ?? {}) && (
                  <Banner tone="success"><p>Test email sent!</p></Banner>
                )}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Slack Setup</Text>
                <Divider />
                <Text as="p" tone="subdued" variant="bodySm">
                  Go to your Slack workspace → Settings → Integrations → Incoming Webhooks → Add New Webhook.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
