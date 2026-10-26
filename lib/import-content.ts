/**
 * "Import from a link": the description and SEO text built instantly (no AI) from the facts that
 * were imported from the page — the specification rows — in the shop's own words. Nothing of the
 * other site's prose, prices or name is used. Returns null when the page gave too few facts; the
 * form then asks AI for the description and SEO instead.
 */

export interface ImportContentInput {
  name: string;
  brand: string | null;
  ram: string;
  storage: string;
  condition: "new" | "used" | "refurbished";
  storeName: string;
  specs: { name: string; value: string }[];
}

export interface ImportContent {
  short_description: string;
  description: string;
  meta_title: string;
  meta_description: string;
}

/** At least this many of display / chipset / camera / battery are needed for a useful text. */
export const MIN_IMPORT_FACTS = 3;

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/[\s,;.]+\S*$/, "")}…`);

/** The first, most useful part of a spec value: "6.75 inches, 109.7 cm2 (~84%)" → "6.75 inches". */
function short(v: string | undefined, max = 60): string | null {
  if (!v) return null;
  const first = v.split(/;|\n|\s\(|,\s/)[0].replace(/\s+/g, " ").trim();
  if (!first || /^(no|n\/a|none|-|unknown)$/i.test(first)) return null;
  return first.length > max ? null : first;
}

const inches = (v: string | null) => (v ? v.replace(/\s*(inches|inch|in)\b\.?/i, "-inch").replace(/\s+-inch/, "-inch") : null);
/** "1920x1080" → "1080p", "3840x2160" → "4K". */
function videoLabel(v: string | null): string | null {
  if (!v) return null;
  const m = /(\d{3,4})\s*[x×]\s*(\d{3,4})/.exec(v);
  if (!m) return v;
  const h = Math.min(Number(m[1]), Number(m[2]));
  return h >= 2160 ? "4K" : `${h}p`;
}

const mp = (v: string | null) => (v ? v.replace(/\s*mp\b/gi, "MP") : null);

export function buildImportContent(input: ImportContentInput): ImportContent | null {
  const get = (...labels: string[]) => {
    for (const l of labels) {
      const row = input.specs.find((r) => r.name.trim().toLowerCase() === l.toLowerCase() && r.value.trim());
      if (row) return row.value.trim();
    }
    return undefined;
  };
  const size = inches(short(get("Size"), 20));
  const panel = short(get("Display"), 40);
  const refresh = short(get("Refresh rate"), 12);
  const resolution = short(get("Resolution"), 40);
  const protection = short(get("Screen protection"), 40);
  const chipset = short(get("Chipset"), 50);
  const gpu = short(get("GPU"), 30);
  // pages differ: "Rear camera: Single" + "Main camera: 13 MP, f/2.2" → "13MP"
  const camera = (...labels: string[]) => {
    for (const l of labels) {
      const m = /\d+(\.\d+)?\s*MP(\s*\+\s*\d+(\.\d+)?\s*MP)*/i.exec(get(l) ?? "");
      if (m) return mp(m[0].replace(/\s*\+\s*/g, " + "));
    }
    return null;
  };
  const osRaw = short(get("Operating system", "OS"), 40);
  const os = osRaw && /[a-z]{3,}/i.test(osRaw) && !/^v?\d/i.test(osRaw) ? osRaw : null;
  const rear = camera("Rear camera", "Main camera");
  const front = camera("Front camera", "Selfie camera");
  const video = videoLabel(short(get("Video recording"), 30));
  const battery = short(get("Battery"), 20);
  const charging = short(get("Charging", "Quick Charging", "Fast charging"), 30);
  const networkRaw = get("Network")?.replace(/\s+/g, " ").trim();
  const network = networkRaw && networkRaw.length <= 40 ? networkRaw : null;
  const fpRaw = short(get("Fingerprint sensor"), 40);
  const fpWhere = short(get("Finger Sensor Position", "Fingerprint position"), 30);
  const fingerprint = fpRaw && /^yes$/i.test(fpRaw) ? (fpWhere ?? "Yes") : fpRaw;
  const expandable = short(get("Expandable storage"), 50);

  const facts = [size || panel, chipset, rear, battery].filter(Boolean).length;
  if (facts < MIN_IMPORT_FACTS) return null;

  const memory = `${input.ram}/${input.storage}`;
  const hasMemory = input.name.toUpperCase().replace(/\s+/g, "").includes(memory.toUpperCase().replace(/\s+/g, ""));
  const full = hasMemory ? input.name : `${input.name} ${memory}`;
  const cond = input.condition === "used" ? "checked used" : input.condition === "refurbished" ? "refurbished" : "brand-new";
  const screen = [size, panel && !/^\d/.test(panel) ? panel : null].filter(Boolean).join(" ");
  const is5g = network ? /5g/i.test(network) : false;

  const paras: string[] = [];
  paras.push(
    `The ${full} is a ${is5g ? "5G " : ""}smartphone${input.brand && !input.name.toLowerCase().startsWith(input.brand.toLowerCase()) ? ` from ${input.brand}` : ""} with ${input.ram} RAM and ${input.storage} of storage, available as a ${cond} phone at ${input.storeName}.`,
  );
  if (screen) {
    paras.push(
      `It has a ${screen} display${refresh ? ` with a ${refresh} refresh rate` : ""}${resolution ? ` (${resolution})` : ""}${protection ? `, protected by ${protection}` : ""} — comfortable for videos, social media and games.`,
    );
  }
  if (chipset || os) {
    paras.push(
      `${chipset ? `The ${chipset} chipset${gpu ? ` with ${gpu} graphics` : ""} and ${input.ram} RAM handle everyday apps and multitasking` : `${input.ram} RAM handles everyday apps and multitasking`}${os ? `, running ${os}` : ""}. ${input.storage} of storage gives room for apps, photos and videos${expandable && !/^no/i.test(expandable) ? `, and a memory card can add more (${expandable})` : ""}.`,
    );
  }
  if (rear || front) {
    paras.push(
      `${rear ? `For photos there is a ${rear} rear camera${video ? ` that records video up to ${video}` : ""}` : "There is a rear camera for photos"}${front ? `, and a ${front} front camera for selfies and video calls` : ""}.`,
    );
  }
  if (battery) paras.push(`A ${battery} battery keeps it going through the day${charging ? `, with ${charging} charging` : ""}.`);

  const keys: string[] = [];
  if (screen) keys.push(`Display: ${screen}${refresh ? `, ${refresh}` : ""}`);
  if (chipset) keys.push(`Chipset: ${chipset}`);
  keys.push(`Memory: ${input.ram} RAM, ${input.storage} storage`);
  if (rear) keys.push(`Rear camera: ${rear}`);
  if (front) keys.push(`Front camera: ${front}`);
  if (battery) keys.push(`Battery: ${battery}${charging ? `, ${charging} charging` : ""}`);
  if (os) keys.push(`OS: ${os}`);
  if (network) keys.push(`Network: ${network}`);
  if (fingerprint) keys.push(`Fingerprint: ${fingerprint}`);

  const description = `${paras.join("\n\n")}\n\n## Key specifications\n${keys.map((k) => `- ${k}`).join("\n")}\n\nBuy the ${full} from ${input.storeName}. Check the photos and full specifications, then order online or visit the shop.`;

  const shortBits = [screen ? `${screen} display` : null, chipset, rear ? `${rear} camera` : null, battery ? `${battery} battery` : null].filter(Boolean) as string[];
  const shortText = `${full} with ${shortBits.length > 1 ? `${shortBits.slice(0, -1).join(", ")} and ${shortBits.at(-1)}` : shortBits[0]}.`;

  const metaBits = [screen ? `${screen} display` : null, chipset, rear ? `${rear} camera` : null, battery ? `${battery} battery` : null].filter(Boolean).join(", ");
  const metaDescription = clip(`${full}: ${metaBits}. ${input.condition === "new" ? "New" : input.condition === "used" ? "Checked used" : "Refurbished"} phone at ${input.storeName}, Bangladesh.`, 160);

  return {
    short_description: clip(shortText, 300),
    description,
    meta_title: clip(`${full} Price in Bangladesh`, 70),
    meta_description: metaDescription,
  };
}
