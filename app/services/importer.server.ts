import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { notifyImportFinished } from "./notify.server";
import { registerCollectionTranslations, extractLocaleFields } from "./translate.server";
import { extractMetafields } from "./parser.server";
import type { ParsedRow } from "./parser.server";
import { fetchExistingIndex } from "./collection-index.server";
import { graphqlRequest } from "./shopify-graphql.server";
import {
  planImport,
  type DuplicateStrategy,
  type ImportPlan,
  type PlanRow,
  type PlannedRow,
} from "./import-plan.server";
import {
  COLLECTION_CREATE,
  COLLECTION_UPDATE,
  COLLECTION_ADD_PRODUCTS,
  BULK_OPERATION_RUN_MUTATION,
  BULK_MUTATION_DOCUMENTS,
  STAGED_UPLOADS_CREATE,
  PRODUCTS_BY_HANDLES,
  type BulkMutationName,
} from "../graphql/mutations";

export type { DuplicateStrategy };

const BATCH_SIZE = 10; // collections per batch for standard API

interface ImportOptions {
  jobId: string;
  shop: string;
  admin: AdminApiContext;
  rows: ParsedRow[];
  useBulk: boolean;
  duplicateStrategy: DuplicateStrategy;
}

export async function runImport({
  jobId,
  shop,
  admin,
  rows,
  useBulk,
  duplicateStrategy,
}: ImportOptions) {
  await prisma.importJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

  const validRows = rows.filter((r) => r.data !== null);
  const planRows: PlanRow[] = validRows.map((r) => ({
    row: r.row,
    data: r.data!,
    metafields: extractMetafields(r.rawRow),
  }));

  let plan: ImportPlan;
  try {
    // Both paths plan from one snapshot of what already exists. Resolving this
    // up front is what makes "update existing" actually update: the previous
    // code looked each row up individually and treated any failed or throttled
    // lookup as "does not exist", then called collectionCreate and died on
    // "handle has already been taken".
    const index = await fetchExistingIndex(admin, planRows);
    plan = planImport({
      rows: planRows,
      index,
      duplicateStrategy,
      columns: collectColumns(validRows),
    });
  } catch (err) {
    // Without a trustworthy snapshot there is no safe way to tell a create from
    // an update, so fail the job loudly rather than create duplicates.
    await failJob(jobId, shop, err);
    return;
  }

  if (plan.failed.length > 0) {
    await prisma.importError.createMany({
      data: plan.failed.map((f) => ({ jobId, row: f.row, message: f.message })),
    });
  }

  if (useBulk) {
    await runBulkImport({ jobId, shop, admin, plan });
  } else {
    await runBatchImport({ jobId, shop, admin, plan, parsedRows: validRows });
  }
}

/** Every column the sheet actually has, so updates never write absent fields. */
function collectColumns(rows: ParsedRow[]): Set<string> {
  const columns = new Set<string>();
  for (const row of rows) {
    for (const column of Object.keys(row.rawRow)) columns.add(column);
  }
  return columns;
}

async function failJob(jobId: string, shop: string, err: unknown) {
  const message = err instanceof Error ? err.message : "Unknown error";
  await prisma.importError.create({
    data: { jobId, row: 0, message: `Could not read existing collections: ${message}` },
  });
  const job = await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "FAILED", errorCount: { increment: 1 } },
  });
  notifyImportFinished(shop, {
    id: job.id,
    fileName: job.fileName,
    status: "FAILED",
    successCount: job.successCount,
    errorCount: job.errorCount,
    totalRows: job.totalRows,
  }).catch(console.error);
}

// ---------------------------------------------------------------------------
// Standard path: batched Admin API calls
// ---------------------------------------------------------------------------

