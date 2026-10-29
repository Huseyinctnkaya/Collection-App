import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "node:crypto";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { fetchGoogleSheetAsCSV } from "../services/sheets.server";
import { fetchRemoteFile } from "../services/safe-fetch.server";
import { parseFile } from "../services/parser.server";
import { runImport } from "../services/importer.server";
import { getCachedPlan, getLimits, getMonthlyImportCount } from "../services/plan.server";

// POST /api/import-webhook
// Headers: X-Import-Key: <raw key>
// Body JSON: { shop, fileUrl, duplicateStrategy?, label?, template? }
//
// fileUrl can be:
//   - A public CSV/XLSX URL
//   - A Google Sheets URL (https://docs.google.com/spreadsheets/d/...)
//
// template is the name of a saved import template, applied the same way the
// import page applies one.

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const rawKey = request.headers.get("x-import-key");
  if (!rawKey) {
    return json({ error: "Missing X-Import-Key header" }, { status: 401 });
  }

  let body: {
    shop?: string;
    fileUrl?: string;
    duplicateStrategy?: string;
    label?: string;
    template?: string;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { shop, fileUrl, duplicateStrategy = "skip", label, template } = body;
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

  // This endpoint runs real imports, so it has to answer to the same plan
  // limits the in-app flows do. It previously enforced none of them: the
  // feature is sold as Premium-only and the row and monthly caps applied
  // everywhere else, but a key from any plan could import without limit.
  const limits = getLimits(await getCachedPlan(shop));

  if (!limits.externalWebhookEnabled) {
    return json(
      { error: "The external webhook API is available on the Premium plan.", planError: true },
      { status: 403 }
    );
  }

  if (limits.maxImportsPerMonth !== -1) {
    const used = await getMonthlyImportCount(shop);
    if (used >= limits.maxImportsPerMonth) {
      return json(
        {
          error: `Monthly import limit reached (${limits.maxImportsPerMonth} imports).`,
          planError: true,
        },
        { status: 403 }
      );
    }
  }

  const isSheets = fileUrl.includes("docs.google.com/spreadsheets");
  const ext: "csv" | "xlsx" = isSheets
    ? "csv"
    : fileUrl.split("?")[0].split(".").pop()?.toLowerCase() === "xlsx"
      ? "xlsx"
      : "csv";

  if (ext === "xlsx" && !limits.allowedFileTypes.includes("xlsx")) {
    return json(
      { error: "Excel (.xlsx) files are available on Pro and Premium plans.", planError: true },
      { status: 403 }
    );
  }

  // A saved template renames the file's columns, exactly as it does for an
  // upload. Looked up by name, since a name is what an API caller can write.
  let columnMap: Record<string, string> | undefined;
  if (template) {
    const saved = await prisma.importTemplate.findFirst({ where: { shop, name: template } });
    if (!saved) return json({ error: `No template named "${template}"` }, { status: 400 });
    columnMap = JSON.parse(saved.columnMap) as Record<string, string>;
  }

  // Fetch the file
  let buffer: Buffer;
  try {
    if (isSheets) {
      buffer = await fetchGoogleSheetAsCSV(fileUrl);
    } else {
      // fileUrl comes from the request body, so it is fetched through the
      // guarded fetcher: https only, public addresses only, every redirect
      // re-checked, and the body capped.
      buffer = await fetchRemoteFile(fileUrl);
    }
  } catch (err) {
    return json({ error: `Failed to fetch file: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
  }

  const fileName = label ?? (isSheets ? "webhook-sheet.csv" : fileUrl.split("/").pop() ?? "webhook-import.csv");

  let parseResult;
  try {
    // Was always parseCSV, so an XLSX URL — which this endpoint documents as
    // supported — was read as CSV and produced garbage or an error.
    parseResult = await parseFile(buffer, ext, columnMap);
  } catch (err) {
    return json({ error: `Parse error: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
  }

  if (limits.maxRowsPerImport !== -1 && parseResult.totalRows > limits.maxRowsPerImport) {
    return json(
      {
        error: `File has ${parseResult.totalRows} rows but the plan allows ${limits.maxRowsPerImport} per import.`,
        planError: true,
      },
      { status: 403 }
    );
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
