import "server-only";

/**
 * Pathao Courier (merchant API) adapter.
 *
 * Endpoints and payloads follow Pathao's official WooCommerce plugin
 * (github.com/pathao-eng/courier-woocommerce-plugin, 2026-09):
 *   live     https://api-hermes.pathao.com
 *   sandbox  https://courier-api-sandbox.pathao.com
 *   POST /aladdin/api/v1/external/login        { client_id, client_secret } -> { access_token, expires_in }
 *   GET  /aladdin/api/v1/stores
 *   GET  /aladdin/api/v1/countries/1/city-list
 *   GET  /aladdin/api/v1/cities/{city}/zone-list
 *   GET  /aladdin/api/v1/zones/{zone}/area-list
 *   POST /aladdin/api/v1/orders                 -> { data: { consignment_id, order_status, delivery_fee } }
 * Credentials never leave the server; error messages are cleaned of them.
 * This module has only been tested against recorded/mocked responses until
 * a real merchant account is configured.
 */

export type PathaoEnvironment = "live" | "sandbox";

export interface PathaoConfig {
  environment: PathaoEnvironment;
  clientId: string;
  clientSecret: string;
  storeId: number | null;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class CourierApiError extends Error {
  constructor(
    message: string,
    public kind: "auth" | "validation" | "network" | "timeout" | "server" | "config",
    /** The request may have reached the courier (timeout / 5xx while creating): don't retry blindly. */
    public ambiguous = false,
    public status: number | null = null,
  ) {
    super(message);
    this.name = "CourierApiError";
  }
}

export const PATHAO_BASE: Record<PathaoEnvironment, string> = {
  live: "https://api-hermes.pathao.com",
  sandbox: "https://courier-api-sandbox.pathao.com",
};

const TIMEOUT_MS = 20_000;

function clean(text: string, secrets: (string | null | undefined)[]): string {
  let s = text;
  for (const x of secrets) if (x && x.length >= 4) s = s.split(x).join("[redacted]");
  s = s.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim();
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

/** Pathao validation errors: { message, errors: { field: ["..."] } } -> one readable line. */
function describe(body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; errors?: Record<string, unknown> };
  const parts: string[] = [];
  if (typeof b.message === "string") parts.push(b.message);
  if (b.errors && typeof b.errors === "object") {
    for (const [field, v] of Object.entries(b.errors)) {
      const msg = Array.isArray(v) ? v.join(" ") : String(v);
      parts.push(`${field}: ${msg}`);
    }
  }
  return parts.join(" — ") || "No details from Pathao";
}

export class PathaoClient {
  private token: string | null = null;
  private secrets: string[];

  constructor(
    private config: PathaoConfig,
    private opts: {
      fetchImpl?: FetchLike;
      /** Cached token from the database (decrypted), if still valid. */
      cachedToken?: { token: string; expiresAt: number } | null;
      /** Persist a new token (encrypted) so the next request doesn't log in again. */
      onToken?: (token: string, expiresAt: number) => Promise<void>;
      now?: () => number;
    } = {},
  ) {
    this.secrets = [config.clientSecret, config.clientId];
    const now = (opts.now ?? Date.now)();
    if (opts.cachedToken && opts.cachedToken.expiresAt - 60_000 > now) this.token = opts.cachedToken.token;
  }

  private get base() {
    return PATHAO_BASE[this.config.environment];
  }

  private async request(method: "GET" | "POST", path: string, body: unknown, auth: boolean, creating = false): Promise<unknown> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
    if (auth) headers.authorization = `Bearer ${await this.accessToken()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (e) {
      const timedOut = controller.signal.aborted;
      throw new CourierApiError(
        timedOut ? "Pathao did not answer within 20 seconds." : `Couldn't reach Pathao: ${clean(String((e as Error).message ?? e), this.secrets)}`,
        timedOut ? "timeout" : "network",
        creating,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (res.status === 401 || res.status === 403) {
      if (auth && this.token) this.token = null;
      throw new CourierApiError(`Pathao rejected the credentials (${res.status}): ${clean(describe(parsed), this.secrets)}`, "auth", false, res.status);
    }
    if (res.status === 422 || res.status === 400) throw new CourierApiError(clean(describe(parsed), this.secrets), "validation", false, res.status);
    if (!res.ok) throw new CourierApiError(`Pathao error ${res.status}: ${clean(describe(parsed), this.secrets)}`, "server", creating && res.status >= 500, res.status);
    if (parsed === null) throw new CourierApiError("Pathao returned an answer that isn't JSON.", "server", creating, res.status);
    return parsed;
  }

