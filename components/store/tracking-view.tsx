import { ExternalLink, PackageCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/misc";
import { SHIPMENT_STATUS_LABEL, TRACKING_STEPS, customerStatus, isSafeTrackingUrl, type TrackingResult } from "@/lib/couriers";
import { formatDate, formatPrice } from "@/lib/utils";

/**
 * What a customer sees about one order: status, progress, courier and
 * history. Only fields returned by track_order() are used (no address, name,
 * phone or staff notes). Works in server and client components.
 */
export function TrackingView({ result, showItems = true, summary = true }: { result: TrackingResult; showItems?: boolean; summary?: boolean }) {
  const ship = result.shipment && result.shipment.active ? result.shipment : null;
  const st = customerStatus(result.status, ship?.status ?? null);
  const stopped = st.step < 0;
  const link = ship?.tracking_url && isSafeTrackingUrl(ship.tracking_url) ? ship.tracking_url : null;

  return (
    <div className="space-y-5">
      {summary ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-mute">Order</p>
          <p className="break-all text-lg font-bold">{result.order_number}</p>
        </div>
        <Badge tone={st.tone} className="text-sm">
          {st.label}
        </Badge>
      </div>
      ) : null}

      {!stopped ? (
        <ol className="grid grid-cols-7 gap-1" aria-label="Order progress">
          {TRACKING_STEPS.map((label, i) => (
            <li key={label} className="min-w-0 text-center text-[11px] leading-tight sm:text-xs">
              <span className={`block h-1.5 rounded-full ${i <= st.step ? "bg-signal" : "bg-line"}`} aria-hidden />
              <span className={`mt-1.5 hidden break-words sm:block ${i <= st.step ? "font-semibold text-ink" : "text-ink-mute"}`}>{label}</span>
              <span className="sr-only sm:hidden">
                {label}
                {i <= st.step ? " (done)" : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {summary ? (
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-mute">Placed</dt>
          <dd>{formatDate(result.placed_at, true)}</dd>
        </div>
        <div>
          <dt className="text-ink-mute">Cash on delivery total</dt>
          <dd className="price font-semibold">{formatPrice(Number(result.total))}</dd>
        </div>
      </dl>
      ) : null}

      {ship ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-paper p-4" aria-labelledby="trk-ship-h">
          <h2 id="trk-ship-h" className="flex items-center gap-2 font-bold">
            <Truck className="h-4 w-4 text-signal" aria-hidden /> Courier
          </h2>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-mute">Courier</dt>
              <dd className="font-semibold">{ship.courier_name}</dd>
            </div>
            <div>
              <dt className="text-ink-mute">Shipped</dt>
              <dd>{formatDate(ship.shipped_at, true)}</dd>
            </div>
            {ship.consignment_id ? (
              <div className="min-w-0">
                <dt className="text-ink-mute">Consignment ID</dt>
                <dd className="break-all font-mono">{ship.consignment_id}</dd>
              </div>
            ) : null}
            {ship.tracking_reference ? (
              <div className="min-w-0">
                <dt className="text-ink-mute">Tracking reference</dt>
                <dd className="break-all font-mono">{ship.tracking_reference}</dd>
              </div>
            ) : null}
          </dl>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-signal underline"
            >
              Track on the courier&apos;s website <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          {ship.events.length > 0 ? (
            <ol className="mt-4 space-y-2 border-l-2 border-line pl-4 text-sm" aria-label="Shipment history">
              {ship.events.map((e, i) => (
                <li key={`${e.status}-${e.at}-${i}`} className="relative">
                  <span className={`absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-signal" : "bg-line-strong"}`} aria-hidden />
                  <span className={i === 0 ? "font-semibold" : ""}>{SHIPMENT_STATUS_LABEL[e.status] ?? e.status}</span>
                  <span className="text-ink-mute"> · {formatDate(e.at, true)}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : result.status !== "cancelled" && result.status !== "delivered" ? (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-dashed border-line-strong p-4 text-sm text-ink-soft">
          <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Courier details appear here once your order is handed to the courier.
        </p>
      ) : null}

      {showItems && result.items.length > 0 ? (
        <section aria-labelledby="trk-items-h">
          <h2 id="trk-items-h" className="text-sm font-bold">
            Items
          </h2>
          <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line text-sm">
            {result.items.map((i, n) => (
              <li key={`${i.name}-${n}`} className="flex justify-between gap-3 px-3 py-2">
                <span className="min-w-0 break-words">
                  {i.name}
                  {i.variant ? <span className="text-ink-mute"> · {i.variant}</span> : null}
                </span>
                <span className="shrink-0 text-ink-mute">× {i.quantity}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
