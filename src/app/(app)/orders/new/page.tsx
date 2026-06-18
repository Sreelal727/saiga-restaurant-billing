"use client";

import { useState, useEffect, Suspense } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency } from "@/lib/utils";
import { ArrowLeft, Plus, Minus, Trash2, Search, X } from "lucide-react";
import { CategoryRail } from "@/components/menu/category-rail";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTenant } from "@/components/outlet/outlet-context";

type OrderType = "dine_in" | "takeaway" | "delivery";

interface CartItem {
  menu_item_id: Id<"menu_items">;
  name: string;
  variant_label?: string;
  price: number;
  quantity: number;
  notes?: string;
  open_price?: boolean; // price entered at billing ("as per size")
}

interface Variant {
  label: string;
  price: number;
}

interface MenuItemLike {
  _id: Id<"menu_items">;
  name: string;
  price: number;
  open_price?: boolean;
}

// Match a cart line by item + chosen portion (composite identity)
function sameLine(c: CartItem, id: Id<"menu_items">, label?: string): boolean {
  return c.menu_item_id === id && c.variant_label === label;
}

function NewOrderForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTableId = searchParams.get("table") as Id<"restaurant_tables"> | null;
  const preselectedWaiterId = searchParams.get("waiter") as Id<"restaurant_staff"> | null;
  const typeParam = searchParams.get("type");
  const preselectedType: OrderType =
    typeParam === "takeaway" || typeParam === "delivery" ? typeParam : "dine_in";

  const tenant = useTenant();
  const menuData = useQuery(api.menu.listWithCategories, tenant.args ?? "skip");
  const tables = useQuery(api.tables.list, tenant.args ?? "skip");
  const staff = useQuery(
    api.staff.list,
    tenant.args ? { ...tenant.args, active_only: true } : "skip"
  );
  const settings = useQuery(api.settings.get, tenant.args ?? "skip");
  const createOrder = useMutation(api.orders.create);
  const settleFull = useMutation(api.orders.recordPayment);
  const addPayment = useMutation(api.orders.addPayment);

  const [customerPhone, setCustomerPhone] = useState("");
  // Only fire the query once a plausible phone has been typed
  const phoneLookupArg =
    tenant.args && customerPhone.trim().length >= 4
      ? { ...tenant.args, phone: customerPhone.trim() }
      : "skip";
  const existingCustomer = useQuery(api.customers.findByPhone, phoneLookupArg);

  const [orderType, setOrderType] = useState<OrderType>(preselectedType);
  const [menuSearch, setMenuSearch] = useState("");
  const [selectedCatId, setSelectedCatId] = useState<Id<"menu_categories"> | null>(null);
  const [tableId, setTableId] = useState<Id<"restaurant_tables"> | "">(preselectedTableId ?? "");
  const [waiterId, setWaiterId] = useState<Id<"restaurant_staff"> | "">(preselectedWaiterId ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<Id<"restaurant_customers"> | "">("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [tips, setTips] = useState(0);
  const [packingCharge, setPackingCharge] = useState(0);
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const [notes, setNotes] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "upi">("cash");
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<
    { amount: string; method: "cash" | "card" | "upi" }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);

  const cgst = settings?.cgst_rate ?? 2.5;
  const sgst = settings?.sgst_rate ?? 2.5;

  function addItem(item: MenuItemLike, variant?: Variant) {
    const label = variant?.label;
    const isOpen = !!item.open_price;
    const price = variant ? variant.price : item.price;
    setCart((prev) => {
      const existing = prev.find((c) => sameLine(c, item._id, label));
      if (existing) {
        return prev.map((c) =>
          sameLine(c, item._id, label) ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [
        ...prev,
        {
          menu_item_id: item._id,
          name: item.name,
          variant_label: label,
          price,
          quantity: 1,
          open_price: isOpen,
        },
      ];
    });
  }

  function setLinePrice(id: Id<"menu_items">, label: string | undefined, value: string) {
    const price = value === "" ? 0 : Number(value);
    if (!Number.isFinite(price) || price < 0) return;
    setCart((prev) =>
      prev.map((c) => (sameLine(c, id, label) ? { ...c, price } : c))
    );
  }

  function changeQty(id: Id<"menu_items">, label: string | undefined, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (sameLine(c, id, label) ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  function removeItem(id: Id<"menu_items">, label: string | undefined) {
    setCart((prev) => prev.filter((c) => !sameLine(c, id, label)));
  }

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  // Flat rupee discount, clamped so it never exceeds the subtotal.
  const discountAmt = Math.max(0, Math.min(discountAmount, subtotal));
  const taxable = subtotal - discountAmt;
  const cgstAmt = (taxable * cgst) / 100;
  const sgstAmt = (taxable * sgst) / 100;
  const total = taxable + cgstAmt + sgstAmt + tips + packingCharge + deliveryCharge;
  const splitAllocated = splits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const splitRemaining = Math.round((total - splitAllocated) * 100) / 100;

  // Validate the cart and create the order; returns its id, or null if the
  // cart is invalid (a toast explains why). Shared by Save and Settle & Print.
  async function createOrderOrNull(): Promise<Id<"restaurant_orders"> | null> {
    if (cart.length === 0) {
      toast.error("Add at least one item");
      return null;
    }
    const missingPrice = cart.find((c) => c.open_price && c.price <= 0);
    if (missingPrice) {
      toast.error(`Enter a price for "${missingPrice.name}"`);
      return null;
    }
    if (!tenant.args) {
      toast.error("No outlet selected");
      return null;
    }
    return createOrder({
      ...tenant.args,
      order_type: orderType,
      table_id: tableId ? tableId : undefined,
      waiter_id: waiterId ? waiterId : undefined,
      customer_id: customerId ? customerId : undefined,
      customer_name: customerName || undefined,
      customer_phone: customerPhone || undefined,
      delivery_address: deliveryAddress || undefined,
      items: cart.map(({ menu_item_id, quantity, notes, variant_label, price, open_price }) => ({
        menu_item_id,
        quantity,
        notes,
        variant_label,
        price: open_price ? price : undefined,
      })),
      discount_amount: discountAmt,
      cgst_rate: cgst,
      sgst_rate: sgst,
      tips,
      packing_charge: packingCharge,
      delivery_charge: deliveryCharge,
      notes: notes || undefined,
    });
  }

  // "Save" — create the order and open it (held bill; settle later).
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const id = await createOrderOrNull();
      if (!id) {
        setSubmitting(false);
        return;
      }
      toast.success("Order saved");
      router.push(`/orders/${id}`);
    } catch {
      toast.error("Failed to create order");
      setSubmitting(false);
    }
  }

  // "Settle & Print" — create, take payment (single method or split across
  // several), then open the order with the bill auto-printing. The one-click
  // counter path.
  async function handleSettleAndPrint() {
    if (!tenant.args) {
      toast.error("No outlet selected");
      return;
    }
    // In split mode the entered payments must add up to the bill total.
    let splitLines: { amount: number; method: "cash" | "card" | "upi" }[] = [];
    if (splitMode) {
      splitLines = splits
        .map((s) => ({ amount: Number(s.amount), method: s.method }))
        .filter((s) => Number.isFinite(s.amount) && s.amount > 0);
      if (splitLines.length === 0) {
        toast.error("Add at least one split payment");
        return;
      }
      const allocated = splitLines.reduce((sum, s) => sum + s.amount, 0);
      if (Math.abs(allocated - total) > 0.01) {
        toast.error(
          `Splits must total ${formatCurrency(total)} (currently ${formatCurrency(allocated)})`
        );
        return;
      }
    }
    setSubmitting(true);
    try {
      const id = await createOrderOrNull();
      if (!id) {
        setSubmitting(false);
        return;
      }
      if (splitMode) {
        // Record each split sequentially — addPayment checks the running
        // balance, so concurrent calls could falsely trip overpayment.
        for (const line of splitLines) {
          await addPayment({
            ...tenant.args,
            id,
            amount: line.amount,
            method: line.method,
          });
        }
      } else {
        await settleFull({ ...tenant.args, id, payment_method: payMethod });
      }
      // Default the receipt to 58mm for now (changeable later).
      router.push(`/orders/${id}?print=bill&w=58`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to settle order");
      setSubmitting(false);
    }
  }

  function enableSplit() {
    setSplitMode(true);
    // Seed with the full amount on one line so the cashier just edits down.
    setSplits((prev) =>
      prev.length > 0 ? prev : [{ amount: total.toFixed(2), method: "cash" }]
    );
  }

  function addSplitRow() {
    const allocated = splits.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const remaining = Math.max(0, total - allocated);
    setSplits((prev) => [
      ...prev,
      { amount: remaining > 0 ? remaining.toFixed(2) : "", method: "cash" },
    ]);
  }

  function updateSplit(
    index: number,
    field: "amount" | "method",
    value: string
  ) {
    setSplits((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function removeSplit(index: number) {
    setSplits((prev) => prev.filter((_, i) => i !== index));
  }

  // Filter the menu by the search term (matches item name or description).
  const menuTerm = menuSearch.trim().toLowerCase();
  const filteredMenu =
    menuData === undefined
      ? undefined
      : menuTerm.length === 0
        ? menuData
        : menuData
            .map((cat) => ({
              ...cat,
              items: cat.items.filter(
                (i) =>
                  i.name.toLowerCase().includes(menuTerm) ||
                  (i.description?.toLowerCase().includes(menuTerm) ?? false)
              ),
            }))
            .filter((cat) => cat.items.length > 0);

  // The opened category (left-rail selection), if any.
  const selectedCat =
    selectedCatId && menuData
      ? menuData.find((c) => c._id === selectedCatId) ?? null
      : null;

  // Auto-select the first category so items show immediately.
  useEffect(() => {
    if (!menuTerm && !selectedCatId && menuData && menuData.length > 0) {
      setSelectedCatId(menuData[0]._id);
    }
  }, [menuTerm, selectedCatId, menuData]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header
        title="New Order"
        action={
          <Link href="/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Orders
          </Link>
        }
      />
      <form onSubmit={handleSave} className="flex-1 p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">

          {/* Left: Menu */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search bar */}
            <div className="relative sticky top-0 z-10">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder="Search the menu…"
                className="w-full pl-9 pr-9 py-2.5 text-sm bg-card border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
              />
              {menuSearch && (
                <button
                  type="button"
                  onClick={() => setMenuSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {menuData === undefined ? (
              <div className="text-center text-muted-foreground text-sm py-12">Loading menu…</div>
            ) : (
              <div className={cn("flex flex-col sm:flex-row gap-3", menuTerm && "block")}>
                {!menuTerm && (
                  <CategoryRail
                    categories={menuData}
                    selectedId={selectedCatId}
                    onSelect={setSelectedCatId}
                  />
                )}
                <div className="flex-1 min-w-0 space-y-4">
                  {menuTerm && filteredMenu && filteredMenu.length === 0 ? (
                    <div className="text-center text-muted-foreground text-sm py-12">
                      No items match “{menuSearch}”
                    </div>
                  ) : (
                    (menuTerm ? filteredMenu ?? [] : selectedCat ? [selectedCat] : []).map((cat) => (
                <div key={cat._id} className="bg-card border border-border rounded-lg">
                  <div className="px-4 py-2.5 border-b border-border text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {cat.name}
                  </div>
                  <div className="divide-y divide-border">
                    {cat.items.map((item) => {
                      const variants = item.variants ?? [];
                      const hasVariants = variants.length > 0;
                      return (
                        <div key={item._id} className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full shrink-0",
                                item.is_veg ? "bg-green-500" : "bg-red-500"
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">{item.name}</p>
                              {item.description && (
                                <p className="text-xs text-muted-foreground">{item.description}</p>
                              )}
                            </div>
                            {!hasVariants && (
                              <>
                                <span className="text-sm tabular-nums text-muted-foreground">
                                  {item.open_price ? "As per size" : formatCurrency(item.price)}
                                </span>
                                <QtyControl
                                  line={cart.find((c) => sameLine(c, item._id, undefined))}
                                  onAdd={() => addItem(item)}
                                  onInc={() => changeQty(item._id, undefined, 1)}
                                  onDec={() => changeQty(item._id, undefined, -1)}
                                />
                              </>
                            )}
                          </div>
                          {hasVariants && (
                            <div className="mt-2 space-y-1.5 pl-5">
                              {variants.map((vr) => (
                                <div key={vr.label} className="flex items-center gap-3">
                                  <span className="text-sm flex-1">{vr.label}</span>
                                  <span className="text-sm tabular-nums text-muted-foreground">
                                    {formatCurrency(vr.price)}
                                  </span>
                                  <QtyControl
                                    line={cart.find((c) => sameLine(c, item._id, vr.label))}
                                    onAdd={() => addItem(item, vr)}
                                    onInc={() => changeQty(item._id, vr.label, 1)}
                                    onDec={() => changeQty(item._id, vr.label, -1)}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Order details + bill — stays in view while the menu scrolls */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">


            {/* Order type */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium">Order Details</p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Order Type</label>
                <div className="flex gap-1">
                  {(["dine_in", "takeaway", "delivery"] as OrderType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setOrderType(t);
                        // Reset charges that don't apply to the new type
                        if (t !== "takeaway" && t !== "delivery") setPackingCharge(0);
                        if (t !== "delivery") setDeliveryCharge(0);
                      }}
                      className={cn(
                        "flex-1 py-1.5 text-xs rounded-md capitalize transition-colors",
                        orderType === t
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
                      )}
                    >
                      {t.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              {orderType === "dine_in" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Table</label>
                  <select
                    value={tableId}
                    onChange={(e) => setTableId(e.target.value as Id<"restaurant_tables">)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">— Select Table —</option>
                    {tables
                      ?.filter((t) => t.status !== "occupied" || t._id === preselectedTableId)
                      .map((t) => (
                        <option key={t._id} value={t._id}>
                          {t.table_number} (cap {t.capacity}){t.status === "reserved" ? " · reserved" : ""}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Waiter</label>
                <select
                  value={waiterId}
                  onChange={(e) => setWaiterId(e.target.value as Id<"restaurant_staff">)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— None —</option>
                  {staff
                    ?.filter((s) => s.role === "waiter")
                    .map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Customer Phone
                  <span className="text-muted-foreground/70 font-normal ml-1">
                    (optional — looks up existing customer)
                  </span>
                </label>
                <input
                  value={customerPhone}
                  onChange={(e) => {
                    setCustomerPhone(e.target.value);
                    // Typing a different phone breaks the link to a previously applied customer
                    if (customerId) setCustomerId("");
                  }}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {existingCustomer && existingCustomer._id !== customerId && (
                  <div className="mt-2 flex items-center justify-between gap-2 p-2 rounded-md bg-primary/5 border border-primary/20 text-xs">
                    <span>
                      <span className="font-medium">{existingCustomer.name}</span>{" "}
                      <span className="text-muted-foreground">
                        — existing customer
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCustomerId(existingCustomer._id);
                        setCustomerName(existingCustomer.name);
                        if (existingCustomer.default_address) {
                          setDeliveryAddress(existingCustomer.default_address);
                        }
                        toast.success("Customer details applied");
                      }}
                      className="px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Apply details
                    </button>
                  </div>
                )}
                {customerId && existingCustomer?._id === customerId && (
                  <p className="mt-1.5 text-xs text-green-600 dark:text-green-400">
                    ✓ Linked to {existingCustomer.name}
                  </p>
                )}
                {customerPhone.trim().length >= 4 &&
                  existingCustomer === null && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      New customer — will be saved on order placement
                    </p>
                  )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground block mb-1">Customer Name</label>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Optional"
                />
              </div>

              {orderType === "delivery" && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Delivery Address</label>
                  <textarea
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    rows={2}
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                </div>
              )}
            </div>

            {/* Charges */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-2.5">
              <p className="text-sm font-medium">Charges & Discounts</p>
              <NumberField label="Discount (₹)" value={discountAmount} onChange={setDiscountAmount} min={0} step={10} />
              <NumberField label="Tips (₹)" value={tips} onChange={setTips} min={0} step={10} />
              {(orderType === "takeaway" || orderType === "delivery") && (
                <NumberField label="Packing (₹)" value={packingCharge} onChange={setPackingCharge} min={0} step={5} />
              )}
              {orderType === "delivery" && (
                <NumberField label="Delivery (₹)" value={deliveryCharge} onChange={setDeliveryCharge} min={0} step={10} />
              )}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Bill summary */}
            {cart.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4 text-sm space-y-1.5">
                <p className="font-medium mb-2">Bill Summary</p>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {cart.map((c) => (
                    <div
                      key={`${c.menu_item_id}::${c.variant_label ?? ""}`}
                      className="flex justify-between items-center gap-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => removeItem(c.menu_item_id, c.variant_label)}
                          className="text-destructive hover:text-destructive/80 shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <span className="truncate">
                          {c.name}
                          {c.variant_label ? ` (${c.variant_label})` : ""} ×{c.quantity}
                        </span>
                      </div>
                      {c.open_price ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-muted-foreground">₹</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={c.price || ""}
                            onChange={(e) =>
                              setLinePrice(c.menu_item_id, c.variant_label, e.target.value)
                            }
                            placeholder="price"
                            className="w-20 px-2 py-1 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right"
                          />
                        </div>
                      ) : (
                        <span className="tabular-nums shrink-0">{formatCurrency(c.price * c.quantity)}</span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-border pt-2 mt-2 space-y-1">
                  <BillLine label="Subtotal" value={formatCurrency(subtotal)} />
                  {discountAmt > 0 && <BillLine label="Discount" value={`−${formatCurrency(discountAmt)}`} />}
                  <BillLine label={`CGST ${cgst}%`} value={formatCurrency(cgstAmt)} />
                  <BillLine label={`SGST ${sgst}%`} value={formatCurrency(sgstAmt)} />
                  {tips > 0 && <BillLine label="Tips" value={formatCurrency(tips)} />}
                  {packingCharge > 0 && <BillLine label="Packing" value={formatCurrency(packingCharge)} />}
                  {deliveryCharge > 0 && <BillLine label="Delivery" value={formatCurrency(deliveryCharge)} />}
                  <div className="flex justify-between font-semibold text-sm pt-1 border-t border-border">
                    <span>Total</span>
                    <span className="tabular-nums">{formatCurrency(total)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Payment method — used by Settle & Print */}
            <div className="bg-card border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Payment</p>
                <button
                  type="button"
                  onClick={() => (splitMode ? setSplitMode(false) : enableSplit())}
                  className="text-xs text-primary hover:underline"
                >
                  {splitMode ? "Single payment" : "Split payment"}
                </button>
              </div>

              {!splitMode ? (
                <div className="flex gap-1">
                  {(["cash", "card", "upi"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
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
                        placeholder="0.00"
                        className="w-24 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right tabular-nums"
                      />
                      <select
                        value={row.method}
                        onChange={(e) => updateSplit(i, "method", e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring uppercase"
                      >
                        <option value="cash">cash</option>
                        <option value="card">card</option>
                        <option value="upi">upi</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => removeSplit(i)}
                        className="p-1 text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Remove split"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
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
                      Allocated {formatCurrency(splitAllocated)} / {formatCurrency(total)}
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
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={handleSettleAndPrint}
                disabled={
                  submitting ||
                  cart.length === 0 ||
                  (splitMode && Math.abs(splitRemaining) >= 0.01)
                }
                className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting
                  ? "Working…"
                  : `Settle ${formatCurrency(total)} & Print`}
              </button>
              <button
                type="submit"
                disabled={submitting || cart.length === 0}
                className="w-full py-2.5 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Saving…" : "Save (settle later)"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function QtyControl({
  line,
  onAdd,
  onInc,
  onDec,
}: {
  line: CartItem | undefined;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  if (!line) {
    return (
      <button
        type="button"
        onClick={onAdd}
        className="h-7 w-7 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
        aria-label="Add"
      >
        <Plus className="h-3 w-3" />
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
      <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
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

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-muted-foreground flex-1">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right"
      />
    </div>
  );
}

function BillLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>}>
      <NewOrderForm />
    </Suspense>
  );
}
