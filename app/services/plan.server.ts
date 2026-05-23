import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { CURRENT_APP_SUBSCRIPTION } from "../graphql/mutations";
export type { PlanName, PlanLimits } from "./plan.shared";
export { PLANS } from "./plan.shared";
import type { PlanName, PlanLimits } from "./plan.shared";
import { PLANS } from "./plan.shared";

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
