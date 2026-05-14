import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { notifyImportFinished } from "./notify.server";
import { registerCollectionTranslations, extractLocaleFields } from "./translate.server";
import type { CollectionRow, ParsedRow } from "./parser.server";
import {
  COLLECTION_CREATE,
  COLLECTION_UPDATE,
  COLLECTION_BY_HANDLE,
  COLLECTION_ADD_PRODUCTS,
  BULK_OPERATION_RUN_MUTATION,
  STAGED_UPLOADS_CREATE,
  PRODUCTS_BY_HANDLES,
} from "../graphql/mutations";

const BATCH_SIZE = 10; // collections per batch for standard API

export type DuplicateStrategy = "skip" | "overwrite";

interface ImportOptions {
  jobId: string;
  shop: string;
  admin: AdminApiContext;
  rows: ParsedRow[];
  useBulk: boolean;
  duplicateStrategy: DuplicateStrategy;
}

export async function runImport({ jobId, shop, admin, rows, useBulk, duplicateStrategy }: ImportOptions) {
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" },
  });

  const validRows = rows.filter((r) => r.data !== null);

  if (useBulk) {
    await runBulkImport({ jobId, admin, rows: validRows });
  } else {
    await runBatchImport({ jobId, shop, admin, rows: validRows, duplicateStrategy });
  }
}

