import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "~/db.server";
import type { CollectionRow, ParsedRow } from "./parser.server";
import {
  COLLECTION_CREATE,
  COLLECTION_ADD_PRODUCTS,
  BULK_OPERATION_RUN_MUTATION,
  STAGED_UPLOADS_CREATE,
  PRODUCTS_BY_HANDLES,
} from "~/graphql/mutations";

const BATCH_SIZE = 10; // collections per batch for standard API

interface ImportOptions {
  jobId: string;
  shop: string;
  admin: AdminApiContext["admin"];
  rows: ParsedRow[];
  useBulk: boolean; // true when rows > 50
}

export async function runImport({ jobId, shop, admin, rows, useBulk }: ImportOptions) {
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" },
  });

  const validRows = rows.filter((r) => r.data !== null);

  if (useBulk) {
    await runBulkImport({ jobId, admin, rows: validRows });
  } else {
    await runBatchImport({ jobId, admin, rows: validRows });
  }
}

async function runBatchImport({
  jobId,
  admin,
  rows,
}: {
  jobId: string;
  admin: AdminApiContext["admin"];
  rows: ParsedRow[];
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
          const collectionId = await createCollection(admin, row);

          if (collectionId && row.products) {
            await attachProducts(admin, collectionId, row.products, shop);
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
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: finalStatus, processedRows: processed, successCount, errorCount },
  });
}

async function createCollection(
  admin: AdminApiContext["admin"],
  row: CollectionRow
): Promise<string | null> {
  const input: Record<string, unknown> = {
    title: row.title,
    descriptionHtml: row.description ?? "",
    handle: row.handle || undefined,
    sortOrder: row.sort_order?.toUpperCase().replace("-", "_"),
    seo: row.seo_title
      ? { title: row.seo_title, description: row.seo_description }
      : undefined,
    image: row.image_url ? { src: row.image_url } : undefined,
  };

  if (row.rules) {
    input.ruleSet = buildRuleSet(row.rules);
  }

  const response = await admin.graphql(COLLECTION_CREATE, { variables: { input } });
  const { data } = await response.json();

  if (data?.collectionCreate?.userErrors?.length > 0) {
    throw new Error(data.collectionCreate.userErrors[0].message);
  }

  return data?.collectionCreate?.collection?.id ?? null;
}

async function attachProducts(
  admin: AdminApiContext["admin"],
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
  admin: AdminApiContext["admin"];
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

function buildRuleSet(rulesStr: string) {
  const rules = rulesStr.split(",").map((r) => {
    const [column, condition, conditionStr] = r.trim().split(":");
    return {
      column: column?.toUpperCase() ?? "TAG",
      relation: "EQUALS",
      condition: condition ?? conditionStr ?? "",
    };
  });

  return { rules, appliedDisjunctively: false };
}
