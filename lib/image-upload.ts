import { getBrowserClient } from "@/lib/supabase/browser";

export const MEDIA_BUCKET = "media";
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export interface UploadedImage {
  url: string;
  path: string;
  width: number;
  height: number;
}

/**
 * Resize (max edge 1600px) and re-encode to WebP in the browser before upload.
 * A typical 4 MB phone photo becomes ~150 KB: less Storage, less bandwidth,
 * faster pages, and no server-side processing cost.
 */
async function compress(file: File, maxEdge: number, quality: number): Promise<{ blob: Blob; width: number; height: number; type: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images. Try another browser.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
  let blob = await toBlob("image/webp");
  let type = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob("image/jpeg"); // older Safari can't encode WebP
    type = "image/jpeg";
  }
  if (!blob) throw new Error("Couldn't compress this image.");
  return { blob, width, height, type };
}

export async function uploadImage(
  file: File,
  folder: "products" | "brands" | "banners" | "site" | "categories",
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<UploadedImage> {
  if (!ACCEPTED.includes(file.type)) throw new Error(`${file.name}: use a JPG, PNG, WebP or AVIF image.`);
  if (file.size > MAX_INPUT_BYTES) throw new Error(`${file.name} is larger than 15 MB.`);

  const { blob, width, height, type } = await compress(file, opts.maxEdge ?? 1600, opts.quality ?? 0.82);
  if (blob.size > 5 * 1024 * 1024) throw new Error(`${file.name} is still over 5 MB after compression.`);

  const ext = type === "image/webp" ? "webp" : "jpg";
  // Unique, immutable file names: browsers and CDNs can cache them for a year.
  const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const supabase = getBrowserClient();
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, blob, {
    cacheControl: "31536000",
    contentType: type,
    upsert: false,
  });
  if (error) {
    throw new Error(
      error.message.toLowerCase().includes("row-level security")
        ? "You don't have permission to upload images."
        : `Upload failed: ${error.message}`,
    );
  }
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path, width, height };
}
