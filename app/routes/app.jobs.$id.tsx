import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const job = await prisma.importJob.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { errors: { orderBy: { row: "asc" } } },
  });

  if (!job) {
    return json({ error: "Job not found" }, { status: 404 });
  }

  return json({ job });
}
