import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Delete all shop data 48 days after uninstall as required by Shopify.
  await Promise.all([
    db.session.deleteMany({ where: { shop } }),
    db.shopPlan.deleteMany({ where: { shop } }),
    db.notificationSetting.deleteMany({ where: { shop } }),
    db.importWebhookKey.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
