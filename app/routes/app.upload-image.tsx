import { json, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { uploadImageToShopify } from "../services/image-upload.server";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const uploadHandler = unstable_createMemoryUploadHandler({ maxPartSize: MAX_IMAGE_SIZE });
  const formData = await unstable_parseMultipartFormData(request, uploadHandler);

  const file = formData.get("image") as File | null;
  if (!file) return json({ error: "No image provided" }, { status: 400 });

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return json({ error: "Unsupported image type. Use JPG, PNG, WebP or GIF." }, { status: 400 });
  }

  try {
    const cdnUrl = await uploadImageToShopify(admin, file);
    return json({ url: cdnUrl });
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
