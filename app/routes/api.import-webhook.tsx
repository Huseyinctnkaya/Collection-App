import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { fetchGoogleSheetAsCSV } from "../services/sheets.server";
import { parseCSV } from "../services/parser.server";
import { runImport } from "../services/importer.server";

// POST /api/import-webhook
// Headers: X-Import-Key: <raw key>
// Body JSON: { shop, fileUrl, duplicateStrategy?, label? }
//
// fileUrl can be:
//   - A public CSV/XLSX URL
//   - A Google Sheets URL (https://docs.google.com/spreadsheets/d/...)

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawKey = request.headers.get("x-import-key");
  if (!rawKey) {
    return json({ error: "Missing X-Import-Key header" }, { status: 401 });
  }

  let body: { shop?: string; fileUrl?: string; duplicateStrategy?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { shop, fileUrl, duplicateStrategy = "skip", label } = body;
  if (!shop) return json({ error: "Missing field: shop" }, { status: 400 });
  if (!fileUrl) return json({ error: "Missing field: fileUrl" }, { status: 400 });

  // Validate the key against the stored hash for this shop
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const record = await prisma.importWebhookKey.findFirst({ where: { shop, keyHash } });
  if (!record) {
    return json({ error: "Invalid key for shop" }, { status: 403 });
  }

  await prisma.importWebhookKey.update({
    where: { id: record.id },
    data: { lastUsed: new Date() },
  });

  // Fetch the file
  const isSheets = fileUrl.includes("docs.google.com/spreadsheets");
  let buffer: Buffer;
  try {
    if (isSheets) {
      buffer = await fetchGoogleSheetAsCSV(fileUrl);
    } else {
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      buffer = Buffer.from(await res.arrayBuffer());
    }
  } catch (err) {
    return json({ error: `Failed to fetch file: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
  }

  const ext = isSheets ? "csv" : (fileUrl.split("?")[0].split(".").pop()?.toLowerCase() as "csv" | "xlsx" ?? "csv");
  const fileName = label ?? (isSheets ? "webhook-sheet.csv" : fileUrl.split("/").pop() ?? "webhook-import.csv");

  let parseResult;
  try {
    parseResult = await parseCSV(buffer);
  } catch (err) {
    return json({ error: `Parse error: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
  }

  const job = await prisma.importJob.create({
    data: {
      shop,
      fileName,
      fileType: ext,
      status: "PARSING",
      totalRows: parseResult.totalRows,
    },
  });

  const parseErrors = parseResult.rows.filter((r) => r.errors.length > 0);
  if (parseErrors.length > 0) {
    await prisma.importError.createMany({
      data: parseErrors.flatMap((r) =>
        r.errors.map((e) => ({ jobId: job.id, row: r.row, field: e.field, message: e.message }))
      ),
    });
  }

  const { admin } = await unauthenticated.admin(shop);
  const strategy = duplicateStrategy === "overwrite" ? "overwrite" : "skip";

  runImport({
    jobId: job.id,
    shop,
    admin,
    rows: parseResult.rows,
    useBulk: parseResult.validRows > 50,
    duplicateStrategy: strategy,
  }).catch(async (err) => {
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    console.error("Webhook import failed:", err);
  });

  return json({
    jobId: job.id,
    totalRows: parseResult.totalRows,
    validRows: parseResult.validRows,
    errorRows: parseResult.errorRows,
  }, { status: 202 });
}