  async accessToken(): Promise<string> {
    if (this.token) return this.token;
    if (!this.config.clientId || !this.config.clientSecret) throw new CourierApiError("Enter the Pathao client ID and client secret in Settings → Courier.", "config");
    const data = (await this.request("POST", "/aladdin/api/v1/external/login", { client_id: this.config.clientId, client_secret: this.config.clientSecret }, false)) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) throw new CourierApiError("Pathao didn't return an access token.", "auth");
    this.token = data.access_token;
    const expiresAt = (this.opts.now ?? Date.now)() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
    await this.opts.onToken?.(data.access_token, expiresAt);
    return data.access_token;
  }

  private list<T>(body: unknown): T[] {
    const d = (body as { data?: { data?: unknown } | unknown[] })?.data;
    if (Array.isArray(d)) return d as T[];
    const inner = (d as { data?: unknown })?.data;
    return Array.isArray(inner) ? (inner as T[]) : [];
  }

  async stores() {
    return this.list<{ store_id: number; store_name: string; store_address?: string; is_active?: number | boolean }>(await this.request("GET", "/aladdin/api/v1/stores", undefined, true)).map((s) => ({
      id: Number(s.store_id),
      name: String(s.store_name ?? ""),
      address: s.store_address ? String(s.store_address) : null,
      active: s.is_active === undefined ? true : Boolean(s.is_active),
    }));
  }

  async cities() {
    return this.list<{ city_id: number; city_name: string }>(await this.request("GET", "/aladdin/api/v1/countries/1/city-list", undefined, true)).map((c) => ({ id: Number(c.city_id), name: String(c.city_name) }));
  }

  async zones(cityId: number) {
    return this.list<{ zone_id: number; zone_name: string }>(await this.request("GET", `/aladdin/api/v1/cities/${cityId}/zone-list`, undefined, true)).map((z) => ({ id: Number(z.zone_id), name: String(z.zone_name) }));
  }

  async areas(zoneId: number) {
    return this.list<{ area_id: number; area_name: string; home_delivery_available?: boolean }>(await this.request("GET", `/aladdin/api/v1/zones/${zoneId}/area-list`, undefined, true)).map((a) => ({
      id: Number(a.area_id),
      name: String(a.area_name),
      homeDelivery: a.home_delivery_available !== false,
    }));
  }

  /** Create a parcel. One call per order: the caller reserves the shipment first. */
  async createParcel(p: PathaoParcel): Promise<{ consignmentId: string; deliveryFee: number | null; providerStatus: string | null }> {
    if (!this.config.storeId) throw new CourierApiError("Choose the Pathao store (pickup point) in Settings → Courier.", "config");
    const payload = {
      store_id: this.config.storeId,
      merchant_order_id: p.merchantOrderId,
      recipient_name: p.recipientName.slice(0, 100),
      recipient_phone: p.recipientPhone,
      ...(p.recipientSecondaryPhone ? { recipient_secondary_phone: p.recipientSecondaryPhone } : {}),
      recipient_address: p.recipientAddress.slice(0, 220),
      recipient_city: p.cityId,
      recipient_zone: p.zoneId,
      ...(p.areaId ? { recipient_area: p.areaId } : {}),
      delivery_type: p.deliveryType,
      item_type: p.itemType,
      special_instruction: (p.specialInstruction ?? "").slice(0, 250),
      item_quantity: p.itemQuantity,
      item_weight: p.itemWeight,
      amount_to_collect: Math.round(p.amountToCollect),
      item_description: (p.itemDescription ?? "").slice(0, 250),
    };
    const res = (await this.request("POST", "/aladdin/api/v1/orders", payload, true, true)) as { data?: { consignment_id?: string; order_status?: string; delivery_fee?: number | string } };
    const consignmentId = res.data?.consignment_id ? String(res.data.consignment_id) : "";
    if (!consignmentId) throw new CourierApiError("Pathao accepted the request but returned no consignment ID. Check the Pathao panel before trying again.", "server", true);
    const fee = res.data?.delivery_fee === undefined || res.data?.delivery_fee === null ? null : Number(res.data.delivery_fee);
    return { consignmentId, deliveryFee: Number.isFinite(fee) ? fee : null, providerStatus: res.data?.order_status ? String(res.data.order_status) : null };
  }
}

export interface PathaoParcel {
  merchantOrderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientSecondaryPhone?: string | null;
  recipientAddress: string;
  cityId: number;
  zoneId: number;
  areaId?: number | null;
  deliveryType: 12 | 24 | 48;
  itemType: 1 | 2 | 3;
  itemQuantity: number;
  itemWeight: number;
  amountToCollect: number;
  itemDescription?: string;
  specialInstruction?: string;
}

/** Pathao expects this exact header on every webhook answer (official plugin). */
export const PATHAO_WEBHOOK_RESPONSE_HEADER = { "X-Pathao-Merchant-Webhook-Integration-Secret": "f3992ecc-59da-4cbe-a049-a13da2018d51" };
