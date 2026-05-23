import { BlockStack, Button, Card, Icon, InlineStack, Text } from "@shopify/polaris";
import { LockIcon } from "@shopify/polaris-icons";
import type { PlanName } from "../services/plan.shared";

interface PlanGateProps {
  currentPlan: PlanName;
  requiredPlan: PlanName;
  featureName: string;
  description?: string;
  children: React.ReactNode;
}

const PLAN_RANK: Record<PlanName, number> = { free: 0, pro: 1, premium: 2 };

export function hasAccess(current: PlanName, required: PlanName): boolean {
  return PLAN_RANK[current] >= PLAN_RANK[required];
}

export function PlanGate({ currentPlan, requiredPlan, featureName, description, children }: PlanGateProps) {
  if (hasAccess(currentPlan, requiredPlan)) return <>{children}</>;

  const planLabel = requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1);

  return (
    <Card>
      <BlockStack gap="400" inlineAlign="center">
        <div style={{ textAlign: "center", padding: "32px 24px" }}>
          <BlockStack gap="400" inlineAlign="center">
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, #e3e8ff 0%, #c7d2fe 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto",
            }}>
              <div style={{ color: "#4f46e5" }}>
                <Icon source={LockIcon} />
              </div>
            </div>
            <BlockStack gap="200" inlineAlign="center">
              <Text as="h2" variant="headingLg" fontWeight="bold">{featureName}</Text>
              <Text as="p" tone="subdued" variant="bodyMd">
                {description ?? `This feature is available on the ${planLabel} plan and above.`}
              </Text>
            </BlockStack>
            <InlineStack gap="300">
              <Button variant="primary" url="/app/plan">
                Upgrade to {planLabel}
              </Button>
              <Button variant="plain" url="/app/plan">View all plans</Button>
            </InlineStack>
          </BlockStack>
        </div>
      </BlockStack>
    </Card>
  );
}
