# Stock system → AN MOBILE GALLERY (one-way import)

The stock system (currently the Lovable app at `khadijatelecom1.lovable.app`) is **only a source of stock facts**.
AN MOBILE GALLERY never calls it while serving customers, so if it is offline the website keeps working.

| The stock system provides | AN MOBILE GALLERY alone controls |
|---|---|
| product id, name, brand, model, model number, SKU, RAM, storage (ROM), condition, colour, category name, quantity | selling price, discount, EMI, images, descriptions, highlights, specifications text, SEO, FAQ, homepage placement, featured / best seller, publishing |

## What happens

1. A product is added in the stock system → it sends a **signed webhook**.
2. The website matches it against existing products (external id → SKU → model number → brand + model + storage + condition).
   - Found → linked (no duplicate). Several possible matches → nothing is created; shown in Admin → AI Products for manual linking.
   - Not found → a **Draft** product is created with **price 0** (a draft can't be published until you enter a price).
3. AI analyses the draft (with automatic model failover) → status *Ready for Review* or *Needs Verification*.
4. You add photos, selling price, discount/EMI, review the AI text, set Status = Active, Save. Only then is it public.

Later changes from the stock system:

| Change | Effect on the website |
|---|---|
| Quantity | Stock updated (products without storage/colour options only; others are flagged) and logged in Inventory |
| Name / RAM / storage / other details | Product is **not** changed; AI review status becomes *Needs Verification* |
| Price | Stored for reference only. Never copied to the selling price |
| Deleted | Flagged "removed upstream". The website product is **never deleted** |

## The contract

### 1. Webhook (required)

`POST https://<your-domain>/api/integrations/stock/webhook`

Headers:

| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `x-stock-timestamp` | current Unix time in seconds |
| `x-stock-signature` | `sha256=` + hex HMAC-SHA256 of `"<timestamp>.<raw body>"` using `STOCK_WEBHOOK_SECRET` |

Requests older than 5 minutes, or with a wrong signature, are rejected (401).

Body — one product:

```json
{
  "event": "product.created",
  "product": {
    "id": "12345",
    "name": "Samsung Galaxy S25 Ultra",
    "brand": "Samsung",
    "model": "Galaxy S25 Ultra",
    "model_number": "SM-S938B",
    "sku": "KT-S25U-12-256",
    "ram": "12GB",
    "storage": "256GB",
    "condition": "new",
    "color": "Titanium Black",
    "category": "Smartphones",
    "quantity": 3,
    "sale_price": 158000,
    "notes": "optional"
  }
}
```

- `event`: `product.created`, `product.updated`, `stock.changed` or `product.deleted`.
- Required: `id` (stable, never reused) and `name`. Everything else is optional but improves matching and AI quality.
- `condition`: `new`, `used` or `refurbished` (also understood: "intact", "second hand", "renewed"). Missing → saved as New and flagged.
- `ram` / `storage`: `"12"`, `"12 GB"` or `"12GB"` all work. `rom` is accepted as an alias of `storage`.
- Several at once: `{ "products": [ ... ] }` (up to 1000).

Response: `{ "ok": true, "imported": 1, "updated": 0, "skipped": 0, "failed": 0, "ai_queued": 1 }`.

### 2. Export endpoint (optional, for "Sync stock now")

`GET STOCK_EXPORT_URL` with `Authorization: Bearer STOCK_EXPORT_TOKEN` returning `{ "products": [ ...same fields... ] }`.
Only called when an admin presses **Sync stock now**. There is no automatic polling.

## What must be built on the Lovable side

The Lovable app's database is not visible from this project, and its schema is still changing, so table and column names
below are placeholders. Map them once the stock schema is final.

1. **Field mapping** — fill in:

   | Contract field | Lovable column |
   |---|---|
   | id | `…` |
   | name | `…` |
   | brand / model / model_number / sku | `…` |
   | ram / storage | `…` |
   | condition | `…` |
   | quantity | `…` |
   | sale_price (reference only) | `…` |

2. **Send the webhook** on insert, on update and on delete of a stock product. In a Lovable (Supabase) project this is
   usually a Supabase **Edge Function** called by a **Database Webhook** on the products table. Signing example (Deno):

   ```ts
   const secret = Deno.env.get("STOCK_WEBHOOK_SECRET")!; // same value as on the website
   const body = JSON.stringify({ event: "product.created", product: mapped });
   const ts = Math.floor(Date.now() / 1000).toString();
   const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
   const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${body}`))))
     .map((b) => b.toString(16).padStart(2, "0")).join("");
   await fetch("https://<your-domain>/api/integrations/stock/webhook", {
     method: "POST",
     headers: { "content-type": "application/json", "x-stock-timestamp": ts, "x-stock-signature": `sha256=${sig}` },
     body,
   });
   ```

   Keep `STOCK_WEBHOOK_SECRET` in the Edge Function's secrets, never in the Lovable front-end code.

3. **Optional export endpoint** (another Edge Function) for manual full syncs, protected by a bearer token.

## Website setup

Cloudflare → Worker `an-mobile-gallery` → Settings → Variables and Secrets:

| Name | Type | Notes |
|---|---|---|
| `STOCK_WEBHOOK_SECRET` | Secret | 32+ random characters; same value in the Lovable Edge Function |
| `STOCK_EXPORT_URL` | Text | optional |
| `STOCK_EXPORT_TOKEN` | Secret | optional |
| `STOCK_SOURCE_NAME` | Text | optional, default `lovable` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | required for imports and AI |
| `AI_KEYS_ENCRYPTION_SECRET` | Secret | optional; AI provider keys are managed in Admin → Settings → AI |

Never put these in `.env*` files: `npm run cf:build` refuses to build if you do.

## Testing the webhook by hand

```bash
SECRET='your-secret'; TS=$(date +%s)
BODY='{"event":"product.created","product":{"id":"test-1","name":"Test Phone 8/128","brand":"Samsung","ram":"8","storage":"128","condition":"new","quantity":1}}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -X POST https://<your-domain>/api/integrations/stock/webhook \
  -H 'content-type: application/json' -H "x-stock-timestamp: $TS" -H "x-stock-signature: sha256=$SIG" -d "$BODY"
```

Then open Admin → AI Products. Delete the test draft afterwards.
