#!/usr/bin/env node
/**
 * Deployment guard for Cloudflare builds.
 *
 *   node scripts/check-env.mjs pre    (before `opennextjs-cloudflare build`)
 *   node scripts/check-env.mjs post   (after it)
 *
 * Why: the OpenNext Cloudflare adapter copies the values of .env, .env.local,
 * .env.production and .env.production.local INTO the Worker code. Secrets must
 * therefore never be in those files when building for Cloudflare. The
 * service-role key belongs in `.dev.vars` (local preview) and in a Worker
 * secret (production).
 *
 * pre:  fails if SUPABASE_SERVICE_ROLE_KEY is set in any .env* file, or if the
 *       public variables needed at build time are missing / still localhost.
 * post: scans the build output for any Supabase service-role key (legacy JWT
 *       with role "service_role", or a new "sb_secret_" key).
 *
 * Plain Node, no dependencies. Prints what to fix; never prints secret values.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const mode = process.argv[2];
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
const REQUIRED_PUBLIC = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const SECRET_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "AI_KEYS_ENCRYPTION_SECRET", "STOCK_WEBHOOK_SECRET", "STOCK_EXPORT_TOKEN"];

function parseEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]] = value;
  }
  return out;
}

function fail(lines) {
  console.error("\n✖ Cloudflare build stopped:\n");
  for (const l of lines) console.error(`  - ${l}`);
  console.error("");
  process.exit(1);
}

function pre() {
  const problems = [];
  const merged = {};
  // Lowest to highest precedence, like Next.js for a production build.
  for (const name of [".env", ".env.production", ".env.local", ".env.production.local"]) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    const vars = parseEnvFile(file);
    for (const key of SECRET_KEYS) {
      if (vars[key]) {
        problems.push(
          `${key} is set in ${name}. OpenNext would copy it into the Worker code. ` +
            `Remove it from ${name}; put it in .dev.vars for \`npm run preview\` and set it as a Worker secret for production.`,
        );
      }
    }
    Object.assign(merged, vars);
  }
  // Variables provided by the shell / CI (e.g. Workers Builds) win.
  for (const key of REQUIRED_PUBLIC) if (process.env[key]) merged[key] = process.env[key];

  for (const key of REQUIRED_PUBLIC) {
    if (!merged[key]) problems.push(`${key} is missing. Set it in .env.production.local (local build) or in Workers Builds → Build variables.`);
  }
  const site = merged.NEXT_PUBLIC_SITE_URL;
  if (site && !/^https:\/\/[^/]+$/.test(site.replace(/\/+$/, ""))) {
    problems.push(`NEXT_PUBLIC_SITE_URL must be your production https URL without a path, e.g. https://anmobilegallery.com (got "${site}").`);
  }
  if (site && /localhost|127\.0\.0\.1/.test(site)) {
    problems.push("NEXT_PUBLIC_SITE_URL points to localhost. Canonical URLs, sitemap and Open Graph would be wrong in production.");
  }
  const sb = merged.NEXT_PUBLIC_SUPABASE_URL;
  if (sb && !/^https:\/\//.test(sb)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL must start with https://");
  }
  const anon = merged.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon && isServiceRoleKey(anon)) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY contains the service-role key. Use the anon / publishable key.");
  }
  if (problems.length) fail(problems);
  console.log("✓ Cloudflare build environment OK (no secrets in .env files, public variables set).");
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isServiceRoleKey(value) {
  if (/^sb_secret_/.test(value)) return true;
  const payload = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/.test(value) ? decodeJwtPayload(value) : null;
  return Boolean(payload && payload.role === "service_role");
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.size < 20 * 1024 * 1024 && /\.(m?js|cjs|json|html|txt|map|rsc)$/.test(entry)) yield p;
  }
}

function post() {
  const dirs = [".open-next", ".next/static"].map((d) => join(ROOT, d)).filter(existsSync);
  if (!dirs.length) fail(["No build output found (.open-next). Run the Cloudflare build first."]);
  const findings = new Set();
  const jwt = /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g;
  const newSecret = /sb_secret_[\w-]{10,}/g;
  let scanned = 0;
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      scanned++;
      const text = readFileSync(file, "utf8");
      if (newSecret.test(text)) findings.add(relative(ROOT, file));
      newSecret.lastIndex = 0;
      for (const m of text.matchAll(jwt)) {
        if (decodeJwtPayload(m[0])?.role === "service_role") findings.add(relative(ROOT, file));
      }
    }
  }
  if (findings.size) {
    fail([
      "A Supabase service-role key was found in the build output:",
      ...[...findings].slice(0, 10),
      "Remove it from every .env* file, delete .open-next and .next, and build again.",
    ]);
  }
  console.log(`✓ Build output scanned (${scanned} files): no service-role key found.`);
}

if (mode === "pre") pre();
else if (mode === "post") post();
else {
  console.error("Usage: node scripts/check-env.mjs pre|post");
  process.exit(2);
}
