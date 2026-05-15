import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Divider,
  Icon,
  Box,
} from "@shopify/polaris";
import {
  ImportIcon,
  ExportIcon,
  ClockIcon,
  NotificationIcon,
  ThemeTemplateIcon,
  LanguageTranslateIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const QUICK_ACTIONS = [
  {
    icon: ImportIcon,
    title: "Import Collections",
    desc: "Upload a CSV or XLSX file to bulk-create or update collections",
    url: "/app/import",
    primary: true,
  },
  {
    icon: ExportIcon,
    title: "Export Collections",
    desc: "Download all existing collections as a CSV file",
    url: "/app/export",
    primary: false,
  },
  {
    icon: ClockIcon,
    title: "Schedule Import",
    desc: "Upload a file now and run the import at a future time",
    url: "/app/schedule",
    primary: false,
  },
  {
    icon: NotificationIcon,
    title: "Notifications",
    desc: "Get notified via email or Slack when an import finishes",
    url: "/app/notifications",
    primary: false,
  },
  {
    icon: ThemeTemplateIcon,
    title: "Import Templates",
    desc: "Save column mappings to reuse with different CSV formats",
    url: "/app/templates",
    primary: false,
  },
  {
    icon: LanguageTranslateIcon,
    title: "Multi-language",
    desc: "Add locale columns like title_fr or description_de to your CSV",
    url: "/app/import",
    primary: false,
  },
];

const STEPS = [
  { n: "1", text: "Download the CSV template" },
  { n: "2", text: "Fill in your collection data" },
  { n: "3", text: "Upload and start import" },
  { n: "4", text: "Collections go live instantly" },
];

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page title="Collection Importer" subtitle="Bulk-create Shopify collections from a CSV or Excel file">
      <TitleBar title="Collection Importer" />
      <BlockStack gap="600">

        {/* Primary CTA */}
        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Ready to import?</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Upload a file with up to thousands of collections — validated row by row.
              </Text>
            </BlockStack>
            <Button variant="primary" size="large" onClick={() => navigate("/app/import")}>
              Start Import
            </Button>
          </InlineStack>
        </Card>

        {/* Feature grid */}
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Features</Text>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "12px",
          }}>
            {QUICK_ACTIONS.map(({ icon: Src, title, desc, url }) => (
              <div
                key={title}
                onClick={() => navigate(url)}
                style={{ cursor: "pointer", height: "100%" }}
              >
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      <Box
                        background="bg-surface-secondary"
                        borderRadius="200"
                        padding="150"
                      >
                        <div style={{ width: 20, height: 20, display: "flex" }}>
                          <Icon source={Src} tone="base" />
                        </div>
                      </Box>
                      <Text as="h3" variant="headingSm">{title}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{desc}</Text>
                  </BlockStack>
                </Card>
              </div>
            ))}
          </div>
        </BlockStack>

        {/* How it works */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">How it works</Text>
            <Divider />
            <InlineStack gap="0" wrap={false}>
              {STEPS.map(({ n, text }, i) => (
                <div key={n} style={{ flex: 1, display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: "var(--p-color-bg-fill-brand)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: 13,
                    color: "var(--p-color-text-brand-on-bg-fill)",
                  }}>
                    {n}
                  </div>
                  <div style={{ paddingTop: 4, paddingRight: i < STEPS.length - 1 ? 16 : 0 }}>
                    <Text as="p" variant="bodySm">{text}</Text>
                  </div>
                </div>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

      </BlockStack>
    </Page>
  );
}
