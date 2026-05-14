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
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.notificationSetting.findUnique({
    where: { shop: session.shop },
  });
  return json({ settings });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const email = (formData.get("email") as string) || null;
  const slackWebhookUrl = (formData.get("slackWebhookUrl") as string) || null;
  const notifyOnComplete = formData.get("notifyOnComplete") === "true";
  const notifyOnFail = formData.get("notifyOnFail") === "true";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Invalid email address" }, { status: 400 });
  }

  if (slackWebhookUrl && !slackWebhookUrl.startsWith("https://hooks.slack.com/")) {
    return json({ error: "Slack webhook URL must start with https://hooks.slack.com/" }, { status: 400 });
  }

  await prisma.notificationSetting.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop, email, slackWebhookUrl, notifyOnComplete, notifyOnFail },
    update: { email, slackWebhookUrl, notifyOnComplete, notifyOnFail },
  });

  return json({ saved: true });
}

export default function NotificationsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [email, setEmail] = useState(settings?.email ?? "");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState(settings?.slackWebhookUrl ?? "");
  const [notifyOnComplete, setNotifyOnComplete] = useState(settings?.notifyOnComplete ?? true);
  const [notifyOnFail, setNotifyOnFail] = useState(settings?.notifyOnFail ?? true);

  const handleNotifyOnComplete = useCallback((v: boolean) => setNotifyOnComplete(v), []);
  const handleNotifyOnFail = useCallback((v: boolean) => setNotifyOnFail(v), []);

  return (
    <Page
      title="Notification Settings"
      subtitle="Get notified when imports finish or fail"
      backAction={{ content: "Import", url: "/app/import" }}
    >
      <TitleBar title="Notifications" />
      <Layout>
        <Layout.Section>
          <Form method="post">
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
                    onChange={setEmail}
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
                    onChange={setSlackWebhookUrl}
                    placeholder="https://hooks.slack.com/services/..."
                    helpText="Create an Incoming Webhook in your Slack workspace settings"
                    autoComplete="off"
                  />
                </BlockStack>
              </Card>

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

              <Button variant="primary" submit loading={isSaving} disabled={isSaving}>
                Save Settings
              </Button>
            </BlockStack>
          </Form>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Setup Guide</Text>
              <Divider />
              <Text as="p" variant="bodyMd" fontWeight="semibold">Email</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Configure SMTP settings via environment variables:
              </Text>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm"><code>SMTP_HOST</code></Text>
                <Text as="p" variant="bodySm"><code>SMTP_PORT</code> (default: 587)</Text>
                <Text as="p" variant="bodySm"><code>SMTP_USER</code></Text>
                <Text as="p" variant="bodySm"><code>SMTP_PASS</code></Text>
                <Text as="p" variant="bodySm"><code>SMTP_FROM</code> (optional)</Text>
              </BlockStack>
              <Divider />
              <Text as="p" variant="bodyMd" fontWeight="semibold">Slack</Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Go to your Slack workspace → Settings → Integrations → Incoming Webhooks → Add New Webhook.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