async function runBatchImport({
  jobId,
  shop,
  admin,
  plan,
  parsedRows,
}: {
  jobId: string;
  shop: string;
  admin: AdminApiContext;
  plan: ImportPlan;
  parsedRows: ParsedRow[];
}) {
  const rawByRow = new Map(parsedRows.map((r) => [r.row, r.rawRow]));

  const work: Array<{ kind: BulkMutationName; planned: PlannedRow }> = [
    ...plan.creates.map((planned) => ({ kind: "collectionCreate" as const, planned })),
    ...plan.updates.map((planned) => ({ kind: "collectionUpdate" as const, planned })),
  ].sort((a, b) => a.planned.row - b.planned.row);

  // Rows that already exist and were left alone still count as processed.
  let processed = plan.skipped.length;
  let successCount = plan.skipped.length;
  let errorCount = plan.failed.length;

  for (let i = 0; i < work.length; i += BATCH_SIZE) {
    await Promise.all(
      work.slice(i, i + BATCH_SIZE).map(async ({ kind, planned }) => {
        try {
          const collectionId = await runCollectionMutation(admin, kind, planned.input);
          if (!collectionId) throw new Error("Shopify returned no collection");

          await prisma.importAction.create({
            data: {
              jobId,
              collectionId,
              collectionHandle: planned.handle,
              action: kind === "collectionCreate" ? "created" : "updated",
              previousData: planned.existing ? JSON.stringify(planned.existing) : null,
            },
          });

          const rawRow = rawByRow.get(planned.row) ?? {};

          if (typeof rawRow.products === "string" && rawRow.products) {
            await attachProducts(admin, collectionId, rawRow.products);
          }

          const localeFields = extractLocaleFields(rawRow);
          if (Object.keys(localeFields).length > 0) {
            await registerCollectionTranslations(admin, collectionId, localeFields).catch(
              console.error
            );
          }

          successCount++;
        } catch (err) {
          errorCount++;
          await prisma.importError.create({
            data: {
              jobId,
              row: planned.row,
              message: err instanceof Error ? err.message : "Unknown error",
              rawData: JSON.stringify(planned.input),
            },
          });
        } finally {
          processed++;
          await prisma.importJob.update({
            where: { id: jobId },
            data: { processedRows: processed, successCount, errorCount },
          });
        }
      })
    );
  }

  const finalStatus = errorCount === 0 ? "COMPLETED" : successCount > 0 ? "PARTIAL" : "FAILED";
  const finalJob = await prisma.importJob.update({
    where: { id: jobId },
    data: { status: finalStatus, processedRows: processed, successCount, errorCount },
  });

  notifyImportFinished(shop, {
    id: finalJob.id,
    fileName: finalJob.fileName,
    status: finalStatus,
    successCount,
    errorCount,
    totalRows: finalJob.totalRows,
  }).catch(console.error);
}

/**
 * Run collectionCreate or collectionUpdate for one row.
 *
 * Image URLs are the one error worth retrying around: a broken image should not
 * cost the merchant the rest of the row, so the mutation is retried once
 * without it.
 */
async function runCollectionMutation(
  admin: AdminApiContext,
  mutation: BulkMutationName,
  input: Record<string, unknown>
): Promise<string | null> {
  const document = mutation === "collectionCreate" ? COLLECTION_CREATE : COLLECTION_UPDATE;

  const read = (payload: unknown) => {
    const result = (payload as {
      data?: Record<string, { collection?: { id: string } | null; userErrors?: UserError[] }>;
      errors?: Array<{ message?: string }>;
    });

    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      throw new Error(result.errors.map((e) => e.message ?? "GraphQL error").join("; "));
    }

    const field = result?.data?.[mutation];
    return { id: field?.collection?.id ?? null, userErrors: field?.userErrors ?? [] };
  };

  const first = read(await graphqlRequest(admin, document, { input }));

  if (first.userErrors.length === 0) return first.id;

  if (first.userErrors.every((e) => e.message.toLowerCase().includes("image"))) {
    const retry = read(
      await graphqlRequest(admin, document, { input: { ...input, image: undefined } })
    );
    if (retry.userErrors.length > 0) throw new Error(retry.userErrors[0].message);
    return retry.id;
  }

  throw new Error(first.userErrors[0].message);
}

