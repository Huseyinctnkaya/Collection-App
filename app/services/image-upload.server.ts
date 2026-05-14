import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

const STAGED_UPLOAD_IMAGE = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

export async function uploadImageToShopify(
  admin: AdminApiContext,
  file: File
): Promise<string> {
  // Step 1: Get staged upload target
  const stageRes = await admin.graphql(STAGED_UPLOAD_IMAGE, {
    variables: {
      input: [
        {
          resource: "COLLECTION_IMAGE",
          filename: file.name,
          mimeType: file.type || "image/jpeg",
          httpMethod: "POST",
          fileSize: String(file.size),
        },
      ],
    },
  });

  const stageData = await stageRes.json();
  const target = stageData?.data?.stagedUploadsCreate?.stagedTargets?.[0];

  if (!target) throw new Error("Failed to create image upload target");

  // Step 2: Upload file to staged target
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", file);

  const uploadRes = await fetch(target.url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    throw new Error(`Image upload failed: ${uploadRes.statusText}`);
  }

  return target.resourceUrl as string;
}
