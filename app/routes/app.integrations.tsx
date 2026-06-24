import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import crypto from "node:crypto";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const record = await prisma.importWebhookKey.findUnique({ where: { shop: session.shop } });
  return json({
    hasKey: !!record,
    lastUsed: record?.lastUsed?.toISOString() ?? null,
    createdAt: record?.createdAt?.toISOString() ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "generate") {
    const rawKey = crypto.randomBytes(32).toString("hex"); // 64-char hex
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    await prisma.importWebhookKey.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, keyHash },
      update: { keyHash, lastUsed: null, createdAt: new Date() },
    });

    return json({ generated: true, rawKey });
  }

  if (intent === "revoke") {
    await prisma.importWebhookKey.deleteMany({ where: { shop: session.shop } });
    return json({ revoked: true });
  }

  return json({ error: "Unknown intent" }, { status: 400 });
}

export default function IntegrationsPage() {
  const { hasKey, lastUsed, createdAt } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isBusy = navigation.state === "submitting";

  const newKey = actionData && "rawKey" in actionData ? (actionData as { rawKey: string }).rawKey : null;
  const revoked = actionData && "revoked" in actionData;

  const currentlyHasKey = newKey ? true : revoked ? false : hasKey;

  return (
    <Page
      title="Integrations"
      subtitle="Connect external systems to Collection Studio"
      backAction={{ content: "Home", url: "/app" }}
    >
      <TitleBar title="Integrations" />
      <Layout>
        {/* External Webhook Trigger */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">External Webhook Trigger</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Allow any external system to start an import by sending a POST request.
                  </Text>
                </BlockStack>
                <Badge tone={currentlyHasKey ? "success" : "new"}>
                  {currentlyHasKey ? "Active" : "Not configured"}
                </Badge>
              </InlineStack>
              <Divider />

              {newKey && (
                <Banner tone="success" title="New key generated — copy it now">
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued" variant="bodySm">
                      This key is shown only once. Store it securely.
                    </Text>
                    <Box
                      background="bg-surface-secondary"
                      padding="300"
                      borderRadius="200"
                    >
                      <Text as="p" variant="bodyMd" fontWeight="bold" breakWord>
                        {newKey}
                      </Text>
                    </Box>
                  </BlockStack>
                </Banner>
              )}

              {currentlyHasKey && !newKey && (
                <BlockStack gap="200">
                  <InlineStack gap="400">
                    {createdAt && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        Created: {new Date(createdAt).toLocaleDateString()}
                      </Text>
                    )}
                    {lastUsed && (
                      <Text as="span" variant="bodySm" tone="subdued">
                        Last used: {new Date(lastUsed).toLocaleDateString()}
                      </Text>
                    )}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Key is active. Regenerating will invalidate the current key immediately.
                  </Text>
                </BlockStack>
              )}

              <InlineStack gap="300">
                <Form method="post">
                  <input type="hidden" name="intent" value="generate" />
                  <Button variant="primary" submit loading={isBusy} disabled={isBusy}>
                    {currentlyHasKey ? "Regenerate Key" : "Generate Key"}
                  </Button>
                </Form>
                {currentlyHasKey && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="revoke" />
                    <Button tone="critical" submit loading={isBusy} disabled={isBusy}>
                      Revoke Key
                    </Button>
                  </Form>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* API reference */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">API Reference</Text>
              <Divider />
              <Text as="p" variant="bodySm" fontWeight="semibold">Endpoint</Text>
              <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                <Text as="p" variant="bodySm" fontWeight="bold">POST /api/import-webhook</Text>
              </Box>
              <Text as="p" variant="bodySm" fontWeight="semibold">Headers</Text>
              <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">Content-Type: application/json</Text>
                  <Text as="p" variant="bodySm">X-Import-Key: {"<your-key>"}</Text>
                </BlockStack>
              </Box>
              <Text as="p" variant="bodySm" fontWeight="semibold">Body</Text>
              <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">{"{"}</Text>
                  <Text as="p" variant="bodySm">{"  \"shop\": \"my-store.myshopify.com\","}</Text>
                  <Text as="p" variant="bodySm">{"  \"fileUrl\": \"https://...\" | \"https://docs.google.com/...\","}</Text>
                  <Text as="p" variant="bodySm">{"  \"duplicateStrategy\": \"skip\" | \"overwrite\","}</Text>
                  <Text as="p" variant="bodySm">{"  \"label\": \"My Import\" (optional)"}</Text>
                  <Text as="p" variant="bodySm">{"}"}</Text>
                </BlockStack>
              </Box>
              <Text as="p" variant="bodySm" fontWeight="semibold">Response (202)</Text>
              <Box background="bg-surface-secondary" padding="200" borderRadius="200">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm">{"{ jobId, totalRows, validRows, errorRows }"}</Text>
                </BlockStack>
              </Box>
              <Text as="p" tone="subdued" variant="bodySm">
                The fileUrl can be a public CSV/XLSX URL or a public Google Sheets URL.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