async function runBatchImport({
  jobId,
  shop,
  admin,
  rows,
  duplicateStrategy,
}: {
  jobId: string;
  shop: string;
  admin: AdminApiContext;
  rows: ParsedRow[];
  duplicateStrategy: DuplicateStrategy;
}) {
  let processed = 0;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (parsedRow) => {
        const row = parsedRow.data!;
        try {
          const collectionId = await createOrUpdateCollection(admin, row, duplicateStrategy);

          if (collectionId && row.products) {
            await attachProducts(admin, collectionId, row.products, shop);
          }

          if (collectionId) {
            const localeFields = extractLocaleFields(parsedRow.rawRow);
            if (Object.keys(localeFields).length > 0) {
              await registerCollectionTranslations(admin, collectionId, localeFields).catch(console.error);
            }
          }

          successCount++;
        } catch (err) {
          errorCount++;
          await prisma.importError.create({
            data: {
              jobId,
              row: parsedRow.row,
              message: err instanceof Error ? err.message : "Unknown error",
              rawData: JSON.stringify(parsedRow.data),
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

async function createOrUpdateCollection(
  admin: AdminApiContext,
  row: CollectionRow,
  duplicateStrategy: DuplicateStrategy
): Promise<string | null> {
  const handle = row.handle || row.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  // Check for existing collection by handle
  const existingRes = await admin.graphql(COLLECTION_BY_HANDLE, { variables: { handle } });
  const existingData = await existingRes.json();
  const existing = existingData?.data?.collectionByHandle;

  if (existing) {
    if (duplicateStrategy === "skip") return existing.id;
    // overwrite: update existing
    return updateCollection(admin, existing.id, row);
  }

  return createCollection(admin, row);
}

async function createCollection(
  admin: AdminApiContext,
  row: CollectionRow
): Promise<string | null> {
  const input = buildCollectionInput(row);
  const response = await admin.graphql(COLLECTION_CREATE, { variables: { input } });
  const { data } = await response.json();
  const errors: Array<{ field: string[]; message: string }> = data?.collectionCreate?.userErrors ?? [];

  // If only image failed, retry without the image rather than failing the whole row
  if (errors.length > 0 && errors.every((e) => e.message.toLowerCase().includes("image"))) {
    const inputWithoutImage = { ...input, image: undefined };
    const retry = await admin.graphql(COLLECTION_CREATE, { variables: { input: inputWithoutImage } });
    const retryData = await retry.json();
    if (retryData?.data?.collectionCreate?.userErrors?.length > 0) {
      throw new Error(retryData.data.collectionCreate.userErrors[0].message);
    }
    return retryData?.data?.collectionCreate?.collection?.id ?? null;
  }

  if (errors.length > 0) throw new Error(errors[0].message);
  return data?.collectionCreate?.collection?.id ?? null;
}

async function updateCollection(
  admin: AdminApiContext,
  id: string,
  row: CollectionRow
): Promise<string | null> {
  const input = { id, ...buildCollectionInput(row) };
  const response = await admin.graphql(COLLECTION_UPDATE, { variables: { input } });
  const { data } = await response.json();
  const errors: Array<{ field: string[]; message: string }> = data?.collectionUpdate?.userErrors ?? [];

  if (errors.length > 0 && errors.every((e) => e.message.toLowerCase().includes("image"))) {
    const inputWithoutImage = { ...input, image: undefined };
    const retry = await admin.graphql(COLLECTION_UPDATE, { variables: { input: inputWithoutImage } });
    const retryData = await retry.json();
    if (retryData?.data?.collectionUpdate?.userErrors?.length > 0) {
      throw new Error(retryData.data.collectionUpdate.userErrors[0].message);
    }
    return retryData?.data?.collectionUpdate?.collection?.id ?? null;
  }

  if (errors.length > 0) throw new Error(errors[0].message);
  return data?.collectionUpdate?.collection?.id ?? null;
}

function buildCollectionInput(row: CollectionRow): Record<string, unknown> {
  const input: Record<string, unknown> = {
    title: row.title,
    descriptionHtml: row.description ?? "",
    handle: row.handle || undefined,
    sortOrder: row.sort_order?.toUpperCase().replace(/-/g, "_"),
    seo: row.seo_title
      ? { title: row.seo_title, description: row.seo_description }
      : undefined,
    image: row.image_url ? { src: row.image_url } : undefined,
  };
  if (row.rules) input.ruleSet = buildRuleSet(row.rules);
  return input;
}

async function attachProducts(
  admin: AdminApiContext,
  collectionId: string,
  productHandlesStr: string,
  _shop: string
) {
  const handles = productHandlesStr.split(",").map((h) => h.trim()).filter(Boolean);
  if (handles.length === 0) return;

  const query = handles.map((h) => `handle:${h}`).join(" OR ");
  const searchResponse = await admin.graphql(PRODUCTS_BY_HANDLES, { variables: { query } });
  const { data } = await searchResponse.json();

  const productIds: string[] = data?.products?.edges?.map(
    (e: { node: { id: string } }) => e.node.id
  ) ?? [];

  if (productIds.length === 0) return;

  const addResponse = await admin.graphql(COLLECTION_ADD_PRODUCTS, {
    variables: { id: collectionId, productIds },
  });
  const addData = await addResponse.json();

  if (addData?.data?.collectionAddProductsV2?.userErrors?.length > 0) {
    throw new Error(addData.data.collectionAddProductsV2.userErrors[0].message);
  }
}

// For 50+ collections: use Shopify Bulk Operations API
async function runBulkImport({
  jobId,
  admin,
  rows,
}: {
  jobId: string;
  admin: AdminApiContext;
  rows: ParsedRow[];
}) {
  const jsonlLines = rows
    .map((r) => {
      const row = r.data!;
      const input: Record<string, unknown> = {
        title: row.title,
        descriptionHtml: row.description ?? "",
        handle: row.handle || undefined,
        sortOrder: row.sort_order?.toUpperCase().replace("-", "_"),
      };
      if (row.rules) input.ruleSet = buildRuleSet(row.rules);
      return JSON.stringify({ input });
    })
    .join("\n");

  const jsonlBuffer = Buffer.from(jsonlLines, "utf-8");

  // Step 1: Create staged upload target
  const stageResponse = await admin.graphql(STAGED_UPLOADS_CREATE, {
    variables: {
      input: [
        {
          resource: "BULK_MUTATION_VARIABLES",
          filename: `import-${jobId}.jsonl`,
          mimeType: "text/jsonl",
          httpMethod: "POST",
        },
      ],
    },
  });

  const stageData = await stageResponse.json();
  const target = stageData?.data?.stagedUploadsCreate?.stagedTargets?.[0];

  if (!target) throw new Error("Failed to create staged upload");

  // Step 2: Upload JSONL to staged target
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([jsonlBuffer], { type: "text/jsonl" }));

  const uploadRes = await fetch(target.url, { method: "POST", body: formData });
  if (!uploadRes.ok) throw new Error(`Staged upload failed: ${uploadRes.statusText}`);

  // Step 3: Run bulk mutation
  const bulkMutation = `mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }`;

  const bulkResponse = await admin.graphql(BULK_OPERATION_RUN_MUTATION, {
    variables: {
      mutation: bulkMutation,
      stagedUploadPath: target.resourceUrl,
    },
  });

  const bulkData = await bulkResponse.json();
  const bulkOpId = bulkData?.data?.bulkOperationRunMutation?.bulkOperation?.id;

  if (!bulkOpId) throw new Error("Bulk operation failed to start");

  await prisma.importJob.update({
    where: { id: jobId },
    data: { bulkOperationId: bulkOpId, status: "RUNNING" },
  });
  // Completion is handled via webhook (bulk_operations/finish)
}

const RULE_COLUMN_ALIASES: Record<string, string> = {
  PRODUCT_TYPE: "TYPE",
  PRODUCT_VENDOR: "VENDOR",
  PRODUCT_TAG: "TAG",
  PRODUCT_TITLE: "TITLE",
};

function buildRuleSet(rulesStr: string) {
  const rules = rulesStr.split(",").map((r) => {
    const colonIdx = r.indexOf(":");
    if (colonIdx === -1) return null;
    const rawColumn = r.slice(0, colonIdx).trim().toUpperCase();
    const condition = r.slice(colonIdx + 1).trim();
    const column = RULE_COLUMN_ALIASES[rawColumn] ?? rawColumn;
    return { column, relation: "EQUALS", condition };
  }).filter(Boolean);

  return { rules, appliedDisjunctively: false };
}
