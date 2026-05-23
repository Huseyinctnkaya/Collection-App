import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { PlanName } from "../services/plan.shared";

function planFromSubscriptionName(name: string): PlanName {
  const lower = name.toLowerCase();
  if (lower.includes("premium")) return "premium";
  if (lower.includes("pro")) return "pro";
  return "free";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // payload shape: { app_subscription: { id, name, status } }
  const sub = payload?.app_subscription as { id: string; name: string; status: string } | undefined;
  if (!sub) return new Response();

  const status = sub.status?.toUpperCase();

  if (status === "ACTIVE") {
    const plan = planFromSubscriptionName(sub.name);
    await db.shopPlan.upsert({
      where: { shop },
      create: { shop, plan, subscriptionId: sub.id },
      update: { plan, subscriptionId: sub.id },
    });
  } else if (status === "CANCELLED" || status === "DECLINED" || status === "EXPIRED") {
    await db.shopPlan.upsert({
      where: { shop },
      create: { shop, plan: "free", subscriptionId: null },
      update: { plan: "free", subscriptionId: null },
    });
  }

  return new Response();
};
