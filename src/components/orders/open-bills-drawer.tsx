"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";
import {
  X,
  ArrowLeft,
  Plus,
  Minus,
  Printer,
  ChefHat,
  UtensilsCrossed,
  Trash2,
  Search,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { playSettled } from "@/lib/sounds";
import { useTenant } from "@/components/outlet/outlet-context";
import { PrintArea, type KotPayload } from "@/components/orders/print-area";
import { CancelBillDialog } from "@/components/orders/cancel-bill-dialog";

// ─── Types ──────────────────────────────────────────────────────────────────

interface BillItem {
  _id: Id<"order_items">;
  menu_item_id?: Id<"menu_items">;
  name: string;
  variant_label?: string;
  price: number;
  quantity: number;
  notes?: string;
  kot_batch?: number;
}

export interface OpenBill {
  _id: Id<"restaurant_orders">;
  order_number: string;
  order_type: string;
  status: string;
  table?: { table_number: string } | null;
  waiter?: { name: string } | null;
  customer_name?: string;
  items: BillItem[];
  subtotal: number;
  discount_amount: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  tips: number;
  packing_charge: number;
  delivery_charge: number;
  total: number;
  total_paid: number;
  balance_due: number;
  paid_at?: number;
  payment_method?: string | null;
  notes?: string;
  kot_count?: number;
  _creationTime: number;
}

type Method = "cash" | "card" | "upi";

interface AddLine {
  menu_item_id: Id<"menu_items">;
  name: string;
  variant_label?: string;
  price: number;
  quantity: number;
  open_price?: boolean;
}

interface DrawerSettings {
  restaurant_name?: string;
  address?: string;
  phone?: string;
  bill_paper_width?: number;
}

function sameAddLine(c: AddLine, id: Id<"menu_items">, label?: string): boolean {
  return c.menu_item_id === id && c.variant_label === label;
}

function lineName(name: string, label?: string): string {
  return label ? `${name} (${label})` : name;
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

export function OpenBillsDrawer({
  open,
  onClose,
  bills,
  settings,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  bills: OpenBill[];
  settings: DrawerSettings | null | undefined;
  selectedId: Id<"restaurant_orders"> | null;
  onSelect: (id: Id<"restaurant_orders"> | null) => void;
}) {
  const tenant = useTenant();
  const menuData = useQuery(api.menu.listWithCategories, tenant.args ?? "skip");
  const addItemsMut = useMutation(api.orders.addItems);
  const addPayment = useMutation(api.orders.addPayment);
  const settleFull = useMutation(api.orders.recordPayment);
  const markKotPrinted = useMutation(api.orders.markKotPrinted);

  const selected = selectedId ? bills.find((b) => b._id === selectedId) ?? null : null;

  // Add-items state
  const [addOpen, setAddOpen] = useState(false);
  const [addCart, setAddCart] = useState<AddLine[]>([]);
  const [addCatId, setAddCatId] = useState<Id<"menu_categories"> | null>(null);
  const [addSearch, setAddSearch] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // Settle state
  const [payMethod, setPayMethod] = useState<Method>("cash");
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<{ amount: string; method: Method }[]>([]);
  const [settling, setSettling] = useState(false);

  // Print state
  const [printMode, setPrintMode] = useState<"bill" | "kot">("bill");
  const [printWidth, setPrintWidth] = useState(58);
  const [printNonce, setPrintNonce] = useState(0);
  const [kotPayload, setKotPayload] = useState<KotPayload | null>(null);

  // Cancel (void) state
  const [cancelOpen, setCancelOpen] = useState(false);

  // Reset per-bill UI whenever the selected bill changes / drawer closes.
  useEffect(() => {
    setAddOpen(false);
    setAddCart([]);
    setAddSearch("");
    setSplitMode(false);
    setSplits([]);
    setPayMethod("cash");
  }, [selectedId, open]);

  // Auto-select first category when the add-items menu opens.
  useEffect(() => {
    if (addOpen && menuData && menuData.length > 0 && !addCatId) {
      setAddCatId(menuData[0]._id);
    }
  }, [addOpen, menuData, addCatId]);

  if (!open) return null;

  // ── Add items helpers ──
  function addToCart(
    item: { _id: Id<"menu_items">; name: string; price: number; open_price?: boolean },
    variant?: { label: string; price: number }
  ) {
    const label = variant?.label;
    setAddCart((prev) => {
      const ex = prev.find((c) => sameAddLine(c, item._id, label));
      if (ex)
        return prev.map((c) =>
          sameAddLine(c, item._id, label) ? { ...c, quantity: c.quantity + 1 } : c
        );
      return [
        ...prev,
        {
          menu_item_id: item._id,
          name: item.name,
          variant_label: label,
          price: variant ? variant.price : item.price,
          quantity: 1,
          open_price: !!item.open_price,
        },
      ];
    });
  }
  function changeAddQty(id: Id<"menu_items">, label: string | undefined, d: number) {
    setAddCart((prev) =>
      prev
        .map((c) => (sameAddLine(c, id, label) ? { ...c, quantity: c.quantity + d } : c))
        .filter((c) => c.quantity > 0)
    );
  }
  function setAddPrice(id: Id<"menu_items">, label: string | undefined, v: string) {
    const price = v === "" ? 0 : Number(v);
    if (!Number.isFinite(price) || price < 0) return;
    setAddCart((prev) => prev.map((c) => (sameAddLine(c, id, label) ? { ...c, price } : c)));
  }

  async function submitAddItems() {
    if (!selected || addCart.length === 0 || !tenant.args) return;
    const missing = addCart.find((c) => c.open_price && c.price <= 0);
    if (missing) {
      toast.error(`Enter a price for "${missing.name}"`);
      return;
    }
    setAddBusy(true);
    try {
      await addItemsMut({
        ...tenant.args,
        id: selected._id,
        items: addCart.map(({ menu_item_id, quantity, variant_label, price, open_price }) => ({
          menu_item_id,
          quantity,
          variant_label,
          price: open_price ? price : undefined,
        })),
      });
      toast.success("Items added to bill");
      setAddCart([]);
      setAddOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add items");
    } finally {
      setAddBusy(false);
    }
  }

  // ── Settle helpers ──
  function enableSplit() {
    setSplitMode(true);
    setSplits((prev) =>
      prev.length > 0
        ? prev
        : [{ amount: (selected?.balance_due ?? 0).toFixed(2), method: "cash" }]
    );
  }
  function addSplitRow() {
    const allocated = splits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const remaining = Math.max(0, (selected?.balance_due ?? 0) - allocated);
    setSplits((prev) => [
      ...prev,
      { amount: remaining > 0 ? remaining.toFixed(2) : "", method: "cash" },
    ]);
  }
  function updateSplit(i: number, field: "amount" | "method", value: string) {
    setSplits((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function removeSplit(i: number) {
    setSplits((prev) => prev.filter((_, idx) => idx !== i));
  }

  const splitAllocated = splits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const splitRemaining = selected
    ? Math.round((selected.balance_due - splitAllocated) * 100) / 100
    : 0;

  async function handleSettle() {
    if (!selected || !tenant.args) return;
    setSettling(true);
    try {
      if (splitMode) {
        const lines = splits
          .map((s) => ({ amount: Number(s.amount), method: s.method }))
          .filter((s) => Number.isFinite(s.amount) && s.amount > 0);
        if (lines.length === 0) {
          toast.error("Add at least one split payment");
          setSettling(false);
          return;
        }
        if (Math.abs(splitRemaining) > 0.01) {
          toast.error(`Splits must total ${formatCurrency(selected.balance_due)}`);
          setSettling(false);
          return;
        }
        for (const line of lines) {
          await addPayment({
            ...tenant.args,
            id: selected._id,
            amount: line.amount,
            method: line.method,
          });
        }
      } else {
        await settleFull({ ...tenant.args, id: selected._id, payment_method: payMethod });
      }
      playSettled();
      toast.success("Bill settled");
      onSelect(null); // it leaves the open list; go back to the list view
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to settle");
    } finally {
      setSettling(false);
    }
  }

  // ── Print helpers ──
  function printBill(width: number) {
    setPrintWidth(width);
    setPrintMode("bill");
    setPrintNonce((n) => n + 1);
  }
  async function printKot() {
    if (!selected || !tenant.args) return;
    try {
      const result = await markKotPrinted({ ...tenant.args, id: selected._id });
      const width = settings?.bill_paper_width ?? 80;
      if (result.batch_number === null) {
        const last = selected.kot_count ?? 0;
        if (last === 0) {
          toast.info("No items to send to kitchen yet");
          return;
        }
        const reprint = selected.items.filter((i) => i.kot_batch === last);
        setKotPayload({
          batch_number: last,
          items: reprint.map((i) => ({
            _id: i._id,
            name: i.name,
            variant_label: i.variant_label,
            quantity: i.quantity,
            notes: i.notes,
          })),
        });
        toast.info(`Reprinting KOT #${last}`);
      } else {
        setKotPayload({
          batch_number: result.batch_number,
          items: result.items.map((i) => ({
            _id: i._id,
            name: i.name,
            variant_label: i.variant_label,
            quantity: i.quantity,
            notes: i.notes,
          })),
        });
        toast.success(`KOT #${result.batch_number} sent to kitchen`);
      }
      setPrintWidth(width);
      setPrintMode("kot");
      setPrintNonce((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to print KOT");
    }
  }

  const addCat =
    addCatId && menuData ? menuData.find((c) => c._id === addCatId) ?? null : null;

  // Search-first item list: when there's a search term, match across ALL items;
  // otherwise show the chosen category. Single column keeps the narrow drawer readable.
  const addTerm = addSearch.trim().toLowerCase();
  const addItemsToShow =
    addTerm.length > 0
      ? (menuData ?? [])
          .flatMap((c) => c.items)
          .filter(
            (i) =>
              i.name.toLowerCase().includes(addTerm) ||
              (i.description?.toLowerCase().includes(addTerm) ?? false)
          )
          .slice(0, 50)
      : addCat?.items ?? [];

  const qtyOf = (id: Id<"menu_items">, label?: string) =>
    addCart.find((c) => sameAddLine(c, id, label))?.quantity ?? 0;

  const pendingKot = selected
    ? selected.items.filter((i) => i.kot_batch === undefined).length
    : 0;

  return (
    <>
      {/* Print surface (isolated by global .print-area CSS) */}
      <PrintArea
        order={selected}
        settings={settings}
        mode={printMode}
        width={printWidth}
        kot={kotPayload}
        nonce={printNonce}
        onAfterPrint={() => setPrintNonce(0)}
      />

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 print:hidden"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col print:hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          {selected ? (
            <button
              onClick={() => onSelect(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> All bills
            </button>
          ) : (
            <p className="text-sm font-semibold">Open Bills ({bills.length})</p>
          )}
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <BillList bills={bills} onSelect={onSelect} />
          ) : (
            <div className="p-4 space-y-4">
              {/* Title */}
              <div>
                <p className="text-base font-semibold">{selected.order_number}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {selected.order_type.replace("_", " ")}
                  {selected.table ? ` · Table ${selected.table.table_number}` : ""}
                  {` · ${formatDateTime(selected._creationTime)}`}
                </p>
              </div>

              {/* Items */}
              <div className="border border-border rounded-lg divide-y divide-border">
                {selected.items.map((i) => (
                  <div
                    key={i._id}
                    className="flex items-center gap-2 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 min-w-0 truncate">
                      {lineName(i.name, i.variant_label)}
                    </span>
                    <span className="text-muted-foreground text-xs">×{i.quantity}</span>
                    <span className="tabular-nums">{formatCurrency(i.price * i.quantity)}</span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="bg-card border border-border rounded-lg p-3 text-sm space-y-1">
                <Row label="Subtotal" value={formatCurrency(selected.subtotal)} muted />
                {selected.discount_amount > 0 && (
                  <Row
                    label="Discount"
                    value={`−${formatCurrency(selected.discount_amount)}`}
                    muted
                  />
                )}
                {selected.tips > 0 && (
                  <Row label="Tips" value={formatCurrency(selected.tips)} muted />
                )}
                {selected.packing_charge > 0 && (
                  <Row label="Packing" value={formatCurrency(selected.packing_charge)} muted />
                )}
                {selected.delivery_charge > 0 && (
                  <Row label="Delivery" value={formatCurrency(selected.delivery_charge)} muted />
                )}
                <div className="border-t border-border pt-1 mt-1">
                  <Row label="Total" value={formatCurrency(selected.total)} bold />
                </div>
                {selected.total_paid > 0 && (
                  <Row
                    label="Balance"
                    value={formatCurrency(selected.balance_due)}
                    bold
                  />
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setAddOpen((v) => !v)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add Items
                </button>
                <button
                  onClick={printKot}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 transition-colors"
                >
                  <ChefHat className="h-4 w-4" />
                  {pendingKot > 0 ? `Print KOT (${pendingKot})` : "Reprint KOT"}
                </button>
                <button
                  onClick={() => printBill(58)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/70 transition-colors"
                >
                  <Printer className="h-4 w-4" /> Bill 58mm
                </button>
                <button
                  onClick={() => printBill(80)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/70 transition-colors"
                >
                  <Printer className="h-4 w-4" /> Bill 80mm
                </button>
              </div>

              {/* Add items menu */}
              {addOpen && (
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <UtensilsCrossed className="h-4 w-4" /> Add Items
                    </p>
                    <button
                      onClick={() => {
                        setAddOpen(false);
                        setAddCart([]);
                      }}
                      className="p-1 rounded hover:bg-accent text-muted-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {menuData === undefined ? (
                    <p className="text-center text-muted-foreground text-sm py-6">Loading…</p>
                  ) : (
                    <div className="p-2 space-y-2">
                      {/* Search (primary) */}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <input
                          autoFocus
                          value={addSearch}
                          onChange={(e) => setAddSearch(e.target.value)}
                          placeholder="Search items…"
                          className="w-full pl-8 pr-8 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                        {addSearch && (
                          <button
                            onClick={() => setAddSearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            aria-label="Clear"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      {/* Browse-by-category (only when not searching) */}
                      {addTerm.length === 0 && (
                        <select
                          value={addCatId ?? ""}
                          onChange={(e) =>
                            setAddCatId((e.target.value || null) as Id<"menu_categories"> | null)
                          }
                          className="w-full px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {menuData.map((c) => (
                            <option key={c._id} value={c._id}>
                              {c.name} ({c.items.length})
                            </option>
                          ))}
                        </select>
                      )}

                      {/* Single-column results */}
                      <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border">
                        {addItemsToShow.length === 0 ? (
                          <p className="text-center text-muted-foreground text-sm py-6">
                            {addTerm ? `No items match “${addSearch}”` : "No items"}
                          </p>
                        ) : (
                          addItemsToShow.map((item) => (
                            <AddRow
                              key={item._id}
                              item={item}
                              qtyOf={qtyOf}
                              onAdd={(vr) => addToCart(item, vr)}
                              onInc={(label) => changeAddQty(item._id, label, 1)}
                              onDec={(label) => changeAddQty(item._id, label, -1)}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  )}
                  {addCart.length > 0 && (
                    <div className="border-t border-border p-3 space-y-2">
                      {addCart.map((c) => (
                        <div
                          key={`${c.menu_item_id}::${c.variant_label ?? ""}`}
                          className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                        >
                          <span className="min-w-0 truncate">
                            {lineName(c.name, c.variant_label)} ×{c.quantity}
                          </span>
                          {c.open_price ? (
                            <span className="flex items-center gap-1 shrink-0">
                              ₹
                              <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={c.price || ""}
                                onChange={(e) =>
                                  setAddPrice(c.menu_item_id, c.variant_label, e.target.value)
                                }
                                placeholder="price"
                                className="w-20 px-2 py-1 rounded-md border border-input bg-background text-right"
                              />
                            </span>
                          ) : (
                            <span className="tabular-nums shrink-0">
                              {formatCurrency(c.price * c.quantity)}
                            </span>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={submitAddItems}
                        disabled={addBusy}
                        className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                      >
                        {addBusy
                          ? "Adding…"
                          : `Add ${addCart.reduce((s, c) => s + c.quantity, 0)} item(s)`}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Settle */}
              <div className="bg-card border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Settle {formatCurrency(selected.balance_due)}
                  </p>
                  <button
                    onClick={() => (splitMode ? setSplitMode(false) : enableSplit())}
                    className="text-xs text-primary hover:underline"
                  >
                    {splitMode ? "Single" : "Split"}
                  </button>
                </div>

                {!splitMode ? (
                  <div className="flex gap-1">
                    {(["cash", "card", "upi"] as Method[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setPayMethod(m)}
                        className={cn(
                          "flex-1 py-1.5 text-xs rounded-md uppercase tracking-wide transition-colors",
                          payMethod === m
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {splits.map((row, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-sm">₹</span>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={row.amount}
                          onChange={(e) => updateSplit(i, "amount", e.target.value)}
                          className="w-24 px-2 py-1.5 text-sm rounded-md border border-input bg-background text-right tabular-nums"
                        />
                        <select
                          value={row.method}
                          onChange={(e) => updateSplit(i, "method", e.target.value)}
                          className="flex-1 px-2 py-1.5 text-xs rounded-md border border-input bg-background uppercase"
                        >
                          <option value="cash">cash</option>
                          <option value="card">card</option>
                          <option value="upi">upi</option>
                        </select>
                        <button
                          onClick={() => removeSplit(i)}
                          className="p-1 text-muted-foreground hover:text-destructive shrink-0"
                          aria-label="Remove split"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addSplitRow}
                      className="text-xs text-primary hover:underline"
                    >
                      + Add split
                    </button>
                    <div
                      className={cn(
                        "flex justify-between text-xs pt-1 border-t border-border",
                        Math.abs(splitRemaining) < 0.01
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground"
                      )}
                    >
                      <span>
                        {formatCurrency(splitAllocated)} / {formatCurrency(selected.balance_due)}
                      </span>
                      <span className="tabular-nums">
                        {Math.abs(splitRemaining) < 0.01
                          ? "✓ covered"
                          : splitRemaining > 0
                            ? `${formatCurrency(splitRemaining)} left`
                            : `${formatCurrency(-splitRemaining)} over`}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSettle}
                  disabled={
                    settling ||
                    selected.balance_due <= 0 ||
                    (splitMode && Math.abs(splitRemaining) >= 0.01)
                  }
                  className="w-full py-2.5 bg-green-600 text-white rounded-md font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {settling ? "Settling…" : `Settle ${formatCurrency(selected.balance_due)}`}
                </button>
              </div>

              {/* Cancel (void) this open bill — password-gated */}
              <button
                onClick={() => setCancelOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 py-2.5 rounded-md border border-destructive/40 text-destructive text-sm font-medium hover:bg-destructive/10 transition-colors"
              >
                <Ban className="h-4 w-4" /> Cancel Bill
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Password-gated cancel confirmation */}
      <CancelBillDialog
        open={cancelOpen}
        orderId={selected?._id ?? null}
        orderNumber={selected?.order_number ?? ""}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => onSelect(null)}
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface AddRowItem {
  _id: Id<"menu_items">;
  name: string;
  price: number;
  is_veg?: boolean;
  open_price?: boolean;
  variants?: { label: string; price: number; unit_factor?: number }[];
}

/** A single search/browse result: one row, with portions listed inline. */
function AddRow({
  item,
  qtyOf,
  onAdd,
  onInc,
  onDec,
}: {
  item: AddRowItem;
  qtyOf: (id: Id<"menu_items">, label?: string) => number;
  onAdd: (variant?: { label: string; price: number }) => void;
  onInc: (label?: string) => void;
  onDec: (label?: string) => void;
}) {
  const variants = item.variants ?? [];
  const dot = (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        item.is_veg ? "bg-green-500" : "bg-red-500"
      )}
    />
  );

  if (variants.length > 0) {
    return (
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          {dot}
          <span className="text-sm font-medium truncate">{item.name}</span>
        </div>
        <div className="mt-1 space-y-1 pl-3.5">
          {variants.map((vr) => {
            const qty = qtyOf(item._id, vr.label);
            return (
              <div key={vr.label} className="flex items-center gap-2">
                <span className="text-xs flex-1 min-w-0 truncate">{vr.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(vr.price)}
                </span>
                <MiniStepper
                  qty={qty}
                  onAdd={() => onAdd({ label: vr.label, price: vr.price })}
                  onInc={() => onInc(vr.label)}
                  onDec={() => onDec(vr.label)}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const qty = qtyOf(item._id, undefined);
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      {dot}
      <span className="text-sm flex-1 min-w-0 truncate">{item.name}</span>
      <span className="text-xs tabular-nums text-muted-foreground shrink-0">
        {item.open_price ? "As per size" : formatCurrency(item.price)}
      </span>
      <MiniStepper
        qty={qty}
        onAdd={() => onAdd()}
        onInc={() => onInc()}
        onDec={() => onDec()}
      />
    </div>
  );
}

function MiniStepper({
  qty,
  onAdd,
  onInc,
  onDec,
}: {
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  if (qty === 0) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="h-7 w-7 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
        aria-label="Add"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onDec}
        className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent"
        aria-label="Decrease"
      >
        <Minus className="h-3 w-3" />
      </button>
      <span className="w-5 text-center text-sm font-medium tabular-nums">{qty}</span>
      <button
        type="button"
        onClick={onInc}
        className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent"
        aria-label="Increase"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

function BillList({
  bills,
  onSelect,
}: {
  bills: OpenBill[];
  onSelect: (id: Id<"restaurant_orders">) => void;
}) {
  if (bills.length === 0) {
    return (
      <p className="text-center text-muted-foreground text-sm py-16">
        No open bills right now
      </p>
    );
  }
  return (
    <div className="p-3 space-y-2">
      {bills.map((b) => (
        <button
          key={b._id}
          onClick={() => onSelect(b._id)}
          className="w-full text-left bg-card border border-border rounded-lg px-3 py-2.5 hover:border-primary/50 hover:bg-accent/40 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-sm">{b.order_number}</span>
            <span className="font-semibold text-sm tabular-nums">
              {formatCurrency(b.balance_due)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground capitalize truncate">
              {b.order_type.replace("_", " ")}
              {b.table ? ` · ${b.table.table_number}` : ""}
              {` · ${b.items.reduce((s, i) => s + i.quantity, 0)} item(s)`}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize shrink-0">
              {b.status}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between",
        muted && "text-muted-foreground",
        bold && "font-semibold text-foreground"
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
