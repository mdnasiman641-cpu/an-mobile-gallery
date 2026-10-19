import { FAVICON_FILES, FAVICON_FILE_NAMES, FAVICON_MAX_BYTES } from "@/lib/favicon";

/**
 * Browser side of the favicon upload (Admin → Settings → Branding & Favicon):
 * makes the square PNG set from the admin's image with a canvas. The server
 * checks every PNG again before storing it (branding-actions.ts).
 */
export const FAVICON_ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml"];
const MAX_RASTER_BYTES = 5 * 1024 * 1024;
const MAX_SVG_BYTES = 300 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // an SVG shown through <img> is drawn as a picture: its scripts and links never run
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This file couldn't be read as an image."));
    };
    img.src = url;
  });
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the icon."))), "image/png"));
}

/**
 * Turns the chosen image into the square PNG set (16 … 512 px) in the browser.
 * Not square: centred on a transparent square (nothing is cropped off).
 * Apple touch icon: on white, because iPhones show transparency as black.
 */
export async function makeFaviconSet(file: File): Promise<{ form: FormData; warnings: string[] }> {
  if (!FAVICON_ACCEPT.includes(file.type)) throw new Error("Use a PNG, JPG, WebP, AVIF or SVG image.");
  const isSvg = file.type === "image/svg+xml";
  if (file.size > (isSvg ? MAX_SVG_BYTES : MAX_RASTER_BYTES)) throw new Error(isSvg ? "The SVG file is larger than 300 KB." : "The image is larger than 5 MB.");
  const img = await loadImage(file);
  const w = img.naturalWidth || (isSvg ? 512 : 0);
  const h = img.naturalHeight || (isSvg ? 512 : 0);
  if (!w || !h) throw new Error("This image has no size. Use a PNG or a different SVG.");
  if (!isSvg && (w < 48 || h < 48)) throw new Error(`The image is only ${w} × ${h} px. Use at least 48 × 48 px (512 × 512 is best).`);
  const warnings: string[] = [];
  if (!isSvg && Math.min(w, h) < 192) warnings.push(`The image is small (${w} × ${h} px): larger icons may look soft. 512 × 512 px is best.`);
  if (Math.abs(w - h) / Math.max(w, h) > 0.02) warnings.push("The image isn't square: it was centred on a square with transparent sides.");

  // master 512 × 512
  const master = document.createElement("canvas");
  master.width = master.height = 512;
  const mctx = master.getContext("2d");
  if (!mctx) throw new Error("Your browser can't process images. Try another browser.");
  mctx.imageSmoothingEnabled = true;
  mctx.imageSmoothingQuality = "high";
  const scale = 512 / Math.max(w, h);
  const dw = w * scale;
  const dh = h * scale;
  mctx.drawImage(img, (512 - dw) / 2, (512 - dh) / 2, dw, dh);

  const form = new FormData();
  for (const name of FAVICON_FILE_NAMES) {
    const size = FAVICON_FILES[name];
    // step down by halves for crisp small sizes
    let src: HTMLCanvasElement = master;
    while (src.width / 2 >= size * 1.5) {
      const half = document.createElement("canvas");
      half.width = half.height = Math.round(src.width / 2);
      const hctx = half.getContext("2d")!;
      hctx.imageSmoothingQuality = "high";
      hctx.drawImage(src, 0, 0, half.width, half.height);
      src = half;
    }
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    if (name === "apple-touch-icon.png") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
    }
    ctx.drawImage(src, 0, 0, size, size);
    const blob = await canvasPng(c);
    if (blob.size > FAVICON_MAX_BYTES[name]) throw new Error("This image is too detailed for an icon (file too large). Use a simpler logo image.");
    form.append(name, new File([blob], name, { type: "image/png" }));
  }
  return { form, warnings };
}

