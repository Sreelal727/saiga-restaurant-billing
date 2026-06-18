"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import {
  Plus,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Check,
  ImageIcon,
  Upload,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTenant } from "@/components/outlet/outlet-context";

type Variant = { label: string; price: number; unit_factor?: number };

type AdminItem = {
  _id: Id<"menu_items">;
  category_id: Id<"menu_categories">;
  name: string;
  description?: string;
  price: number;
  variants?: Variant[];
  open_price?: boolean;
  is_veg: boolean;
  is_active: boolean;
  has_inventory: boolean;
  image_url: string | null;
  image_storage_id?: Id<"_storage">;
};

// Editable portion row (string-typed for the form inputs)
type PortionRow = { label: string; price: string; unit_factor: string };

const PORTION_SUGGESTIONS = ["Quarter", "Half", "Full"];

function newPortionRow(label = "", price = "", unit_factor = "1"): PortionRow {
  return { label, price, unit_factor };
}

function formatVariantSummary(variants: Variant[]): string {
  return variants
    .map((v) => `${v.label} ${formatCurrency(v.price)}`)
    .join("  ·  ");
}

type AdminCategory = {
  _id: Id<"menu_categories">;
  name: string;
  display_order: number;
  is_active: boolean;
  items: AdminItem[];
};

const EMPTY_ITEM_FORM = {
  category_id: "" as Id<"menu_categories"> | "",
  name: "",
  description: "",
  price: "",
  has_portions: false,
  portions: [] as PortionRow[],
  open_price: false,
  is_veg: true,
  has_inventory: false,
  image_storage_id: undefined as Id<"_storage"> | undefined,
  image_preview_url: null as string | null,
};

