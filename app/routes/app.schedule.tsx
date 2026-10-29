import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Scheduling now lives on the import page alongside the other import flows.
 * This route stays behind so bookmarks and older links land somewhere useful
 * instead of a 404.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return redirect("/app/import");
}
