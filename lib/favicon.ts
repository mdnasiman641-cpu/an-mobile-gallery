/**
 * Site icon (favicon) set, managed in Admin → Settings → Branding & Favicon.
 *
 * An uploaded icon is stored as a set of square PNGs in the public "media"
 * bucket under site/favicon/<id>/ (made in the browser from the admin's
 * image, checked byte by byte on the server). The database stores only the
 * set's id (site_settings.favicon_id); every URL is derived from it. A new
 * upload gets a new id, so its URLs are new too: browsers and Google never
 * keep showing a replaced icon from cache.
 *
 * Without an uploaded icon, the built-in brand icons in /public/brand are used.
 * Plain logic (no secrets): used on the server and in the admin page.
 */

export const FAVICON_FOLDER = "site/favicon";

/** Every file of a set: name → square size in px. */
export const FAVICON_FILES = {
  "icon-16.png": 16,
  "icon-32.png": 32,
  "icon-48.png": 48,
  "apple-touch-icon.png": 180,
  "icon-192.png": 192,
  "icon-512.png": 512,
} as const;
export type FaviconFile = keyof typeof FAVICON_FILES;
export const FAVICON_FILE_NAMES = Object.keys(FAVICON_FILES) as FaviconFile[];

/**
 * Upper size limit per file (bytes). Together they stay under the 1 MB
 * request limit of Next.js server actions; a logo-style icon is far smaller.
 */
export const FAVICON_MAX_BYTES: Record<FaviconFile, number> = {
  "icon-16.png": 20_000,
  "icon-32.png": 40_000,
  "icon-48.png": 60_000,
  "apple-touch-icon.png": 200_000,
  "icon-192.png": 200_000,
  "icon-512.png": 400_000,
};

export interface FaviconState {
  /** Set shown now (saved or just uploaded); null = built-in icon. */
  id: string | null;
  urls: Partial<Record<FaviconFile, string>> | null;
}

/** The built-in icons (used when no icon has been uploaded). */
export const DEFAULT_FAVICON = {
  ico: "/brand/favicon.ico",
  svg: "/brand/icon.svg",
  png192: "/brand/icon-192.png",
  apple: "/brand/apple-touch-icon.png",
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isFaviconId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export function faviconPath(id: string, file: FaviconFile): string {
  return `${FAVICON_FOLDER}/${id}/${file}`;
}

/** Public HTTPS URL of one file of an uploaded set. */
export function faviconFileUrl(supabaseUrl: string, id: string, file: FaviconFile): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/media/${faviconPath(id, file)}`;
}

/** <link> icons for the page head (Next.js metadata "icons"). */
export function faviconMetadata(id: string | null, supabaseUrl: string) {
  if (!id || !supabaseUrl) {
    return {
      icon: [
        { url: "/favicon.ico?v=default", sizes: "48x48" },
        { url: DEFAULT_FAVICON.svg, type: "image/svg+xml" },
        { url: DEFAULT_FAVICON.png192, type: "image/png", sizes: "192x192" },
      ],
      apple: [{ url: DEFAULT_FAVICON.apple, type: "image/png", sizes: "180x180" }],
    };
  }
  const v = id.slice(0, 8);
  const url = (f: FaviconFile) => faviconFileUrl(supabaseUrl, id, f);
  return {
    icon: [
      // same address for every version; ?v changes when the icon is replaced
      { url: `/favicon.ico?v=${v}`, sizes: "16x16 32x32 48x48" },
      { url: url("icon-32.png"), type: "image/png", sizes: "32x32" },
      { url: url("icon-192.png"), type: "image/png", sizes: "192x192" },
      { url: url("icon-512.png"), type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: url("apple-touch-icon.png"), type: "image/png", sizes: "180x180" }],
  };
}

// ---------------------------------------------------------------------------
// PNG check and ICO container (no image library needed)
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads a PNG's real dimensions from its bytes. Returns null unless the file
 * is a well-formed PNG: signature, IHDR first, sane header values, IEND last.
 */
export function pngInfo(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 57) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(8) !== 13) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") return null;
  const width = dv.getUint32(16);
  const height = dv.getUint32(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (!width || !height || width > 4096 || height > 4096) return null;
  if (![0, 2, 3, 4, 6].includes(colorType) || ![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  if (bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) return null; // compression, filter, interlace
  // walk the chunks: every length must fit, the file must end with IEND
  let p = 8;
  let sawIend = false;
  while (p + 12 <= bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    if (!/^[A-Za-z]{4}$/.test(type) || p + 12 + len > bytes.length) return null;
    p += 12 + len;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  if (!sawIend || p !== bytes.length) return null;
  return { width, height };
}

/** A .ico file holding the given PNGs (PNG-in-ICO, supported by every current browser). */
export function buildIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const count = images.length;
  const headerSize = 6 + 16 * count;
  const total = headerSize + images.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type: icon
  dv.setUint16(4, count, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    out[e] = img.size >= 256 ? 0 : img.size; // width (0 = 256)
    out[e + 1] = img.size >= 256 ? 0 : img.size; // height
    out[e + 2] = 0; // palette
    out[e + 3] = 0; // reserved
    dv.setUint16(e + 4, 1, true); // colour planes
    dv.setUint16(e + 6, 32, true); // bits per pixel
    dv.setUint32(e + 8, img.png.length, true);
    dv.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}
