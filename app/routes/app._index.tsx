import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  Page,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  ImportIcon,
  CollectionIcon,
  CheckCircleIcon,
  ClockIcon,
  DataTableIcon,
  UploadIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const features = [
  {
    icon: UploadIcon,
    title: "CSV & Excel Upload",
    description:
      "Drag and drop your file. Supports .csv and .xlsx with up to 10 MB per import.",
    color: "#2563EB",
    bg: "#EFF6FF",
  },
  {
    icon: CollectionIcon,
    title: "Smart & Manual Collections",
    description:
      "Create rule-based smart collections or manual ones with product assignments in one go.",
    color: "#7C3AED",
    bg: "#F5F3FF",
  },
  {
    icon: DataTableIcon,
    title: "Validation & Error Report",
    description:
      "Every row is validated before import. Download a full error report for failed rows.",
    color: "#059669",
    bg: "#ECFDF5",
  },
  {
    icon: ClockIcon,
    title: "Bulk Operations API",
    description:
      "For 50+ collections we use Shopify's Bulk API — no rate limits, runs in the background.",
    color: "#D97706",
    bg: "#FFFBEB",
  },
];

const steps = [
  { number: "01", label: "Download sample CSV" },
  { number: "02", label: "Fill in your collections" },
  { number: "03", label: "Upload & validate" },
  { number: "04", label: "Done — live in your store" },
];

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Collection Importer" />
      <BlockStack gap="600">

        {/* ── HERO ── */}
        <Box
          borderRadius="400"
          padding="800"
          style={{
            background: "linear-gradient(135deg, #1E3A5F 0%, #2563EB 60%, #3B82F6 100%)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* decorative blobs */}
          <div style={{
            position: "absolute", top: -60, right: -60,
            width: 240, height: 240, borderRadius: "50%",
            background: "rgba(255,255,255,0.06)", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", bottom: -40, right: 120,
            width: 160, height: 160, borderRadius: "50%",
            background: "rgba(255,255,255,0.04)", pointerEvents: "none",
          }} />

          <BlockStack gap="400">
            <Box
              background="bg-fill-magic"
              borderRadius="full"
              padding="150"
              style={{ display: "inline-flex", width: "fit-content" }}
            >
              <InlineStack gap="100" align="center" blockAlign="center">
                <Icon source={ImportIcon} tone="magic" />
                <Text as="span" variant="bodySm" fontWeight="semibold" tone="magic">
                  Bulk Import Tool
                </Text>
              </InlineStack>
            </Box>

            <Text
              as="h1"
              variant="heading2xl"
              fontWeight="bold"
              tone="text-inverse"
            >
              Import Collections at Scale
            </Text>

            <div style={{ maxWidth: 520 }}>
              <Text as="p" variant="bodyLg" tone="text-inverse">
                Upload a CSV or Excel file and create hundreds of Shopify
                collections instantly — with images, smart rules, and product
                assignments included.
              </Text>
            </div>

            <InlineStack gap="300" blockAlign="center">
              <Button
                variant="primary"
                tone="success"
                size="large"
                onClick={() => navigate("/app/import")}
              >
                Start Importing
              </Button>
              <Button
                variant="plain"
                size="large"
                onClick={() => navigate("/app/import")}
              >
                <span style={{ color: "rgba(255,255,255,0.85)" }}>
                  View import history
                </span>
              </Button>
            </InlineStack>

            {/* quick stats */}
            <Box
              borderRadius="300"
              padding="400"
              style={{
                background: "rgba(255,255,255,0.10)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.15)",
                marginTop: 8,
              }}
            >
              <InlineStack gap="600" wrap={false}>
                {[
                  { value: "1,000+", label: "Collections per import" },
                  { value: "2", label: "Supported formats" },
                  { value: "0", label: "Rate limit issues" },
                ].map((stat) => (
                  <BlockStack gap="050" key={stat.label}>
                    <Text as="p" variant="headingXl" fontWeight="bold" tone="text-inverse">
                      {stat.value}
                    </Text>
                    <Text as="p" variant="bodySm" tone="text-inverse">
                      {stat.label}
                    </Text>
                  </BlockStack>
                ))}
              </InlineStack>
            </Box>
          </BlockStack>
        </Box>

        {/* ── FEATURES GRID ── */}
        <BlockStack gap="300">
          <Text as="h2" variant="headingLg" fontWeight="semibold">
            Everything you need
          </Text>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}>
            {features.map((f) => (
              <Box
                key={f.title}
                background="bg-surface"
                borderRadius="300"
                padding="500"
                shadow="100"
                borderWidth="025"
                borderColor="border-secondary"
                style={{ transition: "box-shadow 200ms" }}
              >
                <BlockStack gap="300">
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: f.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{ color: f.color }}>
                      <Icon source={f.icon} />
                    </div>
                  </div>
                  <Text as="h3" variant="headingMd" fontWeight="semibold">
                    {f.title}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {f.description}
                  </Text>
                </BlockStack>
              </Box>
            ))}
          </div>
        </BlockStack>

        {/* ── HOW IT WORKS ── */}
        <Box
          background="bg-surface-secondary"
          borderRadius="300"
          padding="600"
        >
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg" fontWeight="semibold">
              How it works
            </Text>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 16,
            }}>
              {steps.map((step, i) => (
                <Box key={step.number} style={{ position: "relative" }}>
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        background: "#2563EB", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 13, flexShrink: 0,
                      }}>
                        {step.number}
                      </div>
                      {i < steps.length - 1 && (
                        <div style={{
                          flex: 1, height: 2,
                          background: "linear-gradient(to right, #2563EB44, transparent)",
                          minWidth: 24,
                        }} />
                      )}
                    </InlineStack>
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {step.label}
                    </Text>
                  </BlockStack>
                </Box>
              ))}
            </div>
          </BlockStack>
        </Box>

        {/* ── BOTTOM CTA ── */}
        <Box
          background="bg-surface"
          borderRadius="300"
          padding="600"
          shadow="100"
          borderWidth="025"
          borderColor="border-secondary"
        >
          <InlineStack align="space-between" blockAlign="center" wrap>
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="h3" variant="headingMd" fontWeight="semibold">
                  Ready to import?
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Your CSV or Excel file is all you need to get started.
              </Text>
            </BlockStack>
            <Button
              variant="primary"
              size="large"
              onClick={() => navigate("/app/import")}
            >
              Go to Import
            </Button>
          </InlineStack>
        </Box>

      </BlockStack>
    </Page>
  );
}
