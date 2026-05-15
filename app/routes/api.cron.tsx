import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { runDueScheduledImports } from "../services/scheduled-runner.server";

// Protect with a secret token so only authorised callers can trigger
// Set CRON_SECRET in your environment, then call:
// GET /api/cron?secret=YOUR_SECRET
export async function loader({ request }: LoaderFunctionArgs) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(request.url);
    if (url.searchParams.get("secret") !== secret) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runDueScheduledImports();
  return json({ ok: true, ...result });
}
