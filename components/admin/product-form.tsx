"use client";

import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, ExternalLink, ImagePlus, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { saveProductAction, duplicateProductAction, deleteProductAction } from "@/app/admin/(panel)/products/actions";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { RichText } from "@/components/ui/rich-text";
import { ConfirmButton } from "@/components/admin/ui";
import { uploadImage } from "@/lib/image-upload";
import { productSeoDescription, productSeoTitle } from "@/lib/seo";
import { slugify } from "@/lib/slug";
import { cn, discountPercent, formatPrice, isSvg } from "@/lib/utils";
import type { ProductFormValues, VariantRow } from "@/lib/product-form-values";
import type { Brand, Category, ProductCondition, ProductStatus } from "@/types";

const TABS = ["Basic information", "Pricing", "Inventory", "Images", "Variants", "Specifications", "Description", "SEO"] as const;
type Tab = (typeof TABS)[number];

const COMMON_SPECS: [string, string][] = [
  ["Display", "Size"],
  ["Display", "Type"],
  ["Platform", "Processor"],
  ["Platform", "OS"],
  ["Memory", "RAM"],
  ["Memory", "Storage"],
  ["Camera", "Rear camera"],
  ["Camera", "Front camera"],
  ["Battery", "Battery"],
  ["Connectivity", "Network"],
  ["Body", "Weight"],
];

const newKey = () => Math.random().toString(36).slice(2);