interface UserError {
  field?: string[] | null;
  message: string;
}

async function attachProducts(
  admin: AdminApiContext,
  collectionId: string,
  productHandlesStr: string
) {
  const handles = productHandlesStr
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (handles.length === 0) return;

  const query = handles.map((h) => `handle:${h}`).join(" OR ");
  const payload = (await graphqlRequest(admin, PRODUCTS_BY_HANDLES, { query })) as {
    data?: { products?: { edges?: Array<{ node: { id: string } }> } };
  };

  const productIds = payload?.data?.products?.edges?.map((e) => e.node.id) ?? [];
  if (productIds.length === 0) return;

  const addPayload = (await graphqlRequest(admin, COLLECTION_ADD_PRODUCTS, {
    id: collectionId,
    productIds,
  })) as { data?: { collectionAddProductsV2?: { userErrors?: UserError[] } } };

  const userErrors = addPayload?.data?.collectionAddProductsV2?.userErrors ?? [];
  if (userErrors.length > 0) throw new Error(userErrors[0].message);
}

// ---------------------------------------------------------------------------
// Bulk path: Shopify Bulk Operations, for imports above the row threshold
// ---------------------------------------------------------------------------

/**
 * Run the plan as bulk operations.
 *
 * A bulk operation executes a single mutation over every line of its JSONL, so
 * new rows and existing rows need separate passes. The previous version of this
 * function ran only collectionCreate and never received `duplicateStrategy` at
 * all, which is why every existing collection in a 50+ row import failed with
 * "handle has already been taken" even in "update existing" mode — and why
 * metafields, the whole point of those imports, were never written.
 *
 * Passes are queued and started one at a time; the bulk-operations webhook
 * starts the next one, because the number of bulk operations an app may run
 * concurrently depends on the API version.
 */
async function runBulkImport({
  jobId,
  shop,
  admin,
  plan,
}: {
  jobId: string;
  shop: string;
  admin: AdminApiContext;
  plan: ImportPlan;
}) {
  const allPasses: Array<{ mutation: BulkMutationName; rows: PlannedRow[] }> = [
    { mutation: "collectionCreate", rows: plan.creates },
    { mutation: "collectionUpdate", rows: plan.updates },
  ];
  const passes = allPasses.filter((pass) => pass.rows.length > 0);

  // Snapshot pre-update state now, while we still have it, so rollback can
  // restore collections this job overwrites.
  if (plan.updates.length > 0) {
    await prisma.importAction.createMany({
      data: plan.updates.map((planned) => ({
        jobId,
        collectionId: String(planned.input.id),
        collectionHandle: planned.handle,
        action: "updated",
        previousData: planned.existing ? JSON.stringify(planned.existing) : null,
      })),
    });
  }

  if (passes.length === 0) {
    // Everything was skipped or failed planning; nothing to send to Shopify.
    const status = plan.failed.length > 0 ? (plan.skipped.length > 0 ? "PARTIAL" : "FAILED") : "COMPLETED";
    const job = await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status,
        processedRows: plan.skipped.length + plan.failed.length,
        successCount: plan.skipped.length,
        errorCount: plan.failed.length,
      },
    });
    notifyImportFinished(shop, {
      id: job.id,
      fileName: job.fileName,
      status,
      successCount: job.successCount,
      errorCount: job.errorCount,
      totalRows: job.totalRows,
    }).catch(console.error);
    return;
  }

  for (const pass of passes) {
    const jsonl = pass.rows.map((planned) => JSON.stringify({ input: planned.input })).join("\n");
    const stagedPath = await uploadBulkJsonl(admin, `${jobId}-${pass.mutation}`, jsonl);

    await prisma.bulkOperation.create({
      data: {
        jobId,
        mutation: pass.mutation,
        stagedPath,
        rowNumbers: JSON.stringify(pass.rows.map((planned) => planned.row)),
      },
    });
  }

  // Skipped and planning-failed rows are already decided, so seed the counters
  // with them; the webhook increments from here as each pass reports.
  await prisma.importJob.update({
    where: { id: jobId },
    data: {
      status: "RUNNING",
      processedRows: plan.skipped.length + plan.failed.length,
      successCount: plan.skipped.length,
      errorCount: plan.failed.length,
    },
  });

  await startNextBulkPass(admin, jobId);
}

