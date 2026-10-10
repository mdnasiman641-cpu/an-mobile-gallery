# Courier shipments, order tracking and Pathao

Requires database migration `supabase/migrations/20261010000014_shipments_tracking.sql`
(run it in the Supabase SQL Editor after 0013). Before it is run, the order page shows a
"run the migration" notice and `/track` answers "not available right now"; nothing else changes.

## 1. Recording shipments by hand (works with any courier)

Admin → Orders → open an order (admins only; editors can't see orders or shipments).

1. Confirm the order first (status *Confirmed* or *Processing*).
2. **Shipment → Record manually**: courier, consignment ID and/or tracking reference, optional https tracking
   link, shipment date, cash to collect, staff note.
3. Saving marks the order **Shipped**. Totals, stock and payment status are never changed by shipments.

Rules enforced by the database (not only by the page):

| Rule | What happens |
|---|---|
| One active shipment per order | A second one is refused. To fix a wrong booking, set the shipment to *Shipment cancelled* (it stays in the history) and create a new one. |
| A consignment ID can't be active on two orders | Refused with a clear message. |
| Typo in the consignment / tracking reference | *Correct consignment / tracking details* with a reason; the old value is saved in the history. |
| Delivered | Only when staff choose *Delivered* or Pathao sends a verified *delivered* update. The order then becomes *Delivered*. Never inferred. |
| Delivered / Returned | Final — the shipment can't change afterwards. |
| Cancelling a shipment | The order goes back to *Processing*. |
| Admin only | Checked by `is_admin()` inside every function; customers, editors and visitors can't read or change shipments. |

Status history (who/when/source) is shown on the order page. Staff notes are never shown to customers.

## 2. Customer tracking: `/track`

Customers enter the **order number** and the **mobile number used for the order**
(footer → *Track your order*; the checkout confirmation links straight to it). Signed-in customers also see
courier details on *My account → Orders*.

- Shown: order status, courier, consignment ID / tracking reference, courier link, shipment history (status + time), items and the cash-on-delivery total.
- Never shown: name, address, phone, email, staff notes, other orders.
- A wrong phone and a wrong order number get the same answer.
- Limits: 5 wrong attempts per order and 10 per phone number per hour, then "try again in an hour"
  (the right customer is also locked out for that hour if someone else guessed — they can call the shop).

## 3. Pathao merchant API (optional)

Built from Pathao's official merchant plugin (`github.com/pathao-eng/courier-woocommerce-plugin`):

| | |
|---|---|
| Live API | `https://api-hermes.pathao.com` |
| Sandbox API | `https://courier-api-sandbox.pathao.com` |
| Login | `POST /aladdin/api/v1/external/login` (`client_id`, `client_secret`) |
| Stores / cities / zones / areas | `GET /aladdin/api/v1/stores`, `/countries/1/city-list`, `/cities/{id}/zone-list`, `/zones/{id}/area-list` |
| Create parcel | `POST /aladdin/api/v1/orders` (`merchant_order_id` = our order number) |
| Webhook | Pathao sends the secret in `X-PATHAO-Signature`; we answer `202` with Pathao's integration header |

**Status: code ready, NOT yet tested against Pathao.** It has been tested only with mocked Pathao
responses. It counts as working only after the steps below succeed with a real merchant account.

### What you need from Pathao

1. A Pathao merchant account with **Developer API** access (merchant.pathao.com → Developer API).
2. **Client ID** and **Client secret** from that page.
3. At least one **store** (pickup point) in the Pathao panel. Its ID is loaded by *Test connection*.
4. Optional: Pathao's **sandbox** credentials, if Pathao gives you a test account (choose *Sandbox* in the settings).

### Setup (Admin → Courier)

1. Environment (*Live* or *Sandbox*), Client ID, Client secret → **Test connection**. This is a real request to
   Pathao: success lists your stores. The secret is encrypted on the server (same key store as the AI keys)
   and is never sent back to the browser.
2. Pick the **pickup store**, defaults (delivery type, item type, weight), tick **Turn on Pathao parcel creation** → Save.
3. **Webhook**: *Create webhook secret* → copy it (shown once; only its SHA-256 hash is stored). In the Pathao
   panel → Developer API → Webhook, enter the callback URL shown on the page
   (`https://anmobilegadgets.com/api/integrations/pathao/webhook`) and that secret. Pathao's "integration"
   check must show success.
4. First real test: on a real confirmed order choose **Create with Pathao** → pick Pathao city/zone/area →
   create. Check the consignment ID appears in the Pathao panel.

No Cloudflare variables or paid services are needed.

### How duplicates are prevented

1. The shipment is **reserved in the database first** (one active shipment per order), then exactly one
   request goes to Pathao.
2. Pathao refuses (e.g. invalid zone): the reservation is released with Pathao's error; fix and retry.
3. No clear answer (timeout, network error, Pathao 5xx): the reservation **stays** as *Sending to courier* so the
   button can't send it again. Check the Pathao panel for the order number, then either
   **Record consignment ID** or **Not in Pathao: release**.
4. Webhook replays are stored once; delivered/returned shipments never change again; unknown parcels are ignored.

### Webhook event → shipment status

| Pathao event | Shipment status |
|---|---|
| order.picked | Picked up |
| order.at-the-sorting-hub, order.in-transit, order.received-at-last-mile-hub | In transit |
| order.assigned-for-delivery | Out for delivery |
| order.delivered | Delivered (order → Delivered) |
| order.delivery-failed | Delivery attempt failed |
| order.on-hold, order.pickup-failed | On hold |
| order.returned, order.paid-return | Returned |
| order.pickup-cancelled | Shipment cancelled |
| others (created, updated, partial-delivery, exchanged, paid, …) | Recorded as the courier status only — staff decide |

Adding another courier API later: add an adapter like `lib/couriers/pathao.ts`, its event map in
`lib/couriers.ts`, and allow the provider name in `courier_settings` (the shipment tables are already courier-neutral).
