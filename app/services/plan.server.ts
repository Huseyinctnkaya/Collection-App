import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { CURRENT_APP_SUBSCRIPTION } from "../graphql/mutations";

export type PlanName = "free" | "pro" | "premium";

export interface PlanLimits {
  maxRowsPerImport: number;        // -1 = unlimited
  maxImportsPerMonth: number;      // -1 = unlimited
  maxScheduledImports: number;     // -1 = unlimited
  allowedFileTypes: string[];      // csv | xlsx
  googleSheetsEnabled: boolean;
  bulkOperationsEnabled: boolean;
  rollbackEnabled: boolean;
  externalWebhookEnabled: boolean;
  flowWebhookEnabled: boolean;
  healthCheckerEnabled: boolean;
}

export const PLANS: Record<PlanName, { label: string; price: number; limits: PlanLimits }> = {
  free: {
    label: "Free",
    price: 0,
    limits: {
      maxRowsPerImport: 100,
      maxImportsPerMonth: 5,
      maxScheduledImports: 0,
      allowedFileTypes: ["csv"],
      googleSheetsEnabled: false,
      bulkOperationsEnabled: false,
      rollbackEnabled: false,
      externalWebhookEnabled: false,
      flowWebhookEnabled: false,
      healthCheckerEnabled: false,
    },
  },
  pro: {
    label: "Pro",
    price: 9.99,
    limits: {
      maxRowsPerImport: 2000,
      maxImportsPerMonth: -1,
      maxScheduledImports: 5,
      allowedFileTypes: ["csv", "xlsx"],
      googleSheetsEnabled: true,
      bulkOperationsEnabled: true,
      rollbackEnabled: true,
      externalWebhookEnabled: false,
      flowWebhookEnabled: true,
      healthCheckerEnabled: true,
    },
  },
  premium: {
    label: "Premium",
    price: 29.99,
    limits: {
      maxRowsPerImport: -1,
      maxImportsPerMonth: -1,
      maxScheduledImports: -1,
      allowedFileTypes: ["csv", "xlsx"],
      googleSheetsEnabled: true,
      bulkOperationsEnabled: true,
      rollbackEnabled: true,
      externalWebhookEnabled: true,
      flowWebhookEnabled: true,
      healthCheckerEnabled: true,
    },
  },
};

// Resolve plan name from the active Shopify subscription name
function planNameFromSubscription(name: string): PlanName {
  const lower = name.toLowerCase();
  if (lower.includes("premium")) return "premium";
  if (lower.includes("pro")) return "pro";
  return "free";
}

// Fetch the current plan from Shopify and sync to DB cache
export async function syncAndGetPlan(admin: AdminApiContext, shop: string): Promise<PlanName> {
  const res = await admin.graphql(CURRENT_APP_SUBSCRIPTION);
  const { data } = await res.json();
  const subs: Array<{ id: string; name: string; status: string }> =
    data?.currentAppInstallation?.activeSubscriptions ?? [];

  const activeSub = subs.find((s) => s.status === "ACTIVE");
  const plan: PlanName = activeSub ? planNameFromSubscription(activeSub.name) : "free";

  await prisma.shopPlan.upsert({
    where: { shop },
    create: { shop, plan, subscriptionId: activeSub?.id ?? null },
    update: { plan, subscriptionId: activeSub?.id ?? null },
  });

  return plan;
}

// Fast cached read — use this in loaders where you don't want an extra API call
export async function getCachedPlan(shop: string): Promise<PlanName> {
  const record = await prisma.shopPlan.findUnique({ where: { shop } });
  return (record?.plan as PlanName | null) ?? "free";
}

export function getLimits(plan: PlanName): PlanLimits {
  return PLANS[plan].limits;
}

// Check how many imports the shop ran this calendar month
export async function getMonthlyImportCount(shop: string): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  return prisma.importJob.count({
    where: {
      shop,
      createdAt: { gte: startOfMonth },
      status: { not: "FAILED" },
    },
  });
}