export default function MenuPage() {
  const tenant = useTenant();
  const menuData = useQuery(
    api.menu.listAdmin,
    tenant.args ?? "skip"
  ) as AdminCategory[] | undefined;

  const createCategory = useMutation(api.categories.create);
  const updateCategory = useMutation(api.categories.update);
  const reorderCategory = useMutation(api.categories.reorder);
  const removeCategory = useMutation(api.categories.remove);

  const createItem = useMutation(api.menu.create);
  const updateItem = useMutation(api.menu.update);
  const toggleItem = useMutation(api.menu.toggleActive);
  const removeItem = useMutation(api.menu.remove);
  const bulkRemoveItems = useMutation(api.menu.bulkRemove);
  const bulkSetActive = useMutation(api.menu.bulkSetActive);
  const removeItemImage = useMutation(api.menu.removeImage);
  const generateUploadUrl = useMutation(api.menu.generateUploadUrl);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<Id<"menu_items">>>(new Set());

  // Category form: null | new | edit
  const [catForm, setCatForm] = useState<
    | { mode: "new"; name: string }
    | { mode: "edit"; id: Id<"menu_categories">; name: string }
    | null
  >(null);

  // Tile view: which category is opened (null = show category tiles)
  const [selectedCatId, setSelectedCatId] = useState<Id<"menu_categories"> | null>(null);

  // Item form
  const [showItemForm, setShowItemForm] = useState(false);
  const [editItemId, setEditItemId] = useState<Id<"menu_items"> | null>(null);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [uploading, setUploading] = useState(false);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!menuData) return undefined;
    if (term.length === 0) return menuData;
    return menuData
      .map((cat) => {
        const catMatches = cat.name.toLowerCase().includes(term);
        const items = catMatches
          ? cat.items
          : cat.items.filter(
              (i) =>
                i.name.toLowerCase().includes(term) ||
                (i.description?.toLowerCase().includes(term) ?? false)
            );
        return { ...cat, items, _matched: catMatches };
      })
      .filter((cat) => cat._matched || cat.items.length > 0);
  }, [menuData, term]);

  // ─── Selection helpers ────────────────────────────────────────────────────

  function toggleSelect(id: Id<"menu_items">) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectCategory(cat: AdminCategory) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = cat.items.every((i) => next.has(i._id));
      if (allSelected) {
        cat.items.forEach((i) => next.delete(i._id));
      } else {
        cat.items.forEach((i) => next.add(i._id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} item${ids.length === 1 ? "" : "s"}?`)) return;
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      const result = await bulkRemoveItems({ ...tenant.args, ids });
      const parts: string[] = [];
      if (result.deleted) parts.push(`${result.deleted} deleted`);
      if (result.deactivated) {
        parts.push(`${result.deactivated} deactivated (referenced by past orders)`);
      }
      toast.success(parts.join(" · ") || "Done");
      clearSelection();
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function handleBulkSetActive(is_active: boolean) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await bulkSetActive({ ...tenant.args, ids, is_active });
      toast.success(`${ids.length} item${ids.length === 1 ? "" : "s"} ${is_active ? "activated" : "deactivated"}`);
      clearSelection();
    } catch {
      toast.error("Failed to update");
    }
  }

  // ─── Category handlers (unchanged from Track A) ──────────────────────────

  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catForm) return;
    const name = catForm.name.trim();
    if (!name) {
      toast.error("Category name is required");
      return;
    }
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      if (catForm.mode === "new") {
        const order = (menuData?.length ?? 0) + 1;
        await createCategory({ ...tenant.args, name, display_order: order });
        toast.success("Category added");
      } else {
        await updateCategory({ ...tenant.args, id: catForm.id, name });
        toast.success("Category updated");
      }
      setCatForm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function handleToggleCategoryActive(cat: AdminCategory) {
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await updateCategory({ ...tenant.args, id: cat._id, is_active: !cat.is_active });
    } catch {
      toast.error("Failed to update category");
    }
  }

  async function handleReorderCategory(
    id: Id<"menu_categories">,
    direction: "up" | "down"
  ) {
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await reorderCategory({ ...tenant.args, id, direction });
    } catch {
      toast.error("Failed to reorder");
    }
  }

  async function handleDeleteCategory(cat: AdminCategory) {
    if (cat.items.length > 0) {
      toast.error(
        `${cat.name} has ${cat.items.length} item${cat.items.length === 1 ? "" : "s"}. Move or delete them first.`
      );
      return;
    }
    if (!confirm(`Delete category "${cat.name}"?`)) return;
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    try {
      await removeCategory({ ...tenant.args, id: cat._id });
      toast.success("Category removed");
      if (selectedCatId === cat._id) setSelectedCatId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  // ─── Item handlers ────────────────────────────────────────────────────────

  function openNewItem(categoryId: Id<"menu_categories">) {
    setEditItemId(null);
    setItemForm({ ...EMPTY_ITEM_FORM, category_id: categoryId });
    setShowItemForm(true);
  }

  function openEditItem(item: AdminItem) {
    setEditItemId(item._id);
    const hasPortions = !!item.variants && item.variants.length > 0;
    setItemForm({
      category_id: item.category_id,
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      has_portions: hasPortions,
      portions: hasPortions
        ? item.variants!.map((vr) =>
            newPortionRow(vr.label, String(vr.price), String(vr.unit_factor ?? 1))
          )
        : [],
      open_price: !!item.open_price,
      is_veg: item.is_veg,
      has_inventory: item.has_inventory,
      image_storage_id: item.image_storage_id,
      image_preview_url: item.image_url,
    });
    setShowItemForm(true);
  }

  // ─── Portion row helpers ──────────────────────────────────────────────────

  function toggleHasPortions(on: boolean) {
    setItemForm((f) => ({
      ...f,
      has_portions: on,
      // Portions and "as per size" are mutually exclusive.
      open_price: on ? false : f.open_price,
      // Seed three common sizes the first time portions are enabled.
      portions:
        on && f.portions.length === 0
          ? PORTION_SUGGESTIONS.map((label, i) =>
              newPortionRow(label, "", String([0.25, 0.5, 1][i] ?? 1))
            )
          : f.portions,
    }));
  }

  function toggleOpenPrice(on: boolean) {
    setItemForm((f) => ({
      ...f,
      open_price: on,
      // "As per size" has no fixed price and no portions.
      has_portions: on ? false : f.has_portions,
    }));
  }

  function addPortion() {
    setItemForm((f) => ({ ...f, portions: [...f.portions, newPortionRow()] }));
  }

  function updatePortion(index: number, field: keyof PortionRow, value: string) {
    setItemForm((f) => ({
      ...f,
      portions: f.portions.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    }));
  }

  function removePortion(index: number) {
    setItemForm((f) => ({
      ...f,
      portions: f.portions.filter((_, i) => i !== index),
    }));
  }

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }
    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({ ...tenant.args });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setItemForm((f) => ({
        ...f,
        image_storage_id: storageId,
        image_preview_url: URL.createObjectURL(file),
      }));
    } catch {
      toast.error("Image upload failed");
    } finally {
      setUploading(false);
      // Reset the input so picking the same file twice still fires onChange
      e.target.value = "";
    }
  }

  async function handleRemoveImageInForm() {
    // If we're editing an existing item with a server-stored image, hit the
    // backend to actually delete the file; otherwise just clear local state.
    if (editItemId && itemForm.image_storage_id) {
      if (!tenant.args) {
        toast.error("No active outlet");
        return;
      }
      try {
        await removeItemImage({ ...tenant.args, id: editItemId });
      } catch {
        toast.error("Failed to remove image");
        return;
      }
    }
    setItemForm((f) => ({ ...f, image_storage_id: undefined, image_preview_url: null }));
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!itemForm.name.trim() || !itemForm.category_id) {
      toast.error("Fill in all required fields");
      return;
    }
    if (!tenant.args) {
      toast.error("No active outlet");
      return;
    }

    // Resolve pricing — "as per size", portions, or a single price.
    let variantsPayload: Variant[] | undefined;
    let basePrice: number;

    if (itemForm.open_price) {
      // No price required — entered at billing time.
      variantsPayload = undefined;
      basePrice = 0;
    } else if (itemForm.has_portions) {
      const rows = itemForm.portions
        .map((p) => ({
          label: p.label.trim(),
          price: Number(p.price),
          unit_factor: itemForm.has_inventory ? Number(p.unit_factor) : undefined,
        }))
        .filter((p) => p.label || p.price);

      if (rows.length === 0) {
        toast.error("Add at least one portion size");
        return;
      }
      if (rows.some((r) => !r.label)) {
        toast.error("Every portion needs a label");
        return;
      }
      if (rows.some((r) => !Number.isFinite(r.price) || r.price < 0)) {
        toast.error("Every portion needs a valid price");
        return;
      }
      if (
        itemForm.has_inventory &&
        rows.some((r) => !Number.isFinite(r.unit_factor!) || r.unit_factor! <= 0)
      ) {
        toast.error("Stock factor must be greater than 0 for every portion");
        return;
      }
      variantsPayload = rows;
      basePrice = Math.min(...rows.map((r) => r.price));
    } else {
      if (!itemForm.price) {
        toast.error("Price is required");
        return;
      }
      basePrice = Number(itemForm.price);
      variantsPayload = undefined;
    }

    try {
      if (editItemId) {
        await updateItem({
          ...tenant.args,
          id: editItemId,
          name: itemForm.name.trim(),
          description: itemForm.description || undefined,
          price: basePrice,
          // [] tells the backend to clear portions (revert to single price).
          variants: variantsPayload ?? [],
          open_price: itemForm.open_price,
          is_veg: itemForm.is_veg,
          has_inventory: itemForm.has_inventory,
          category_id: itemForm.category_id as Id<"menu_categories">,
          image_storage_id: itemForm.image_storage_id,
        });
        toast.success("Item updated");
      } else {
        await createItem({
          ...tenant.args,
          category_id: itemForm.category_id as Id<"menu_categories">,
          name: itemForm.name.trim(),
          description: itemForm.description || undefined,
          price: basePrice,
          variants: variantsPayload,
          open_price: itemForm.open_price,
          is_veg: itemForm.is_veg,
          has_inventory: itemForm.has_inventory,
          image_storage_id: itemForm.image_storage_id,
        });
        toast.success("Item added");
      }
      setShowItemForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save item");
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // The opened category (tile view drill-in), if any.
  const selectedCat =
    selectedCatId && menuData
      ? menuData.find((c) => c._id === selectedCatId) ?? null
      : null;

  const addCategoryBtn = (
    <button
      onClick={() => setCatForm({ mode: "new", name: "" })}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Category
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Menu" action={addCategoryBtn} />
      <div className="flex-1 p-6 pb-24 space-y-5">

        {/* Search bar */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search categories or items…"
            className="w-full pl-9 pr-9 py-2 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* New category form */}
        {catForm?.mode === "new" && (
          <form
            onSubmit={handleSaveCategory}
            className="bg-card border border-border rounded-lg p-4 max-w-sm flex gap-2"
          >
            <input
              autoFocus
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              placeholder="Category name"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setCatForm(null)}
              className="px-3 py-2 bg-secondary rounded-md text-sm"
            >
              Cancel
            </button>
          </form>
        )}

        {/* Item form */}
        {showItemForm && (
          <form
            onSubmit={handleSaveItem}
            className="bg-card border border-border rounded-lg p-4 max-w-md space-y-3"
          >
            <h3 className="font-medium text-sm">
              {editItemId ? "Edit Item" : "New Item"}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <select
                value={itemForm.category_id}
                onChange={(e) =>
                  setItemForm((f) => ({
                    ...f,
                    category_id: e.target.value as Id<"menu_categories">,
                  }))
                }
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Select —</option>
                {menuData?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                    {!c.is_active ? " (inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name *</label>
              <input
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input
                value={itemForm.description}
                onChange={(e) =>
                  setItemForm((f) => ({ ...f, description: e.target.value }))
                }
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {/* As per size (open price) toggle */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={itemForm.open_price}
                onChange={(e) => toggleOpenPrice(e.target.checked)}
                className="accent-primary"
              />
              As per size — enter price at billing
            </label>

            {itemForm.open_price ? (
              <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border p-3">
                No fixed price. Staff enter the price for this item while billing
                each order.
              </p>
            ) : (
              <>
            {/* Portion toggle */}
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={itemForm.has_portions}
                onChange={(e) => toggleHasPortions(e.target.checked)}
                className="accent-primary"
              />
              Sell in multiple sizes / portions
            </label>

            {!itemForm.has_portions ? (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Price (₹) *</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={itemForm.price}
                  onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-secondary/30 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">
                    Portions &amp; prices
                  </label>
                  {itemForm.has_inventory && (
                    <span className="text-[10px] text-muted-foreground">
                      Stock units: Quarter 0.25 · Half 0.5 · Full 1
                    </span>
                  )}
                </div>

                {/* Column headers */}
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wide px-0.5">
                  <span className="flex-1">Label</span>
                  <span className="w-20 text-right">Price ₹</span>
                  {itemForm.has_inventory && <span className="w-16 text-right">Stock</span>}
                  <span className="w-6" />
                </div>

                {itemForm.portions.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      value={row.label}
                      onChange={(e) => updatePortion(i, "label", e.target.value)}
                      list="portion-labels"
                      placeholder="e.g. Half"
                      className="flex-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={row.price}
                      onChange={(e) => updatePortion(i, "price", e.target.value)}
                      placeholder="0"
                      className="w-20 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right"
                    />
                    {itemForm.has_inventory && (
                      <input
                        type="number"
                        min={0}
                        step={0.25}
                        value={row.unit_factor}
                        onChange={(e) => updatePortion(i, "unit_factor", e.target.value)}
                        placeholder="1"
                        className="w-16 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removePortion(i)}
                      className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove portion"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <datalist id="portion-labels">
                  {PORTION_SUGGESTIONS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>

                <button
                  type="button"
                  onClick={addPortion}
                  className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <Plus className="h-3 w-3" /> Add size
                </button>
              </div>
            )}
              </>
            )}

            {/* Image upload */}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Image</label>
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 rounded-md border border-border bg-secondary/40 overflow-hidden flex items-center justify-center shrink-0">
                  {itemForm.image_preview_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={itemForm.image_preview_url}
                      alt="Preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md cursor-pointer transition-colors",
                      uploading
                        ? "bg-secondary text-muted-foreground"
                        : "bg-secondary hover:bg-secondary/70"
                    )}
                  >
                    {uploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {uploading ? "Uploading…" : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFilePick}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                  {itemForm.image_preview_url && !uploading && (
                    <button
                      type="button"
                      onClick={handleRemoveImageInForm}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                PNG, JPG, or WebP up to 5 MB
              </p>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemForm.is_veg}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, is_veg: e.target.checked }))
                  }
                  className="accent-green-500"
                />
                Vegetarian
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={itemForm.has_inventory}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, has_inventory: e.target.checked }))
                  }
                  className="accent-primary"
                />
                Track Inventory
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={uploading}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
              >
                {editItemId ? "Update" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => setShowItemForm(false)}
                className="px-4 py-2 bg-secondary rounded-md text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Categories — tile grid, drill into one category's items */}
        {menuData === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : menuData.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            No categories yet — click Add Category to start.
          </div>
        ) : !term && !selectedCatId ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {menuData.map((cat) => (
              <button
                key={cat._id}
                onClick={() => setSelectedCatId(cat._id)}
                className={cn(
                  "text-left bg-card border border-border rounded-xl p-4 hover:border-primary/50 hover:shadow-md transition-all",
                  !cat.is_active && "opacity-60"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-sm">{cat.name}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {cat.items.length} item{cat.items.length === 1 ? "" : "s"}
                  {!cat.is_active ? " · inactive" : ""}
                </p>
              </button>
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-20">
            {`No categories or items matching "${search}"`}
          </div>
        ) : (
          <>
            {selectedCatId && !term && (
              <button
                onClick={() => setSelectedCatId(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-1"
              >
                <ArrowLeft className="h-4 w-4" /> Back to all categories
              </button>
            )}
            {(term ? filtered ?? [] : selectedCat ? [selectedCat] : []).map((cat) => {
              const idx = menuData.findIndex((c) => c._id === cat._id);
              const arr = menuData;
              const isEditingThis =
                catForm?.mode === "edit" && catForm.id === cat._id;
            const allItemsSelected =
              cat.items.length > 0 && cat.items.every((i) => selected.has(i._id));
            const someItemsSelected = cat.items.some((i) => selected.has(i._id));
            return (
              <div
                key={cat._id}
                className={cn(
                  "bg-card border border-border rounded-lg",
                  !cat.is_active && "opacity-60"
                )}
              >
                {/* Category header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  {cat.items.length > 0 && !isEditingThis && (
                    <input
                      type="checkbox"
                      checked={allItemsSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someItemsSelected && !allItemsSelected;
                      }}
                      onChange={() => toggleSelectCategory(cat)}
                      className="accent-primary"
                      aria-label={`Select all items in ${cat.name}`}
                    />
                  )}
                  {isEditingThis ? (
                    <form
                      onSubmit={handleSaveCategory}
                      className="flex-1 flex gap-2"
                    >
                      <input
                        autoFocus
                        value={catForm.name}
                        onChange={(e) =>
                          setCatForm({ ...catForm, name: e.target.value })
                        }
                        className="flex-1 px-3 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <button
                        type="submit"
                        className="p-1.5 text-primary hover:bg-secondary rounded"
                        title="Save"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCatForm(null)}
                        className="p-1.5 text-muted-foreground hover:bg-secondary rounded"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <h3 className="font-semibold text-sm">{cat.name}</h3>
                      <span className="text-xs text-muted-foreground">
                        {cat.items.length} item{cat.items.length === 1 ? "" : "s"}
                      </span>
                      {!cat.is_active && (
                        <span className="text-xs text-muted-foreground">
                          (inactive)
                        </span>
                      )}

                      <div className="ml-auto flex items-center gap-1">
                        {term.length === 0 && (
                          <>
                            <button
                              onClick={() => handleReorderCategory(cat._id, "up")}
                              disabled={idx === 0}
                              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move up"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleReorderCategory(cat._id, "down")}
                              disabled={idx === arr.length - 1}
                              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                              title="Move down"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() =>
                            setCatForm({
                              mode: "edit",
                              id: cat._id,
                              name: cat.name,
                            })
                          }
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title="Rename"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleCategoryActive(cat)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={cat.is_active ? "Deactivate" : "Activate"}
                        >
                          {cat.is_active ? (
                            <ToggleRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteCategory(cat)}
                          disabled={cat.items.length > 0}
                          className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed"
                          title={
                            cat.items.length > 0
                              ? "Cannot delete: category has items"
                              : "Delete category"
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => openNewItem(cat._id)}
                          className="flex items-center gap-1 ml-2 px-2 py-1 text-xs text-primary hover:bg-secondary rounded"
                        >
                          <Plus className="h-3 w-3" /> Item
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Items */}
                {cat.items.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No items yet</p>
                ) : (
                  <div className="divide-y divide-border">
                    {cat.items.map((item) => (
                      <div
                        key={item._id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5",
                          !item.is_active && "opacity-50",
                          selected.has(item._id) && "bg-primary/5"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(item._id)}
                          onChange={() => toggleSelect(item._id)}
                          className="accent-primary"
                          aria-label={`Select ${item.name}`}
                        />

                        {/* Thumbnail */}
                        <div className="h-10 w-10 rounded-md border border-border bg-secondary/40 overflow-hidden flex items-center justify-center shrink-0">
                          {item.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image_url}
                              alt={item.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>

                        <span
                          className={cn(
                            "h-2 w-2 rounded-full shrink-0",
                            item.is_veg ? "bg-green-500" : "bg-red-500"
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground">
                              {item.description}
                            </p>
                          )}
                          {item.variants && item.variants.length > 0 && (
                            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                              {formatVariantSummary(item.variants)}
                            </p>
                          )}
                        </div>
                        <span className="text-sm tabular-nums shrink-0">
                          {item.open_price
                            ? "As per size"
                            : item.variants && item.variants.length > 0
                              ? `from ${formatCurrency(item.price)}`
                              : formatCurrency(item.price)}
                        </span>
                        <button
                          onClick={() => openEditItem(item)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title="Edit item"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={async () => {
                            if (!tenant.args) {
                              toast.error("No active outlet");
                              return;
                            }
                            await toggleItem({ ...tenant.args, id: item._id });
                          }}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          title={item.is_active ? "Deactivate" : "Activate"}
                        >
                          {item.is_active ? (
                            <ToggleRight className="h-4 w-4 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete "${item.name}"?`)) return;
                            if (!tenant.args) {
                              toast.error("No active outlet");
                              return;
                            }
                            await removeItem({ ...tenant.args, id: item._id });
                            toast.success("Item removed");
                          }}
                          className="p-1 text-muted-foreground hover:text-destructive"
                          title="Delete item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
            })}
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 bg-card border border-border rounded-full shadow-lg px-4 py-2 flex items-center gap-2">
          <span className="text-sm font-medium px-2">
            {selected.size} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={() => handleBulkSetActive(true)}
            className="px-3 py-1.5 text-xs rounded-full hover:bg-secondary text-foreground"
          >
            Activate
          </button>
          <button
            onClick={() => handleBulkSetActive(false)}
            className="px-3 py-1.5 text-xs rounded-full hover:bg-secondary text-foreground"
          >
            Deactivate
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 text-xs rounded-full text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
          <div className="h-4 w-px bg-border" />
          <button
            onClick={clearSelection}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-full"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
