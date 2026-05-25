"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function MenuPage() {
  const menuData = useQuery(api.menu.listWithCategories);
  const categories = useQuery(api.categories.list);
  const createCategory = useMutation(api.categories.create);
  const createItem = useMutation(api.menu.create);
  const updateItem = useMutation(api.menu.update);
  const toggleItem = useMutation(api.menu.toggleActive);
  const removeItem = useMutation(api.menu.remove);

  const [showCatForm, setShowCatForm] = useState(false);
  const [catName, setCatName] = useState("");
  const [showItemForm, setShowItemForm] = useState(false);
  const [editItem, setEditItem] = useState<null | {
    _id: Id<"menu_items">;
    category_id: Id<"menu_categories">;
    name: string;
    description?: string;
    price: number;
    is_veg: boolean;
    has_inventory: boolean;
  }>(null);
  const [form, setForm] = useState({
    category_id: "" as Id<"menu_categories"> | "",
    name: "",
    description: "",
    price: "",
    is_veg: true,
    has_inventory: false,
  });

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      const order = (categories?.length ?? 0) + 1;
      await createCategory({ name: catName.trim(), display_order: order });
      toast.success("Category added");
      setCatName("");
      setShowCatForm(false);
    } catch {
      toast.error("Failed to add category");
    }
  }

  function openNewItem(categoryId: Id<"menu_categories">) {
    setEditItem(null);
    setForm({ category_id: categoryId, name: "", description: "", price: "", is_veg: true, has_inventory: false });
    setShowItemForm(true);
  }

  function openEditItem(item: NonNullable<typeof editItem>) {
    setEditItem(item);
    setForm({
      category_id: item.category_id,
      name: item.name,
      description: item.description ?? "",
      price: String(item.price),
      is_veg: item.is_veg,
      has_inventory: item.has_inventory,
    });
    setShowItemForm(true);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.price || !form.category_id) {
      toast.error("Fill in all required fields");
      return;
    }
    try {
      if (editItem) {
        await updateItem({
          id: editItem._id,
          name: form.name.trim(),
          description: form.description || undefined,
          price: Number(form.price),
          is_veg: form.is_veg,
          has_inventory: form.has_inventory,
          category_id: form.category_id as Id<"menu_categories">,
        });
        toast.success("Item updated");
      } else {
        await createItem({
          category_id: form.category_id as Id<"menu_categories">,
          name: form.name.trim(),
          description: form.description || undefined,
          price: Number(form.price),
          is_veg: form.is_veg,
          has_inventory: form.has_inventory,
        });
        toast.success("Item added");
      }
      setShowItemForm(false);
    } catch {
      toast.error("Failed to save item");
    }
  }

  const addBtn = (
    <button
      onClick={() => setShowCatForm(true)}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
    >
      <Plus className="h-4 w-4" /> Add Category
    </button>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Menu" action={addBtn} />
      <div className="flex-1 p-6 space-y-5">

        {showCatForm && (
          <form onSubmit={handleAddCategory} className="bg-card border border-border rounded-lg p-4 max-w-sm flex gap-2">
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="Category name"
              className="flex-1 px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm">
              Save
            </button>
            <button type="button" onClick={() => setShowCatForm(false)} className="px-3 py-2 bg-secondary rounded-md text-sm">
              Cancel
            </button>
          </form>
        )}

        {showItemForm && (
          <form onSubmit={handleSaveItem} className="bg-card border border-border rounded-lg p-4 max-w-md space-y-3">
            <h3 className="font-medium text-sm">{editItem ? "Edit Item" : "New Item"}</h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <select
                value={form.category_id}
                onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value as Id<"menu_categories"> }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">— Select —</option>
                {categories?.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Price (₹) *</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_veg}
                  onChange={(e) => setForm((f) => ({ ...f, is_veg: e.target.checked }))}
                  className="accent-green-500"
                />
                Vegetarian
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.has_inventory}
                  onChange={(e) => setForm((f) => ({ ...f, has_inventory: e.target.checked }))}
                  className="accent-primary"
                />
                Track Inventory
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">
                {editItem ? "Update" : "Add"}
              </button>
              <button type="button" onClick={() => setShowItemForm(false)} className="px-4 py-2 bg-secondary rounded-md text-sm">
                Cancel
              </button>
            </div>
          </form>
        )}

        {menuData === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-20">Loading…</div>
        ) : (
          menuData.map((cat) => (
            <div key={cat._id} className="bg-card border border-border rounded-lg">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="font-semibold text-sm">{cat.name}</h3>
                <button
                  onClick={() => openNewItem(cat._id)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Add Item
                </button>
              </div>
              {cat.items.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">No items yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {cat.items.map((item) => (
                    <div
                      key={item._id}
                      className={cn("flex items-center gap-3 px-4 py-2.5", !item.is_active && "opacity-50")}
                    >
                      <span className={cn("h-2 w-2 rounded-full shrink-0", item.is_veg ? "bg-green-500" : "bg-red-500")} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{item.name}</p>
                        {item.description && (
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        )}
                      </div>
                      <span className="text-sm tabular-nums">{formatCurrency(item.price)}</span>
                      <button
                        onClick={() => openEditItem({
                          _id: item._id,
                          category_id: item.category_id,
                          name: item.name,
                          description: item.description,
                          price: item.price,
                          is_veg: item.is_veg,
                          has_inventory: item.has_inventory,
                        })}
                        className="p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          await toggleItem({ id: item._id });
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground"
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
                          await removeItem({ id: item._id });
                          toast.success("Item removed");
                        }}
                        className="p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
