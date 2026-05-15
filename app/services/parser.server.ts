import { parse as csvParse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { z } from "zod";

export const CollectionRowSchema = z.object({
  title: z.string().min(1, "Title is required"),
  handle: z.string().optional(),
  description: z.string().optional(),
  image_url: z.string().url("Invalid image URL").optional().or(z.literal("")),
  sort_order: z
    .string()
    .optional()
    .transform((v) => {
      const aliases: Record<string, string> = {
        "price-descending": "price-desc",
        "price-ascending": "price-asc",
        "alpha-ascending": "alpha-asc",
        "alpha-descending": "alpha-desc",
        "created-descending": "created-desc",
        "created-ascending": "created",
        "best_selling": "best-selling",
      };
      const normalized = (v ?? "manual").toLowerCase().trim();
      return aliases[normalized] ?? normalized;
    })
    .pipe(
      z.enum(["manual", "best-selling", "alpha-asc", "alpha-desc", "price-asc", "price-desc", "created", "created-desc"])
        .default("manual")
    ),
  // Smart collection rules: "tag:summer,vendor:Nike"
  rules: z.string().optional(),
  // Comma-separated product handles for manual collections
  products: z.string().optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  published: z
    .string()
    .transform((v) => v.toLowerCase() !== "false" && v !== "0")
    .optional()
    .default("true"),
});

export type CollectionRow = z.infer<typeof CollectionRowSchema>;

export interface ParsedRow {
  row: number;
  data: CollectionRow | null;
  rawRow: Record<string, string>;
  errors: Array<{ field: string; message: string }>;
}

export interface ParseResult {
  rows: ParsedRow[];
  totalRows: number;
  validRows: number;
  errorRows: number;
}

function normalizeHeader(h: string): string {
  const lower = h.toLowerCase().trim();
  // Preserve metafield dot notation: metafield.namespace.key or metafield.namespace.key.type
  if (lower.startsWith("metafield.")) return lower;
  return lower.replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function extractMetafields(
  rawRow: Record<string, string>
): Array<{ namespace: string; key: string; type: string; value: string }> {
  const result: Array<{ namespace: string; key: string; type: string; value: string }> = [];
  for (const [col, value] of Object.entries(rawRow)) {
    if (!col.startsWith("metafield.") || !value) continue;
    const parts = col.split(".");
    if (parts.length < 3) continue;
    const [, namespace, key, type = "single_line_text_field"] = parts;
    result.push({ namespace, key, type, value });
  }
  return result;
}

function normalizeHeaders(headers: string[], columnMap?: Record<string, string>): string[] {
  return headers.map((h) => {
    const normalized = normalizeHeader(h);
    return columnMap?.[normalized] ?? normalized;
  });
}

function parseAndValidateRow(rawRow: Record<string, string>, rowIndex: number): ParsedRow {
  const result = CollectionRowSchema.safeParse(rawRow);

  if (result.success) {
    return { row: rowIndex, data: result.data, rawRow, errors: [] };
  }

  const errors = result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));

  return { row: rowIndex, data: null, rawRow, errors };
}

export async function parseCSV(buffer: Buffer<ArrayBufferLike>, columnMap?: Record<string, string>): Promise<ParseResult> {
  const records = csvParse(buffer as Buffer, {
    columns: (headers: string[]) => normalizeHeaders(headers, columnMap),
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  const rows = records.map((record, i) => parseAndValidateRow(record, i + 2));

  return {
    rows,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.errors.length === 0).length,
    errorRows: rows.filter((r) => r.errors.length > 0).length,
  };
}

export async function parseExcel(buffer: Buffer<ArrayBufferLike>, columnMap?: Record<string, string>): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (workbook.xlsx.load as any)(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Excel file has no worksheets");

  const rows: ParsedRow[] = [];
  let headers: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const values = (row.values as (string | null)[]).slice(1); // ExcelJS is 1-indexed

    if (rowNumber === 1) {
      headers = normalizeHeaders(values.map((v) => String(v ?? "")), columnMap);
      return;
    }

    const rawRow = Object.fromEntries(
      headers.map((h, i) => [h, String(values[i] ?? "")])
    );

    rows.push(parseAndValidateRow(rawRow, rowNumber));
  });

  return {
    rows,
    totalRows: rows.length,
    validRows: rows.filter((r) => r.errors.length === 0).length,
    errorRows: rows.filter((r) => r.errors.length > 0).length,
  };
}

export async function parseFile(
  buffer: Buffer<ArrayBufferLike>,
  fileType: "csv" | "xlsx",
  columnMap?: Record<string, string>
): Promise<ParseResult> {
  return fileType === "csv" ? parseCSV(buffer, columnMap) : parseExcel(buffer, columnMap);
}
