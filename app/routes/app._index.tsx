import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
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
  Box,
  Icon,
} from "@shopify/polaris";
import {
  ImportIcon,
  CollectionIcon,
  AlertCircleIcon,
  ClockIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page
      title="Collection Importer"
      subtitle="Bulk-create Shopify collections from a CSV or Excel file"
      primaryAction={{
        content: "Start Import",
        onAction: () => navigate("/app/import"),
      }}
    >
      <TitleBar title="Collection Importer" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  How it works
                </Text>
                <Badge tone="success">Ready to use</Badge>
              </InlineStack>
              <Divider />
              <InlineStack gap="600" wrap>
                {[
                  { step: "1", title: "Download template", desc: "Get the sample CSV file and fill in your collection data" },
                  { step: "2", title: "Upload your file", desc: "Drag and drop a .csv or .xlsx file — up to 10 MB" },
                  { step: "3", title: "Validate & import", desc: "We check every row before sending to Shopify" },
                  { step: "4", title: "Done", desc: "Collections appear live in your store instantly" },
                ].map(({ step, title, desc }) => (
                  <BlockStack gap="150" key={step}>
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: "var(--p-color-bg-fill-brand)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                        fontWeight: 700, fontSize: 13,
                        color: "var(--p-color-text-brand-on-bg-fill)",
                      }}>
                        {step}
                      </div>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {title}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      {desc}
                    </Text>
                  </BlockStack>
                ))}
              </InlineStack>
              <Divider />
              <InlineStack align="end">
                <Button variant="primary" onClick={() => navigate("/app/import")}>
                  Go to Import
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ImportIcon} tone="base" />
                  <Text as="h3" variant="headingMd">CSV & Excel</Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Upload <strong>.csv</strong> or <strong>.xlsx</strong> files. Use the column headers from the template — title, handle, description, image_url, products, rules.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CollectionIcon} tone="base" />
                  <Text as="h3" variant="headingMd">Smart & Manual</Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Create <strong>manual collections</strong> with product handles, or <strong>smart collections</strong> using tag/vendor/type rules.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ClockIcon} tone="base" />
                  <Text as="h3" variant="headingMd">Bulk API</Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Imports with <strong>50+ rows</strong> run via Shopify's Bulk Operations API — no rate limits, processes in the background.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={AlertCircleIcon} tone="base" />
                  <Text as="h3" variant="headingMd">Validation</Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Every row is validated before import. Errors are shown per-row with the exact field and reason.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