export function ProductForm({
  initial,
  brands,
  categories,
  storeName,
  canSeeCost,
}: {
  initial: ProductFormValues;
  brands: Pick<Brand, "id" | "name">[];
  categories: Pick<Category, "id" | "name" | "parent_id">[];
  storeName: string;
  canSeeCost: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<ProductFormValues>(initial);
  const [tab, setTab] = useState<Tab>("Basic information");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = !initial.id;

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const hasVariants = v.variants.length > 0;

  // ---------------------------------------------------------------- images
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, 15 - v.images.length);
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const up = await uploadImage(file, "products");
        setV((prev) => ({
          ...prev,
          images: [...prev.images, { key: newKey(), url: up.url, storage_path: up.path, alt_text: "", width: up.width, height: up.height }],
        }));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function moveImage(index: number, dir: -1 | 1) {
    setV((prev) => {
      const images = [...prev.images];
      const target = index + dir;
      if (target < 0 || target >= images.length) return prev;
      [images[index], images[target]] = [images[target], images[index]];
      return { ...prev, images };
    });
  }

  function makePrimary(index: number) {
    setV((prev) => {
      const images = [...prev.images];
      const [img] = images.splice(index, 1);
      return { ...prev, images: [img, ...images] };
    });
  }

  // -------------------------------------------------------------- variants
  const [genStorage, setGenStorage] = useState("");
  const [genColors, setGenColors] = useState("");
  const [genRam, setGenRam] = useState("");

  function addVariant(partial: Partial<VariantRow> = {}) {
    setV((prev) => ({
      ...prev,
      variants: [
        ...prev.variants,
        {
          key: newKey(),
          sku: "",
          storage: "",
          ram: "",
          color: "",
          color_hex: "",
          price: prev.price,
          sale_price: prev.sale_price,
          stock: "0",
          image_url: "",
          status: "active",
          ...partial,
        },
      ],
    }));
  }

  function generateVariants() {
    const storages = genStorage.split(",").map((s) => s.trim()).filter(Boolean);
    const colors = genColors.split(",").map((s) => s.trim()).filter(Boolean);
    const combos = (storages.length ? storages : [""]).flatMap((s) => (colors.length ? colors : [""]).map((c) => ({ storage: s, color: c })));
    const existing = new Set(v.variants.map((x) => `${x.storage}|${x.color}`.toLowerCase()));
    let added = 0;
    for (const c of combos) {
      if (!c.storage && !c.color) continue;
      if (existing.has(`${c.storage}|${c.color}`.toLowerCase())) continue;
      addVariant({ storage: c.storage, color: c.color, ram: genRam.trim() });
      added++;
    }
    toast(added ? `Added ${added} variant${added === 1 ? "" : "s"}. Set each price and stock.` : "Those combinations already exist.");
  }

  const updateVariant = (key: string, patch: Partial<VariantRow>) =>
    setV((prev) => ({ ...prev, variants: prev.variants.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));

  // ------------------------------------------------------------------ save
  function save(statusOverride?: ProductStatus) {
    const product = {
      name: v.name,
      slug: v.slug,
      model: v.model,
      brand_id: v.brand_id || null,
      category_id: v.category_id || null,
      sku: v.sku,
      barcode: v.barcode,
      mpn: v.mpn,
      short_description: v.short_description,
      description: v.description,
      price: v.price === "" ? (hasVariants ? v.variants[0]?.price || "0" : "") : v.price,
      sale_price: v.sale_price,
      cost_price: v.cost_price,
      stock_quantity: v.stock_quantity || "0",
      low_stock_threshold: v.low_stock_threshold || "0",
      condition: v.condition,
      status: statusOverride ?? v.status,
      featured: v.featured,
      is_new: v.is_new,
      is_offer: v.is_offer,
      is_best_seller: v.is_best_seller,
      warranty: v.warranty,
      meta_title: v.meta_title,
      meta_description: v.meta_description,
      canonical_url: v.canonical_url,
    };

    startSave(async () => {
      const res = await saveProductAction({
        id: initial.id ?? null,
        product,
        variants: v.variants.map((x) => ({
          id: x.id ?? null,
          sku: x.sku,
          storage: x.storage,
          ram: x.ram,
          color: x.color,
          color_hex: x.color_hex,
          price: x.price,
          sale_price: x.sale_price,
          stock: x.stock || "0",
          image_url: x.image_url,
          status: x.status,
        })),
        specs: v.specs.filter((s) => s.name.trim() && s.value.trim()),
        features: v.features.map((f) => f.trim()).filter(Boolean),
        images: v.images.map((i) => ({
          id: i.id ?? null,
          url: i.url,
          storage_path: i.storage_path,
          alt_text: i.alt_text,
          width: i.width,
          height: i.height,
        })),
      });

      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.message ?? "Product not saved.");
        const fieldTab: Record<string, Tab> = {
          name: "Basic information",
          sku: "Basic information",
          price: "Pricing",
          sale_price: "Pricing",
          meta_title: "SEO",
          meta_description: "SEO",
          canonical_url: "SEO",
        };
        const firstKey = Object.keys(res.fieldErrors ?? {})[0];
        if (firstKey?.startsWith("variants")) setTab("Variants");
        else if (firstKey && fieldTab[firstKey]) setTab(fieldTab[firstKey]);
        return;
      }
      setErrors({});
      if (statusOverride) set("status", statusOverride);
      if (res.message?.startsWith("Saved with warnings")) toast.warning(res.message);
      else toast.success(res.message ?? "Saved");
      if (isNew && res.data) router.replace(`/admin/products/${res.data.id}`);
      else router.refresh();
    });
  }

  const tabBtn = (t: Tab) =>
    cn(
      "shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold",
      tab === t ? "border-signal text-ink" : "border-transparent text-ink-soft hover:text-ink",
    );
  const panel = (t: Tab) => cn("rounded-b-[var(--radius-card)] border border-t-0 border-line bg-surface p-4 sm:p-6", tab !== t && "hidden");
  const autoTitle = productSeoTitle({ name: v.name || "Product name" });
  const autoDescription = productSeoDescription({ name: v.name || "Product name", condition: v.condition });
  const topCategories = categories.filter((c) => !c.parent_id);

  return (
    <div className="pb-24">
      <div role="tablist" aria-label="Product sections" className="no-scrollbar flex overflow-x-auto rounded-t-[var(--radius-card)] border border-line bg-surface px-2">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tabBtn(t)} onClick={() => setTab(t)}>
            {t}
            {t === "Variants" && v.variants.length ? <span className="ml-1 text-ink-mute">({v.variants.length})</span> : null}
            {t === "Images" && v.images.length ? <span className="ml-1 text-ink-mute">({v.images.length})</span> : null}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ Basic information */}
      <section role="tabpanel" aria-label="Basic information" className={panel("Basic information")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Product name" htmlFor="name" error={errors.name} required className="md:col-span-2" hint="e.g. Apple iPhone 15 Pro Max 256GB">
            <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Brand" htmlFor="brand_id">
            <Select id="brand_id" value={v.brand_id} onChange={(e) => set("brand_id", e.target.value)}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category_id">
            <Select id="category_id" value={v.category_id} onChange={(e) => set("category_id", e.target.value)}>
              <option value="">No category</option>
              {topCategories.map((c) => [
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>,
                ...categories
                  .filter((ch) => ch.parent_id === c.id)
                  .map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {"  — "}
                      {ch.name}
                    </option>
                  )),
              ])}
            </Select>
          </Field>
          <Field label="Model" htmlFor="model" hint="Manufacturer model number, e.g. SM-S938B">
            <Input id="model" value={v.model} onChange={(e) => set("model", e.target.value)} />
          </Field>
          <Field label="Condition" htmlFor="condition">
            <Select id="condition" value={v.condition} onChange={(e) => set("condition", e.target.value as ProductCondition)}>
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
            </Select>
          </Field>
          <Field label="SKU" htmlFor="sku" error={errors.sku} hint="Your internal code, unique per product">
            <Input id="sku" value={v.sku} onChange={(e) => set("sku", e.target.value)} />
          </Field>
          <Field label="Barcode (GTIN / EAN / UPC)" htmlFor="barcode" error={errors.barcode} hint="Helps Google Shopping match the product">
            <Input id="barcode" value={v.barcode} inputMode="numeric" onChange={(e) => set("barcode", e.target.value)} />
          </Field>
          <Field label="MPN" htmlFor="mpn" hint="Manufacturer part number (optional)">
            <Input id="mpn" value={v.mpn} onChange={(e) => set("mpn", e.target.value)} />
          </Field>
          <Field label="Warranty" htmlFor="warranty" hint="Shown on the product page, e.g. 1 year brand warranty">
            <Input id="warranty" value={v.warranty} onChange={(e) => set("warranty", e.target.value)} />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" value={v.status} onChange={(e) => set("status", e.target.value as ProductStatus)}>
              <option value="draft">Draft (hidden)</option>
              <option value="active">Active (visible)</option>
              <option value="out_of_stock">Out of stock (visible, can&apos;t be ordered)</option>
              <option value="archived">Archived (hidden)</option>
            </Select>
          </Field>
          <fieldset className="md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Show on the home page</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Checkbox label="Featured" description="Featured phones + price board" checked={v.featured} onChange={(e) => set("featured", e.target.checked)} />
              <Checkbox label="New arrival" checked={v.is_new} onChange={(e) => set("is_new", e.target.checked)} />
              <Checkbox label="Best seller" checked={v.is_best_seller} onChange={(e) => set("is_best_seller", e.target.checked)} />
              <Checkbox label="Special offer" description="Also automatic when a sale price is set" checked={v.is_offer} onChange={(e) => set("is_offer", e.target.checked)} />
            </div>
          </fieldset>
        </div>
      </section>

      {/* ---------------------------------------------------------- Pricing */}
      <section role="tabpanel" aria-label="Pricing" className={panel("Pricing")}>
        {hasVariants ? (
          <p className="mb-4 rounded-lg bg-signal-tint p-3 text-sm text-signal-dark">
            This product has variants. Customers see each variant&rsquo;s own price; the price below is replaced by the cheapest variant when you save.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Regular price (৳)" htmlFor="price" error={errors.price} required={!hasVariants}>
            <Input id="price" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} aria-invalid={Boolean(errors.price)} />
          </Field>
          <Field label="Sale price (৳)" htmlFor="sale_price" error={errors.sale_price} hint="Leave empty if not on sale">
            <Input id="sale_price" inputMode="decimal" value={v.sale_price} onChange={(e) => set("sale_price", e.target.value)} />
          </Field>
          {canSeeCost ? (
            <Field label="Cost price (৳)" htmlFor="cost_price" hint="Private. Never shown to customers.">
              <Input id="cost_price" inputMode="decimal" value={v.cost_price} onChange={(e) => set("cost_price", e.target.value)} />
            </Field>
          ) : null}
        </div>
        {Number(v.price) > 0 ? (
          <p className="mt-4 text-sm text-ink-soft">
            Customers pay <strong className="price text-ink">{formatPrice(v.sale_price ? Number(v.sale_price) : Number(v.price))}</strong>
            {discountPercent(Number(v.price), v.sale_price ? Number(v.sale_price) : null) > 0
              ? ` (${discountPercent(Number(v.price), Number(v.sale_price))}% off)`
              : ""}
            {canSeeCost && Number(v.cost_price) > 0
              ? `, margin ${formatPrice((v.sale_price ? Number(v.sale_price) : Number(v.price)) - Number(v.cost_price))}`
              : ""}
          </p>
        ) : null}
      </section>

      {/* -------------------------------------------------------- Inventory */}
      <section role="tabpanel" aria-label="Inventory" className={panel("Inventory")}>
        <div className="grid gap-4 md:grid-cols-2">
          {hasVariants ? (
            <p className="rounded-lg bg-signal-tint p-3 text-sm text-signal-dark md:col-span-2">
              Stock is managed per variant in the Variants tab. Total in stock:{" "}
              <strong>{v.variants.filter((x) => x.status === "active").reduce((n, x) => n + (Number(x.stock) || 0), 0)}</strong>
            </p>
          ) : (
            <Field label="Stock quantity" htmlFor="stock_quantity" hint="Changes are recorded in inventory history">
              <Input id="stock_quantity" inputMode="numeric" value={v.stock_quantity} onChange={(e) => set("stock_quantity", e.target.value.replace(/\D/g, ""))} />
            </Field>
          )}
          <Field label="Low stock alert at" htmlFor="low_stock_threshold" hint="Shows “Low Stock” at or below this number">
            <Input id="low_stock_threshold" inputMode="numeric" value={v.low_stock_threshold} onChange={(e) => set("low_stock_threshold", e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
      </section>

      {/* ----------------------------------------------------------- Images */}
      <section role="tabpanel" aria-label="Images" className={panel("Images")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-soft">
            Up to 15 images. The first image is the main one. Photos are resized and converted to WebP automatically.
          </p>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={v.images.length >= 15} loading={uploading > 0}>
            <ImagePlus className="h-4 w-4" aria-hidden />
            {uploading > 0 ? `Uploading ${uploading}…` : "Upload images"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="sr-only"
            aria-label="Upload product images"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
        {v.images.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-4 flex h-40 w-full items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong text-sm text-ink-mute hover:border-ink"
          >
            Add the first product photo
          </button>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {v.images.map((img, i) => (
              <li key={img.key} className={cn("rounded-[var(--radius-card)] border bg-surface p-2", i === 0 ? "border-signal ring-1 ring-signal" : "border-line")}>
                <div className="relative aspect-square overflow-hidden rounded-lg bg-paper">
                  <Image src={img.url} alt={img.alt_text || `Image ${i + 1}`} fill sizes="200px" className="object-contain" unoptimized={isSvg(img.url)} />
                  {i === 0 ? <span className="absolute left-1.5 top-1.5 rounded bg-signal px-1.5 text-[11px] font-bold text-white">Main</span> : null}
                </div>
                <label className="sr-only" htmlFor={`alt-${img.key}`}>
                  Alt text for image {i + 1}
                </label>
                <input
                  id={`alt-${img.key}`}
                  value={img.alt_text}
                  placeholder="Alt text (describe the photo)"
                  onChange={(e) => setV((prev) => ({ ...prev, images: prev.images.map((x) => (x.key === img.key ? { ...x, alt_text: e.target.value } : x)) }))}
                  className="mt-2 h-8 w-full rounded-md border border-line px-2 text-xs"
                />
                <div className="mt-1.5 flex justify-between">
                  <div className="flex">
                    <button type="button" className="rounded p-1.5 hover:bg-paper disabled:opacity-30" onClick={() => moveImage(i, -1)} disabled={i === 0} aria-label="Move earlier">
                      <ArrowUp className="h-4 w-4 -rotate-90" />
                    </button>
                    <button type="button" className="rounded p-1.5 hover:bg-paper disabled:opacity-30" onClick={() => moveImage(i, 1)} disabled={i === v.images.length - 1} aria-label="Move later">
                      <ArrowDown className="h-4 w-4 -rotate-90" />
                    </button>
                    {i !== 0 ? (
                      <button type="button" className="rounded p-1.5 hover:bg-paper" onClick={() => makePrimary(i)} aria-label="Make main image">
                        <Star className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="rounded p-1.5 text-deal hover:bg-deal-tint"
                    onClick={() => setV((prev) => ({ ...prev, images: prev.images.filter((x) => x.key !== img.key) }))}
                    aria-label={`Remove image ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------------------- Variants */}
      <section role="tabpanel" aria-label="Variants" className={panel("Variants")}>
        <p className="text-sm text-ink-soft">
          Use variants when the same phone comes in different storage, RAM or colours with their own price and stock. Leave empty for a single-option product.
        </p>
        <div className="mt-4 rounded-[var(--radius-card)] bg-paper p-4">
          <p className="text-sm font-semibold">Quick add combinations</p>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_140px_auto]">
            <Input placeholder="Storage: 256GB, 512GB" value={genStorage} onChange={(e) => setGenStorage(e.target.value)} aria-label="Storage options, comma separated" />
            <Input placeholder="Colours: Black, Blue" value={genColors} onChange={(e) => setGenColors(e.target.value)} aria-label="Colours, comma separated" />
            <Input placeholder="RAM: 8GB" value={genRam} onChange={(e) => setGenRam(e.target.value)} aria-label="RAM for these variants" />
            <Button type="button" variant="secondary" onClick={generateVariants}>
              Add
            </Button>
          </div>
        </div>

        {v.variants.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-soft">
                  <th className="p-2 font-semibold">Storage</th>
                  <th className="p-2 font-semibold">RAM</th>
                  <th className="p-2 font-semibold">Colour</th>
                  <th className="p-2 font-semibold">Hex</th>
                  <th className="p-2 font-semibold">SKU</th>
                  <th className="p-2 font-semibold">Price ৳</th>
                  <th className="p-2 font-semibold">Sale ৳</th>
                  <th className="p-2 font-semibold">Stock</th>
                  <th className="p-2 font-semibold">Image</th>
                  <th className="p-2 font-semibold">Active</th>
                  <th className="p-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {v.variants.map((x, i) => {
                  const cell = "h-9 w-full rounded-md border border-line-strong px-2";
                  return (
                    <tr key={x.key} className={cn("border-t border-line", errors[`variants.${i}`] && "bg-deal-tint")}>
                      <td className="p-1.5"><input className={cell} value={x.storage} onChange={(e) => updateVariant(x.key, { storage: e.target.value })} aria-label={`Variant ${i + 1} storage`} placeholder="256GB" /></td>
                      <td className="p-1.5"><input className={cell} value={x.ram} onChange={(e) => updateVariant(x.key, { ram: e.target.value })} aria-label={`Variant ${i + 1} RAM`} placeholder="8GB" /></td>
                      <td className="p-1.5"><input className={cell} value={x.color} onChange={(e) => updateVariant(x.key, { color: e.target.value })} aria-label={`Variant ${i + 1} colour`} /></td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1">
                          <input type="color" className="h-9 w-9 shrink-0 rounded border border-line-strong" value={x.color_hex || "#000000"} onChange={(e) => updateVariant(x.key, { color_hex: e.target.value })} aria-label={`Variant ${i + 1} colour swatch`} />
                          {x.color_hex ? (
                            <button type="button" className="text-xs text-ink-mute underline" onClick={() => updateVariant(x.key, { color_hex: "" })}>
                              clear
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-1.5"><input className={cell} value={x.sku} onChange={(e) => updateVariant(x.key, { sku: e.target.value })} aria-label={`Variant ${i + 1} SKU`} /></td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" value={x.price} onChange={(e) => updateVariant(x.key, { price: e.target.value })} aria-label={`Variant ${i + 1} price`} /></td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" value={x.sale_price} onChange={(e) => updateVariant(x.key, { sale_price: e.target.value })} aria-label={`Variant ${i + 1} sale price`} /></td>
                      <td className="p-1.5"><input className={cell} inputMode="numeric" value={x.stock} onChange={(e) => updateVariant(x.key, { stock: e.target.value.replace(/\D/g, "") })} aria-label={`Variant ${i + 1} stock`} /></td>
                      <td className="p-1.5">
                        <select className={cell} value={x.image_url} onChange={(e) => updateVariant(x.key, { image_url: e.target.value })} aria-label={`Variant ${i + 1} image`}>
                          <option value="">Main image</option>
                          {v.images.map((img, n) => (
                            <option key={img.key} value={img.url}>
                              Image {n + 1}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1.5 text-center">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--color-signal)]" checked={x.status === "active"} onChange={(e) => updateVariant(x.key, { status: e.target.checked ? "active" : "inactive" })} aria-label={`Variant ${i + 1} active`} />
                      </td>
                      <td className="p-1.5">
                        <button type="button" className="rounded p-2 text-deal hover:bg-deal-tint" onClick={() => setV((prev) => ({ ...prev, variants: prev.variants.filter((y) => y.key !== x.key) }))} aria-label={`Remove variant ${i + 1}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <Button type="button" variant="outline" className="mt-4" onClick={() => addVariant()}>
          <Plus className="h-4 w-4" aria-hidden />
          Add variant
        </Button>
      </section>

      {/* --------------------------------------------------- Specifications */}
      <section role="tabpanel" aria-label="Specifications" className={panel("Specifications")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-soft">Any specification you like. RAM and Storage specs also power the search filters.</p>
          {v.specs.length === 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => set("specs", COMMON_SPECS.map(([group_name, name]) => ({ group_name, name, value: "" })))}>
              Start with common phone specs
            </Button>
          ) : null}
        </div>
        <ul className="mt-4 space-y-2">
          {v.specs.map((s, i) => (
            <li key={i} className="grid gap-2 sm:grid-cols-[160px_200px_1fr_auto]">
              <input className="h-10 rounded-md border border-line-strong px-2.5 text-sm" placeholder="Group (Display)" value={s.group_name} onChange={(e) => set("specs", v.specs.map((x, n) => (n === i ? { ...x, group_name: e.target.value } : x)))} aria-label={`Spec ${i + 1} group`} />
              <input className="h-10 rounded-md border border-line-strong px-2.5 text-sm" placeholder="Name (Size)" value={s.name} onChange={(e) => set("specs", v.specs.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))} aria-label={`Spec ${i + 1} name`} />
              <input className="h-10 rounded-md border border-line-strong px-2.5 text-sm" placeholder="Value (6.7 inch)" value={s.value} onChange={(e) => set("specs", v.specs.map((x, n) => (n === i ? { ...x, value: e.target.value } : x)))} aria-label={`Spec ${i + 1} value`} />
              <div className="flex">
                <button type="button" className="rounded p-2 hover:bg-paper disabled:opacity-30" disabled={i === 0} onClick={() => { const s2 = [...v.specs]; [s2[i - 1], s2[i]] = [s2[i], s2[i - 1]]; set("specs", s2); }} aria-label="Move up">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" className="rounded p-2 text-deal hover:bg-deal-tint" onClick={() => set("specs", v.specs.filter((_, n) => n !== i))} aria-label={`Remove spec ${i + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" className="mt-3" onClick={() => set("specs", [...v.specs, { group_name: v.specs[v.specs.length - 1]?.group_name ?? "General", name: "", value: "" }])}>
          <Plus className="h-4 w-4" aria-hidden />
          Add specification
        </Button>
        <p className="mt-2 text-xs text-ink-mute">Rows with an empty name or value are skipped when saving.</p>

        <h3 className="mt-8 font-semibold">Key features</h3>
        <p className="text-sm text-ink-soft">Short highlights shown with a tick, e.g. “IP68 water resistance”.</p>
        <ul className="mt-3 space-y-2">
          {v.features.map((f, i) => (
            <li key={i} className="flex gap-2">
              <input className="h-10 flex-1 rounded-md border border-line-strong px-2.5 text-sm" value={f} onChange={(e) => set("features", v.features.map((x, n) => (n === i ? e.target.value : x)))} aria-label={`Feature ${i + 1}`} />
              <button type="button" className="rounded p-2 text-deal hover:bg-deal-tint" onClick={() => set("features", v.features.filter((_, n) => n !== i))} aria-label={`Remove feature ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <Button type="button" variant="outline" className="mt-3" onClick={() => set("features", [...v.features, ""])}>
          <Plus className="h-4 w-4" aria-hidden />
          Add feature
        </Button>
      </section>

      {/* ------------------------------------------------------ Description */}
      <section role="tabpanel" aria-label="Description" className={panel("Description")}>
        <Field label="Short description" htmlFor="short_description" hint="One or two lines under the product name (max 500 characters)">
          <Textarea id="short_description" rows={2} maxLength={500} value={v.short_description} onChange={(e) => set("short_description", e.target.value)} />
        </Field>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Full description" htmlFor="description" hint="Formatting: ## Heading, - bullet, **bold**, [link](https://…). Blank line = new paragraph.">
            <Textarea id="description" rows={16} value={v.description} onChange={(e) => set("description", e.target.value)} className="font-mono text-sm" />
          </Field>
          <div>
            <p className="text-sm font-medium">Preview</p>
            <div className="mt-1.5 min-h-40 rounded-[var(--radius-control)] border border-line bg-paper p-4 text-sm">
              {v.description ? <RichText content={v.description} /> : <p className="text-ink-mute">Nothing to preview yet.</p>}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- SEO */}
      <section role="tabpanel" aria-label="SEO" className={panel("SEO")}>
        <p className="text-sm text-ink-soft">
          Leave these empty to generate them automatically from the product name. Only fill them in to override.
        </p>
        <div className="mt-4 grid gap-4">
          <Field
            label="URL slug"
            htmlFor="slug"
            hint={isNew ? `Automatic: /products/${slugify(v.name) || "product-name"}` : "Changing it keeps the old URL working with an automatic redirect."}
          >
            <div className="flex items-center rounded-[var(--radius-control)] border border-line-strong bg-paper">
              <span className="pl-3 text-sm text-ink-mute">/products/</span>
              <input id="slug" className="h-11 flex-1 rounded-r-[var(--radius-control)] bg-surface px-2 text-[15px]" value={v.slug} placeholder={slugify(v.name)} onChange={(e) => set("slug", slugify(e.target.value))} />
            </div>
          </Field>
          <Field label={`Meta title (${(v.meta_title || autoTitle).length}/60 recommended)`} htmlFor="meta_title" error={errors.meta_title}>
            <Input id="meta_title" value={v.meta_title} placeholder={autoTitle} maxLength={120} onChange={(e) => set("meta_title", e.target.value)} />
          </Field>
          <Field label={`Meta description (${(v.meta_description || autoDescription).length}/160 recommended)`} htmlFor="meta_description" error={errors.meta_description}>
            <Textarea id="meta_description" rows={3} value={v.meta_description} placeholder={autoDescription} maxLength={320} onChange={(e) => set("meta_description", e.target.value)} />
          </Field>
          <Field label="Canonical URL (advanced)" htmlFor="canonical_url" error={errors.canonical_url} hint="Only if this page duplicates another URL. Usually leave empty.">
            <Input id="canonical_url" value={v.canonical_url} placeholder="https://…" onChange={(e) => set("canonical_url", e.target.value)} />
          </Field>
        </div>
        <div className="mt-6 rounded-[var(--radius-card)] border border-line p-4">
          <p className="text-xs font-semibold text-ink-mute">Google search preview</p>
          <p className="mt-2 truncate text-sm text-ink-soft">
            {(process.env.NEXT_PUBLIC_SITE_URL || "your-site").replace(/^https?:\/\//, "")} › products › {v.slug || slugify(v.name) || "product"}
          </p>
          <p className="mt-0.5 truncate text-lg text-[#1a0dab]">
            {v.meta_title || autoTitle} | {storeName}
          </p>
          <p className="line-clamp-2 text-sm text-ink-soft">{v.meta_description || autoDescription}</p>
        </div>
      </section>

      {/* ---------------------------------------------------- sticky actions */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
          <div className="flex flex-wrap gap-2">
            {!isNew ? (
              <>
                {initial.status === "active" || initial.status === "out_of_stock" ? (
                  <a href={`/products/${initial.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink-soft hover:bg-paper">
                    <ExternalLink className="h-4 w-4" aria-hidden />
                    View
                  </a>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const res = await duplicateProductAction(initial.id!);
                    if (res.ok && res.data) {
                      toast.success(res.message);
                      router.push(`/admin/products/${res.data.id}`);
                    } else toast.error(res.message);
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden />
                  Duplicate
                </Button>
                <ConfirmButton
                  title="Delete this product?"
                  description="It disappears from the store and its images are removed. Past orders keep their details. This can't be undone — archive it instead if you might sell it again."
                  confirmLabel="Delete product"
                  variant="ghost"
                  onConfirm={async () => {
                    const res = await deleteProductAction(initial.id!);
                    if (res.ok) router.push("/admin/products");
                    return res;
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </ConfirmButton>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            {v.status !== "active" ? (
              <Button type="button" variant="outline" onClick={() => save("active")} loading={saving} disabled={uploading > 0}>
                Save &amp; publish
              </Button>
            ) : null}
            <Button type="button" onClick={() => save()} loading={saving} disabled={uploading > 0}>
              {isNew ? "Create product" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
