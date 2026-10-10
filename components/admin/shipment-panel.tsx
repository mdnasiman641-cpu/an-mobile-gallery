"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Truck } from "lucide-react";
import {
  correctShipmentAction,
  createManualShipmentAction,
  createPathaoShipmentAction,
  pathaoLookupAction,
  resolvePendingShipmentAction,
  updateShipmentStatusAction,
} from "@/app/admin/(panel)/orders/shipment-actions";
import { toastResult } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge } from "@/components/ui/misc";
import {
  COURIERS,
  FINAL_SHIPMENT_STATUSES,
  MANUAL_NEXT_STATUSES,
  SHIPMENT_STATUS_LABEL,
  type ShipmentEventRow,
  type ShipmentRow,
  type ShipmentStatus,
} from "@/lib/couriers";
import { formatDate, formatPrice } from "@/lib/utils";
import type { OrderStatus } from "@/types";

export interface PathaoDefaults {
  available: boolean;
  deliveryType: 12 | 24 | 48;
  itemType: 1 | 2 | 3;
  weight: number;
}

const TONE: Record<ShipmentStatus, "neutral" | "signal" | "deal" | "warn"> = {
  pending: "warn",
  created: "signal",
  picked_up: "signal",
  in_transit: "signal",
  out_for_delivery: "signal",
  delivered: "signal",
  failed_delivery: "warn",
  on_hold: "warn",
  returned: "deal",
  cancelled: "neutral",
};

const SOURCE_LABEL = { manual: "Staff", api: "Courier API", webhook: "Courier update" } as const;

/** datetime-local value (browser time) → ISO, or undefined for "now". */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const t = new Date(local);
  return Number.isNaN(t.getTime()) ? undefined : t.toISOString();
}

export function ShipmentPanel({
  orderId,
  orderNumber,
  orderStatus,
  orderTotal,
  paid,
  itemCount,
  itemSummary,
  shipments,
  events,
  pathao,
}: {
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  orderTotal: number;
  paid: boolean;
  itemCount: number;
  itemSummary: string;
  shipments: ShipmentRow[];
  events: ShipmentEventRow[];
  pathao: PathaoDefaults;
}) {
  const active = shipments.find((s) => s.is_active) ?? null;
  const canCreate = !active && !["pending", "cancelled", "delivered"].includes(orderStatus);

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5" aria-labelledby="ship-h">
      <h2 id="ship-h" className="flex items-center gap-2 font-bold">
        <Truck className="h-4 w-4" aria-hidden /> Shipment
      </h2>

      {active && orderStatus === "cancelled" ? (
        <p className="mt-2 rounded-lg bg-warn-tint p-2.5 text-sm">The order is cancelled but this shipment is still active. Cancel it with the courier and set it to “Shipment cancelled” here.</p>
      ) : null}
      {active ? (
        <ActiveShipment shipment={active} orderNumber={orderNumber} />
      ) : orderStatus === "pending" ? (
        <p className="mt-2 text-sm text-ink-soft">Confirm the order before handing it to a courier.</p>
      ) : orderStatus === "cancelled" ? (
        <p className="mt-2 text-sm text-ink-soft">This order is cancelled.</p>
      ) : orderStatus === "delivered" && shipments.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">This order was marked delivered without a shipment record.</p>
      ) : null}

      {canCreate ? (
        <CreateShipment
          orderId={orderId}
          orderTotal={orderTotal}
          paid={paid}
          itemCount={itemCount}
          itemSummary={itemSummary}
          pathao={pathao}
          hadShipment={shipments.length > 0}
        />
      ) : null}

      {events.length > 0 ? <History shipments={shipments} events={events} /> : null}
    </section>
  );
}

// ------------------------------------------------------------------------------

