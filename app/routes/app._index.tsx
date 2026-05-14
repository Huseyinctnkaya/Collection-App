import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Box,
  List,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Collection Importer" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">
                  Bulk Collection Import
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Upload a CSV or Excel file to create hundreds of Shopify
                  collections at once — with descriptions, images, smart rules,
                  and product assignments.
                </Text>
                <InlineStack gap="300">
                  <Button
                    variant="primary"
                    onClick={() => navigate("/app/import")}
                  >
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
                  <Text as="h2" variant="headingMd">
                    How it works
                  </Text>
                  <List type="number">
                    <List.Item>Download the sample CSV template</List.Item>
                    <List.Item>Fill in your collection data</List.Item>
                    <List.Item>Upload the file on the Import page</List.Item>
                    <List.Item>Track progress in real time</List.Item>
                  </List>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Supported formats
                  </Text>
                  <BlockStack gap="100">
                    <InlineStack gap="200" align="start">
                      <Box background="bg-fill-success" borderRadius="100" padding="050">
                        <Text as="span" variant="bodySm" tone="text-inverse-on-bg-fill">CSV</Text>
                      </Box>
                      <Text as="span" variant="bodyMd">Comma-separated values</Text>
                    </InlineStack>
                    <InlineStack gap="200" align="start">
                      <Box background="bg-fill-success" borderRadius="100" padding="050">
                        <Text as="span" variant="bodySm" tone="text-inverse-on-bg-fill">XLSX</Text>
                      </Box>
                      <Text as="span" variant="bodyMd">Excel workbook</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Limits
                  </Text>
                  <List>
                    <List.Item>Up to 10 MB per file</List.Item>
                    <List.Item>
                      1–49 rows: standard batch (instant feedback)
                    </List.Item>
                    <List.Item>
                      50+ rows: Shopify Bulk API (async, no rate limits)
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
