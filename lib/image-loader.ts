/**
 * Optional next/image loader for Cloudflare Image Transformations.
 * Enabled when NEXT_IMAGE_LOADER=cloudflare (see next.config.ts).
 * Requires "Image Transformations" to be enabled on your Cloudflare zone.
 * Local files (/demo/*.svg) and SVGs are passed through untouched.
 */
export default function cloudflareLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  if (src.endsWith(".svg") || src.includes(".svg?")) return src;
  const params = [`width=${width}`, `quality=${quality ?? 78}`, "format=auto", "fit=scale-down"];
  return `/cdn-cgi/image/${params.join(",")}/${src.startsWith("/") ? src.slice(1) : src}`;
}