function ActiveShipment({ shipment: s, orderNumber }: { shipment: ShipmentRow; orderNumber: string }) {
  const final = FINAL_SHIPMENT_STATUSES.includes(s.status);
  return (
    <div className="mt-3 space-y-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-mute">Courier</dt>
          <dd className="font-semibold">
            {s.courier_name} <span className="font-normal text-ink-mute">({s.source === "api" ? "API" : "manual"})</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-mute">Status</dt>
          <dd>
            <Badge tone={TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>
            {s.provider_status ? <span className="ml-2 text-xs text-ink-mute">courier: {s.provider_status}</span> : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-mute">Consignment ID</dt>
          <dd className="break-all font-mono">{s.consignment_id ?? "—"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-mute">Tracking reference</dt>
          <dd className="break-all">
            {s.tracking_reference ?? "—"}
            {s.tracking_url ? (
              <a href={s.tracking_url} target="_blank" rel="noopener noreferrer nofollow" className="ml-2 inline-flex items-center gap-1 text-signal underline">
                Open <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-ink-mute">Shipped</dt>
          <dd>{formatDate(s.shipped_at, true)}</dd>
        </div>
        <div>
          <dt className="text-ink-mute">Cash to collect / courier fee</dt>
          <dd className="price">
            {s.cod_amount === null ? "—" : formatPrice(Number(s.cod_amount))} / {s.courier_fee === null ? "—" : formatPrice(Number(s.courier_fee))}
          </dd>
        </div>
      </dl>
      {s.note ? <p className="rounded-lg bg-paper p-2.5 text-sm">{s.note}</p> : null}

      {s.status === "pending" ? (
        <ResolvePending shipmentId={s.id} orderNumber={orderNumber} lastError={s.last_error} />
      ) : final ? (
        <p className="text-sm text-ink-soft">This shipment is {SHIPMENT_STATUS_LABEL[s.status].toLowerCase()}. Its status can no longer change.</p>
      ) : (
        <>
          <StatusForm shipmentId={s.id} current={s.status} />
          <CorrectForm shipment={s} />
        </>
      )}
    </div>
  );
}

function StatusForm({ shipmentId, current }: { shipmentId: string; current: ShipmentStatus }) {
  const router = useRouter();
  const options = MANUAL_NEXT_STATUSES.filter((x) => x !== current);
  const [status, setStatus] = useState<ShipmentStatus>(options[0]);
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function save() {
    if (status === "delivered" && !window.confirm("Mark this shipment delivered? The order will be marked delivered too. Do this only when the courier has confirmed delivery.")) return;
    if (status === "cancelled" && !window.confirm("Cancel this shipment? The order goes back to processing so you can ship it again.")) return;
    start(async () => {
      const res = await updateShipmentStatusAction({ shipment_id: shipmentId, status, note, occurred_at: toIso(when) });
      if (toastResult(res)) {
        setNote("");
        setWhen("");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 [&>*]:min-w-0">
      <Field label="New status" htmlFor="sh-status">
        <Select id="sh-status" value={status} onChange={(e) => setStatus(e.target.value as ShipmentStatus)}>
          {options.map((k) => (
            <option key={k} value={k}>
              {SHIPMENT_STATUS_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="When" htmlFor="sh-when" hint="Leave empty for now">
        <Input id="sh-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Staff note" htmlFor="sh-note" hint="Not shown to the customer" className="sm:col-span-2">
        <Input id="sh-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <div className="sm:col-span-2">
        <Button onClick={save} loading={pending} size="sm">
          Update shipment status
        </Button>
      </div>
    </div>
  );
}

function CorrectForm({ shipment: s }: { shipment: ShipmentRow }) {
  const router = useRouter();
  const [consignment, setConsignment] = useState(s.consignment_id ?? "");
  const [reference, setReference] = useState(s.tracking_reference ?? "");
  const [url, setUrl] = useState(s.tracking_url ?? "");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await correctShipmentAction({ shipment_id: s.id, consignment_id: consignment, tracking_reference: reference, tracking_url: url, reason });
      if (toastResult(res)) {
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">Correct consignment / tracking details</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <Field label="Consignment ID" htmlFor="cx-cons">
          <Input id="cx-cons" value={consignment} onChange={(e) => setConsignment(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Tracking reference" htmlFor="cx-ref">
          <Input id="cx-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Tracking link (https://)" htmlFor="cx-url" className="sm:col-span-2">
          <Input id="cx-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Reason for the correction" htmlFor="cx-reason" hint="Saved in the history with the old value" className="sm:col-span-2">
          <Input id="cx-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </Field>
        <div className="sm:col-span-2">
          <Button onClick={save} loading={pending} size="sm" variant="outline">
            Save correction
          </Button>
        </div>
      </div>
    </details>
  );
}

function ResolvePending({ shipmentId, orderNumber, lastError }: { shipmentId: string; orderNumber: string; lastError: string | null }) {
  const router = useRouter();
  const [consignment, setConsignment] = useState("");
  const [pending, start] = useTransition();

  function found() {
    start(async () => {
      const res = await resolvePendingShipmentAction({ shipment_id: shipmentId, outcome: "found", consignment_id: consignment });
      if (toastResult(res)) router.refresh();
    });
  }
  function notCreated() {
    if (!window.confirm(`Release the reservation? Only do this after checking the Pathao panel: order ${orderNumber} must NOT be there.`)) return;
    start(async () => {
      const res = await resolvePendingShipmentAction({ shipment_id: shipmentId, outcome: "not_created" });
      if (toastResult(res)) router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-warn/30 bg-warn-tint p-3 text-sm">
      <p>
        Pathao did not give a clear answer, so this shipment is reserved to stop the parcel being sent twice. Check the Pathao merchant panel for order{" "}
        <span className="font-mono font-semibold">{orderNumber}</span>.
      </p>
      {lastError ? <p className="text-ink-soft">Last error: {lastError}</p> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Consignment ID shown by Pathao" htmlFor="rp-cons" className="min-w-0 flex-1 basis-56">
          <Input id="rp-cons" value={consignment} onChange={(e) => setConsignment(e.target.value)} maxLength={80} />
        </Field>
        <Button onClick={found} loading={pending} size="sm" disabled={!consignment.trim()}>
          Record consignment ID
        </Button>
        <Button onClick={notCreated} disabled={pending} size="sm" variant="outline">
          Not in Pathao: release
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------

function CreateShipment(props: {
  orderId: string;
  orderTotal: number;
  paid: boolean;
  itemCount: number;
  itemSummary: string;
  pathao: PathaoDefaults;
  hadShipment: boolean;
}) {
  const [mode, setMode] = useState<"manual" | "pathao">("manual");
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-ink-soft">
        {props.hadShipment ? "The previous shipment was cancelled. Create a new one:" : "Hand this order to a courier:"}
      </p>
      {props.pathao.available ? (
        <div className="inline-flex rounded-lg border border-line p-0.5 text-sm" role="tablist" aria-label="How to create the shipment">
          {(["manual", "pathao"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1.5 font-semibold ${mode === m ? "bg-ink text-white" : "text-ink-soft"}`}
            >
              {m === "manual" ? "Record manually" : "Create with Pathao"}
            </button>
          ))}
        </div>
      ) : null}
      {mode === "pathao" && props.pathao.available ? <PathaoForm {...props} /> : <ManualForm {...props} />}
    </div>
  );
}

function ManualForm({ orderId, orderTotal, paid }: { orderId: string; orderTotal: number; paid: boolean }) {
  const router = useRouter();
  const [courier, setCourier] = useState<string>("pathao");
  const [courierName, setCourierName] = useState("");
  const [consignment, setConsignment] = useState("");
  const [reference, setReference] = useState("");
  const [url, setUrl] = useState("");
  const [when, setWhen] = useState("");
  const [cod, setCod] = useState(paid ? "0" : String(Math.round(orderTotal)));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await createManualShipmentAction({
        order_id: orderId,
        courier,
        courier_name: courierName,
        consignment_id: consignment,
        tracking_reference: reference,
        tracking_url: url,
        shipped_at: toIso(when),
        cod_amount: cod,
        note,
      });
      if (toastResult(res)) router.refresh();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
      <Field label="Courier" htmlFor="ms-courier" required>
        <Select id="ms-courier" value={courier} onChange={(e) => setCourier(e.target.value)}>
          {COURIERS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      {courier === "other" ? (
        <Field label="Courier name" htmlFor="ms-cname" required>
          <Input id="ms-cname" value={courierName} onChange={(e) => setCourierName(e.target.value)} maxLength={60} />
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}
      <Field label="Consignment ID" htmlFor="ms-cons" hint="From the courier's receipt or panel">
        <Input id="ms-cons" value={consignment} onChange={(e) => setConsignment(e.target.value)} maxLength={80} />
      </Field>
      <Field label="Tracking reference" htmlFor="ms-ref" hint="If different from the consignment ID">
        <Input id="ms-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
      </Field>
      <Field label="Tracking link (optional, https://)" htmlFor="ms-url" className="sm:col-span-2">
        <Input id="ms-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} />
      </Field>
      <Field label="Shipment date" htmlFor="ms-when" hint="Leave empty for now">
        <Input id="ms-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label="Cash to collect (৳)" htmlFor="ms-cod">
        <Input id="ms-cod" type="number" inputMode="numeric" min={0} value={cod} onChange={(e) => setCod(e.target.value)} />
      </Field>
      <Field label="Staff note" htmlFor="ms-note" hint="Not shown to the customer" className="sm:col-span-2">
        <Textarea id="ms-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <div className="sm:col-span-2">
        <Button onClick={save} loading={pending} disabled={!consignment.trim() && !reference.trim()}>
          Save shipment
        </Button>
        <p className="mt-2 text-xs text-ink-mute">Saving marks the order shipped. Totals, stock and payment are not changed.</p>
      </div>
    </div>
  );
}

type Opt = { id: number; name: string };

function PathaoForm({ orderId, orderTotal, paid, itemCount, itemSummary, pathao }: { orderId: string; orderTotal: number; paid: boolean; itemCount: number; itemSummary: string; pathao: PathaoDefaults }) {
  const router = useRouter();
  const [cities, setCities] = useState<Opt[] | null>(null);
  const [zones, setZones] = useState<Opt[]>([]);
  const [areas, setAreas] = useState<Opt[]>([]);
  const [city, setCity] = useState("");
  const [zone, setZone] = useState("");
  const [area, setArea] = useState("");
  const [deliveryType, setDeliveryType] = useState<12 | 24 | 48>(pathao.deliveryType);
  const [itemType, setItemType] = useState<1 | 2 | 3>(pathao.itemType);
  const [weight, setWeight] = useState(String(pathao.weight));
  const [quantity, setQuantity] = useState(String(Math.max(1, itemCount)));
  const [amount, setAmount] = useState(paid ? "0" : String(Math.round(orderTotal)));
  const [description, setDescription] = useState(itemSummary.slice(0, 250));
  const [instruction, setInstruction] = useState("");
  const [loading, startLoad] = useTransition();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load(kind: "cities" | "zones" | "areas", parent?: string) {
    setError(null);
    startLoad(async () => {
      const res = await pathaoLookupAction(kind === "cities" ? { kind } : { kind, parent });
      if (!res.ok || !res.data) {
        setError(res.message ?? "Couldn't load the list from Pathao.");
        return;
      }
      if (kind === "cities") setCities(res.data);
      else if (kind === "zones") setZones(res.data);
      else setAreas(res.data);
    });
  }

  function submit() {
    if (!window.confirm("Send this parcel to Pathao? Pathao will schedule a pickup.")) return;
    setError(null);
    start(async () => {
      const res = await createPathaoShipmentAction({
        order_id: orderId,
        city_id: city,
        zone_id: zone,
        area_id: area,
        delivery_type: deliveryType,
        item_type: itemType,
        item_weight: weight,
        item_quantity: quantity,
        amount_to_collect: amount,
        item_description: description,
        special_instruction: instruction,
      });
      toastResult(res);
      if (!res.ok) setError(res.message ?? null);
      if (res.ok || res.data?.pending) router.refresh();
    });
  }

  if (!cities) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-soft">Pathao needs its own city, zone and area for the address.</p>
        <Button size="sm" variant="outline" onClick={() => load("cities")} loading={loading}>
          Load Pathao cities
        </Button>
        {error ? (
          <p className="text-sm text-deal" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      <Field label="City" htmlFor="pa-city" required>
        <Select
          id="pa-city"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setZone("");
            setArea("");
            setZones([]);
            setAreas([]);
            if (e.target.value) load("zones", e.target.value);
          }}
        >
          <option value="">Choose…</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Zone" htmlFor="pa-zone" required>
        <Select
          id="pa-zone"
          value={zone}
          disabled={!zones.length}
          onChange={(e) => {
            setZone(e.target.value);
            setArea("");
            setAreas([]);
            if (e.target.value) load("areas", e.target.value);
          }}
        >
          <option value="">{loading && city && !zones.length ? "Loading…" : "Choose…"}</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Area (optional)" htmlFor="pa-area">
        <Select id="pa-area" value={area} disabled={!areas.length} onChange={(e) => setArea(e.target.value)}>
          <option value="">{areas.length ? "Choose…" : "—"}</option>
          {areas.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Delivery type" htmlFor="pa-dt">
        <Select id="pa-dt" value={deliveryType} onChange={(e) => setDeliveryType(Number(e.target.value) as 12 | 24 | 48)}>
          <option value={48}>Normal</option>
          <option value={24}>Express</option>
          <option value={12}>On demand</option>
        </Select>
      </Field>
      <Field label="Item type" htmlFor="pa-it">
        <Select id="pa-it" value={itemType} onChange={(e) => setItemType(Number(e.target.value) as 1 | 2 | 3)}>
          <option value={2}>Parcel</option>
          <option value={3}>Fragile</option>
          <option value={1}>Document</option>
        </Select>
      </Field>
      <Field label="Weight (kg)" htmlFor="pa-w">
        <Input id="pa-w" type="number" inputMode="decimal" min={0.1} max={50} step={0.1} value={weight} onChange={(e) => setWeight(e.target.value)} />
      </Field>
      <Field label="Quantity" htmlFor="pa-q">
        <Input id="pa-q" type="number" inputMode="numeric" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </Field>
      <Field label="Cash to collect (৳)" htmlFor="pa-amt" className="sm:col-span-2">
        <Input id="pa-amt" type="number" inputMode="numeric" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Item description" htmlFor="pa-desc" className="sm:col-span-3">
        <Input id="pa-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={250} />
      </Field>
      <Field label="Instruction for the rider (optional)" htmlFor="pa-ins" className="sm:col-span-3">
        <Input id="pa-ins" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={250} />
      </Field>
      {error ? (
        <p className="text-sm text-deal sm:col-span-3" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-3">
        <Button onClick={submit} loading={pending} disabled={!city || !zone}>
          Create Pathao parcel
        </Button>
        <p className="mt-2 text-xs text-ink-mute">The customer&apos;s name, phone and address are sent from the order. One parcel per order: the button can&apos;t create a duplicate.</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------

function History({ shipments, events }: { shipments: ShipmentRow[]; events: ShipmentEventRow[] }) {
  const byId = new Map(shipments.map((s) => [s.id, s]));
  return (
    <div className="mt-5">
      <h3 className="text-sm font-bold">History</h3>
      <ol className="mt-2 space-y-2 border-l-2 border-line pl-4 text-sm">
        {events.map((e) => {
          const s = byId.get(e.shipment_id);
          return (
            <li key={e.id} className="relative [overflow-wrap:anywhere]">
              <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-line-strong" aria-hidden />
              <span className="font-semibold">{SHIPMENT_STATUS_LABEL[e.status]}</span>
              <span className="text-ink-mute">
                {" "}
                · {formatDate(e.occurred_at, true)} · {SOURCE_LABEL[e.source]}
                {s ? ` · ${s.courier_name}${s.consignment_id ? ` ${s.consignment_id}` : ""}${s.is_active ? "" : " (inactive)"}` : ""}
              </span>
              {e.provider_status ? <span className="block text-xs text-ink-mute">courier status: {e.provider_status}</span> : null}
              {e.note ? <span className="block break-words text-ink-soft">{e.note}</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