/**
 * Start the next queued pass of a job, if any.
 *
 * Returns the operation id that was started, or null when the job has no
 * queued passes left — which is how the webhook knows the job is finished.
 */
export async function startNextBulkPass(
  admin: AdminApiContext,
  jobId: string
): Promise<string | null> {
  const next = await prisma.bulkOperation.findFirst({
    where: { jobId, status: "QUEUED" },
    orderBy: { createdAt: "asc" },
  });
  if (!next) return null;

  const payload = (await graphqlRequest(admin, BULK_OPERATION_RUN_MUTATION, {
    mutation: BULK_MUTATION_DOCUMENTS[next.mutation as BulkMutationName],
    stagedUploadPath: next.stagedPath,
  })) as {
    data?: {
      bulkOperationRunMutation?: {
        bulkOperation?: { id: string } | null;
        userErrors?: UserError[];
      };
    };
  };

  const result = payload?.data?.bulkOperationRunMutation;
  const operationId = result?.bulkOperation?.id;

  if (!operationId) {
    const message = result?.userErrors?.[0]?.message ?? "Bulk operation failed to start";
    throw new Error(`${next.mutation} pass could not start: ${message}`);
  }

  await prisma.bulkOperation.update({
    where: { id: next.id },
    data: { operationId, status: "RUNNING" },
  });

  // Kept in sync for the job detail page, which shows the running operation.
  await prisma.importJob.update({
    where: { id: jobId },
    data: { bulkOperationId: operationId },
  });

  return operationId;
}

/** Create a staged upload target and put the JSONL on it. */
async function uploadBulkJsonl(
  admin: AdminApiContext,
  filenameSuffix: string,
  jsonl: string
): Promise<string> {
  const stagePayload = (await graphqlRequest(admin, STAGED_UPLOADS_CREATE, {
    input: [
      {
        resource: "BULK_MUTATION_VARIABLES",
        filename: `import-${filenameSuffix}.jsonl`,
        mimeType: "text/jsonl",
        httpMethod: "POST",
      },
    ],
  })) as {
    data?: { stagedUploadsCreate?: { stagedTargets?: StagedTarget[]; userErrors?: UserError[] } };
  };

  const target = stagePayload?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    const stageErrors = stagePayload?.data?.stagedUploadsCreate?.userErrors ?? [];
    throw new Error(
      stageErrors.length > 0
        ? `Failed to create staged upload: ${stageErrors[0].message}`
        : "Failed to create staged upload"
    );
  }

  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([Buffer.from(jsonl, "utf-8")], { type: "text/jsonl" }));

  const uploadRes = await fetch(target.url, { method: "POST", body: formData });
  if (!uploadRes.ok) throw new Error(`Staged upload failed: ${uploadRes.statusText}`);

  return resolveStagedUploadPath(target);
}

interface StagedTarget {
  url: string;
  resourceUrl: string | null;
  parameters: Array<{ name: string; value: string }>;
}

// bulkOperationRunMutation expects the staged upload `key`, not `resourceUrl`.
// Shopify returns resourceUrl: null for BULK_MUTATION_VARIABLES targets, so
// passing it would send null into a String! argument and abort the operation.
export function resolveStagedUploadPath(target: StagedTarget): string {
  const key = target.parameters?.find((p) => p.name === "key")?.value;
  if (!key) throw new Error("Staged upload target is missing the `key` parameter");
  return key;
}
