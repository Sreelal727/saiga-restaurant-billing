"use client";

import { use, useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Printer, Plus, Minus, UtensilsCrossed, X, Trash2, Wallet, ChefHat } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "paid"
  | "cancelled";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ready: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  served: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const PAYMENT_METHODS = ["cash", "card", "upi", "online"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const order = useQuery(api.orders.get, { id: id as Id<"restaurant_orders"> });
  const menuData = useQuery(api.menu.listWithCategories);
  const updateStatus = useMutation(api.orders.updateStatus);
  const addPayment = useMutation(api.orders.addPayment);
  const removePayment = useMutation(api.orders.removePayment);
  const addItems = useMutation(api.orders.addItems);
  const markKotPrinted = useMutation(api.orders.markKotPrinted);

  // Print mode controls which printable block is included in @media print.
  const [printMode, setPrintMode] = useState<"bill" | "kot">("bill");
  const [kotPayload, setKotPayload] = useState<{
    batch_number: number;
    items: Array<{
      _id: string;
      name: string;
      quantity: number;
      notes?: string;
    }>;
  } | null>(null);

  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [payerName, setPayerName] = useState("");
  const [paying, setPaying] = useState(false);

  // Keep the amount field pre-filled with the current balance unless the
  // cashier has typed something else.
  const [hasEditedAmount, setHasEditedAmount] = useState(false);
  useEffect(() => {
    if (!hasEditedAmount && order && order.balance_due > 0) {
      setPayAmount(order.balance_due.toFixed(2));
    }
  }, [order, hasEditedAmount]);

  const [showAddItems, setShowAddItems] = useState(false);
  const [addCart, setAddCart] = useState<Array<{ menu_item_id: Id<"menu_items">; name: string; price: number; quantity: number }>>([]);
  const [addSubmitting, setAddSubmitting] = useState(false);

  function addToCart(item: { _id: Id<"menu_items">; name: string; price: number }) {
    setAddCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item._id);
      if (existing) return prev.map((c) => c.menu_item_id === item._id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menu_item_id: item._id, name: item.name, price: item.price, quantity: 1 }];
    });
  }

  function changeAddQty(id: Id<"menu_items">, delta: number) {
    setAddCart((prev) =>
      prev.map((c) => c.menu_item_id === id ? { ...c, quantity: c.quantity + delta } : c)
          .filter((c) => c.quantity > 0)
    );
  }

  async function handleAddItems() {
    if (!order || addCart.length === 0) return;
    setAddSubmitting(true);
    try {
      await addItems({
        id: order._id,
        items: addCart.map(({ menu_item_id, quantity }) => ({ menu_item_id, quantity })),
      });
      toast.success(`${addCart.length} item${addCart.length > 1 ? "s" : ""} added to order`);
      setAddCart([]);
      setShowAddItems(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add items");
    } finally {
      setAddSubmitting(false);
    }
  }

  if (order === undefined) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <Header title="Order" />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      </div>
    );
  }

  if (order === null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <Header title="Order" />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Order not found
        </div>
      </div>
    );
  }

  async function handleStatus(status: OrderStatus): Promise<void> {
    if (!order) return;
    try {
      await updateStatus({ id: order._id, status });
      toast.success(`Status updated to ${status}`);
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handleAddPayment(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!order) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setPaying(true);
    try {
      await addPayment({
        id: order._id,
        amount,
        method: payMethod,
        payer_name: payerName.trim() || undefined,
      });
      toast.success("Payment recorded");
      setPayerName("");
      setHasEditedAmount(false); // re-syncs to new balance via the effect
      setPayAmount("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to record payment");
    } finally {
      setPaying(false);
    }
  }

  async function handleRemovePayment(paymentId: Id<"order_payments">): Promise<void> {
    if (!confirm("Remove this payment?")) return;
    try {
      await removePayment({ id: paymentId });
      toast.success("Payment removed");
    } catch {
      toast.error("Failed to remove payment");
    }
  }

  function handlePrintBill(): void {
    setPrintMode("bill");
    // Ensure the bill block is the one that renders before the dialog opens
    setTimeout(() => window.print(), 0);
  }

  async function handlePrintKOT(): Promise<void> {
    if (!order) return;
    try {
      const result = await markKotPrinted({ id: order._id });
      if (result.batch_number === null) {
        // Nothing new — reprint the most recent batch as a courtesy
        const lastBatch = order.kot_count ?? 0;
        if (lastBatch === 0) {
          toast.info("No items to send to kitchen yet");
          return;
        }
        const reprintItems = order.items.filter((i) => i.kot_batch === lastBatch);
        setKotPayload({
          batch_number: lastBatch,
          items: reprintItems.map((i) => ({
            _id: i._id,
            name: i.name,
            quantity: i.quantity,
            notes: i.notes,
          })),
        });
        toast.info(`Reprinting KOT #${lastBatch}`);
      } else {
        setKotPayload({
          batch_number: result.batch_number,
          items: result.items.map((i) => ({
            _id: i._id,
            name: i.name,
            quantity: i.quantity,
            notes: i.notes,
          })),
        });
        toast.success(`KOT #${result.batch_number} sent to kitchen`);
      }
      setPrintMode("kot");
      setTimeout(() => window.print(), 50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to print KOT");
    }
  }

  const backLink = (
    <Link
      href="/orders"
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
    >
      <ArrowLeft className="h-4 w-4" />
      Orders
    </Link>
  );

  const pendingKotCount = order.items.filter(
    (i) => i.kot_batch === undefined
  ).length;

  const kotBtn =
    order.status !== "cancelled" ? (
      <button
        onClick={handlePrintKOT}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600 transition-colors print:hidden"
        title={
          pendingKotCount > 0
            ? `Send ${pendingKotCount} new item${pendingKotCount === 1 ? "" : "s"} to kitchen`
            : "Reprint last KOT"
        }
      >
        <ChefHat className="h-4 w-4" />
        {pendingKotCount > 0 ? `Print KOT (${pendingKotCount})` : "Reprint KOT"}
      </button>
    ) : null;

  const printBtn = (
    <button
      onClick={handlePrintBill}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/70 transition-colors print:hidden"
    >
      <Printer className="h-4 w-4" />
      Print Bill
    </button>
  );

  const addItemsBtn =
    order.status !== "paid" && order.status !== "cancelled" ? (
      <button
        onClick={() => { setShowAddItems((v) => !v); setAddCart([]); }}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors print:hidden"
      >
        <Plus className="h-4 w-4" />
        Add Items
      </button>
    ) : null;

  return (
    <>
      {/* ── Print-only KOT (kitchen order ticket) ── */}
      <div
        className={cn(
          "text-black bg-white p-6 max-w-xs mx-auto text-sm",
          printMode === "kot" ? "hidden print:block" : "hidden"
        )}
      >
        <div className="text-center mb-4">
          <p className="font-bold text-base uppercase tracking-wide">Kitchen Order</p>
          {kotPayload && (
            <p className="text-xs text-gray-500">KOT #{kotPayload.batch_number}</p>
          )}
          <p className="font-semibold mt-1">{order.order_number}</p>
        </div>
        <div className="border-t border-dashed border-gray-400 my-2" />
        <div className="space-y-0.5 text-xs mb-2">
          <div className="flex justify-between">
            <span className="text-gray-500">Type</span>
            <span className="capitalize">{order.order_type.replace("_", " ")}</span>
          </div>
          {order.table && (
            <div className="flex justify-between">
              <span className="text-gray-500">Table</span>
              <span>{order.table.table_number}</span>
            </div>
          )}
          {order.waiter && (
            <div className="flex justify-between">
              <span className="text-gray-500">Waiter</span>
              <span>{order.waiter.name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Sent</span>
            <span>{formatDateTime(Date.now())}</span>
          </div>
        </div>
        <div className="border-t border-dashed border-gray-400 my-2" />
        {/* KOT items — no prices, kitchen only cares about what + how many */}
        <table className="w-full text-sm mb-2">
          <thead>
            <tr className="text-gray-500 text-xs">
              <th className="text-left font-normal pb-1">Item</th>
              <th className="text-right font-normal pb-1">Qty</th>
            </tr>
          </thead>
          <tbody>
            {kotPayload?.items.map((item) => (
              <tr key={item._id}>
                <td className="py-1">
                  <div className="font-semibold">{item.name}</div>
                  {item.notes && (
                    <div className="text-xs italic text-gray-600">
                      — {item.notes}
                    </div>
                  )}
                </td>
                <td className="text-right py-1 tabular-nums font-bold text-lg">
                  ×{item.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {order.notes && (
          <>
            <div className="border-t border-dashed border-gray-400 my-2" />
            <p className="text-xs italic">📝 {order.notes}</p>
          </>
        )}
      </div>

      {/* ── Print-only receipt ── */}
      <div
        className={cn(
          "text-black bg-white p-6 max-w-xs mx-auto text-sm",
          printMode === "bill" ? "hidden print:block" : "hidden"
        )}
      >
        <div className="text-center mb-4">
          <p className="font-bold text-lg">SAIGA RESTAURANT</p>
          <p className="text-xs text-gray-500">Tax Invoice</p>
          <p className="font-semibold mt-1">{order.order_number}</p>
        </div>

        <div className="border-t border-dashed border-gray-400 my-2" />

        <div className="space-y-0.5 text-xs mb-2">
          <div className="flex justify-between">
            <span className="text-gray-500">Type</span>
            <span className="capitalize">{order.order_type.replace("_", " ")}</span>
          </div>
          {order.table && (
            <div className="flex justify-between">
              <span className="text-gray-500">Table</span>
              <span>{order.table.table_number}</span>
            </div>
          )}
          {order.waiter && (
            <div className="flex justify-between">
              <span className="text-gray-500">Waiter</span>
              <span>{order.waiter.name}</span>
            </div>
          )}
          {order.customer_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Customer</span>
              <span>{order.customer_name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Date</span>
            <span>
              {order.paid_at
                ? formatDateTime(order.paid_at)
                : formatDateTime(order._creationTime)}
            </span>
          </div>
        </div>

        <div className="border-t border-dashed border-gray-400 my-2" />

        {/* Items */}
        <table className="w-full text-xs mb-2">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-normal pb-1">Item</th>
              <th className="text-center font-normal pb-1">Qty</th>
              <th className="text-right font-normal pb-1">Amt</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item._id}>
                <td className="py-0.5">{item.name}</td>
                <td className="text-center py-0.5">{item.quantity}</td>
                <td className="text-right py-0.5 tabular-nums">
                  {formatCurrency(item.price * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-dashed border-gray-400 my-2" />

        {/* Totals */}
        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(order.subtotal)}</span>
          </div>
          {order.discount_amount > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Discount ({order.discount_percent}%)</span>
              <span className="tabular-nums">−{formatCurrency(order.discount_amount)}</span>
            </div>
          )}
          <div className="flex justify-between text-gray-500">
            <span>CGST ({order.cgst_rate}%)</span>
            <span className="tabular-nums">{formatCurrency(order.cgst_amount)}</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>SGST ({order.sgst_rate}%)</span>
            <span className="tabular-nums">{formatCurrency(order.sgst_amount)}</span>
          </div>
          {order.tips > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Tips</span>
              <span className="tabular-nums">{formatCurrency(order.tips)}</span>
            </div>
          )}
          {order.packing_charge > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Packing</span>
              <span className="tabular-nums">{formatCurrency(order.packing_charge)}</span>
            </div>
          )}
          {order.delivery_charge > 0 && (
            <div className="flex justify-between text-gray-500">
              <span>Delivery</span>
              <span className="tabular-nums">{formatCurrency(order.delivery_charge)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold border-t border-gray-300 pt-1 mt-1">
            <span>TOTAL</span>
            <span className="tabular-nums">{formatCurrency(order.total)}</span>
          </div>
          {order.payment_method && (
            <div className="flex justify-between text-gray-500 mt-1">
              <span>Paid via</span>
              <span className="uppercase">{order.payment_method}</span>
            </div>
          )}
        </div>

        <div className="border-t border-dashed border-gray-400 my-3" />
        <p className="text-center text-xs text-gray-500">Thank you for dining with us!</p>
      </div>

      {/* ── Screen layout ── */}
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto print:hidden">
        <Header
          title={order.order_number}
          action={
            <div className="flex items-center gap-2">
              {backLink}
              {addItemsBtn}
              {kotBtn}
              {printBtn}
            </div>
          }
        />
        <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-4">

          {/* Meta */}
          <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
            <InfoRow label="Status">
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                  STATUS_STYLE[order.status]
                )}
              >
                {order.status}
              </span>
            </InfoRow>
            <InfoRow label="Type">
              <span className="capitalize">{order.order_type.replace("_", " ")}</span>
            </InfoRow>
            {order.table && (
              <InfoRow label="Table">{order.table.table_number}</InfoRow>
            )}
            {order.waiter && (
              <InfoRow label="Waiter">{order.waiter.name}</InfoRow>
            )}
            {order.customer_name && (
              <InfoRow label="Customer">{order.customer_name}</InfoRow>
            )}
            {order.customer_phone && (
              <InfoRow label="Phone">{order.customer_phone}</InfoRow>
            )}
            <InfoRow label="Created">{formatDateTime(order._creationTime)}</InfoRow>
            {order.paid_at && (
              <InfoRow label="Paid At">{formatDateTime(order.paid_at)}</InfoRow>
            )}
          </div>

          {/* Items */}
          <div className="bg-card border border-border rounded-lg">
            <div className="px-4 py-3 border-b border-border text-sm font-medium">Items</div>
            <div className="divide-y divide-border">
              {order.items.map((item) => (
                <div
                  key={item._id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="flex-1">{item.name}</span>
                  {item.notes && (
                    <span className="text-xs text-muted-foreground italic">
                      {item.notes}
                    </span>
                  )}
                  <span className="text-muted-foreground">×{item.quantity}</span>
                  <span className="tabular-nums font-medium">
                    {formatCurrency(item.price * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Bill summary */}
          <div className="bg-card border border-border rounded-lg p-4 text-sm space-y-1.5">
            <BillRow label="Subtotal" value={formatCurrency(order.subtotal)} />
            {order.discount_amount > 0 && (
              <BillRow
                label={`Discount (${order.discount_percent}%)`}
                value={`−${formatCurrency(order.discount_amount)}`}
                muted
              />
            )}
            <BillRow
              label={`CGST (${order.cgst_rate}%)`}
              value={formatCurrency(order.cgst_amount)}
              muted
            />
            <BillRow
              label={`SGST (${order.sgst_rate}%)`}
              value={formatCurrency(order.sgst_amount)}
              muted
            />
            {order.tips > 0 && (
              <BillRow label="Tips" value={formatCurrency(order.tips)} muted />
            )}
            {order.packing_charge > 0 && (
              <BillRow
                label="Packing Charge"
                value={formatCurrency(order.packing_charge)}
                muted
              />
            )}
            {order.delivery_charge > 0 && (
              <BillRow
                label="Delivery Charge"
                value={formatCurrency(order.delivery_charge)}
                muted
              />
            )}
            <div className="border-t border-border pt-2 mt-2">
              <BillRow label="Total" value={formatCurrency(order.total)} bold />
            </div>
            {order.payment_method && (
              <BillRow
                label="Payment"
                value={order.payment_method.toUpperCase()}
                muted
              />
            )}
          </div>

          {/* Add Items panel */}
          {showAddItems && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-medium flex items-center gap-2">
                  <UtensilsCrossed className="h-4 w-4" />
                  Add Items to Order
                </p>
                <button
                  onClick={() => { setShowAddItems(false); setAddCart([]); }}
                  className="p-1 rounded hover:bg-accent text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Menu list */}
              <div className="max-h-96 overflow-y-auto divide-y divide-border">
                {menuData === undefined ? (
                  <p className="text-center text-muted-foreground text-sm py-8">Loading menu…</p>
                ) : (
                  menuData.map((cat) => (
                    <div key={cat._id}>
                      <div className="px-4 py-2 bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {cat.name}
                      </div>
                      {cat.items.map((item) => {
                        const inCart = addCart.find((c) => c.menu_item_id === item._id);
                        return (
                          <div key={item._id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className={cn("h-2 w-2 rounded-full shrink-0", item.is_veg ? "bg-green-500" : "bg-red-500")} />
                            <span className="flex-1 text-sm truncate">{item.name}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">{formatCurrency(item.price)}</span>
                            {inCart ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => changeAddQty(item._id, -1)}
                                  className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-accent"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                                <span className="w-5 text-center text-sm font-medium">{inCart.quantity}</span>
                                <button
                                  type="button"
                                  onClick={() => changeAddQty(item._id, 1)}
                                  className="h-6 w-6 flex items-center justify-center rounded border border-border hover:bg-accent"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addToCart(item)}
                                className="h-6 w-6 flex items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Cart summary + submit */}
              {addCart.length > 0 && (
                <div className="border-t border-border px-4 py-3 space-y-2">
                  <div className="space-y-1">
                    {addCart.map((c) => (
                      <div key={c.menu_item_id} className="flex justify-between text-xs text-muted-foreground">
                        <span>{c.name} ×{c.quantity}</span>
                        <span className="tabular-nums">{formatCurrency(c.price * c.quantity)}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleAddItems}
                    disabled={addSubmitting}
                    className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {addSubmitting ? "Adding…" : `Add ${addCart.reduce((s, c) => s + c.quantity, 0)} item${addCart.reduce((s, c) => s + c.quantity, 0) > 1 ? "s" : ""} to Order`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Status progression actions */}
          {order.status !== "paid" &&
            order.status !== "cancelled" &&
            order.status !== "served" && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">Actions</p>
                <div className="flex flex-wrap gap-2">
                  {!["confirmed", "preparing", "ready"].includes(order.status) && (
                    <button
                      onClick={() => handleStatus("confirmed")}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
                    >
                      Confirm
                    </button>
                  )}
                  {order.status === "confirmed" && (
                    <button
                      onClick={() => handleStatus("preparing")}
                      className="px-3 py-1.5 bg-orange-500 text-white rounded-md text-sm hover:bg-orange-600"
                    >
                      Start Preparing
                    </button>
                  )}
                  {order.status === "preparing" && (
                    <button
                      onClick={() => handleStatus("ready")}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700"
                    >
                      Mark Ready
                    </button>
                  )}
                  {order.status === "ready" && (
                    <button
                      onClick={() => handleStatus("served")}
                      className="px-3 py-1.5 bg-green-600 text-white rounded-md text-sm hover:bg-green-700"
                    >
                      Mark Served
                    </button>
                  )}
                  <button
                    onClick={() => handleStatus("cancelled")}
                    className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-destructive hover:text-white transition-colors"
                  >
                    Cancel Order
                  </button>
                </div>
              </div>
            )}

          {/* Payments (split bill) — visible from "served" onward or whenever
              any payment has been recorded. */}
          {(order.status === "served" ||
            order.status === "paid" ||
            order.payments.length > 0) &&
            order.status !== "cancelled" && (
              <div className="bg-card border border-border rounded-lg p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm font-medium">Payments</p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Paid <span className="tabular-nums font-medium text-foreground">
                      {formatCurrency(order.total_paid)}
                    </span>{" "}
                    / {formatCurrency(order.total)}
                    {order.balance_due > 0 && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 font-medium">
                        Balance {formatCurrency(order.balance_due)}
                      </span>
                    )}
                    {order.balance_due === 0 && order.total_paid > 0 && (
                      <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 font-medium">
                        Fully paid
                      </span>
                    )}
                  </div>
                </div>

                {/* Existing payments list */}
                {order.payments.length > 0 && (
                  <div className="divide-y divide-border border border-border rounded-md">
                    {order.payments.map((p) => (
                      <div
                        key={p._id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium tabular-nums">
                              {formatCurrency(p.amount)}
                            </span>
                            <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                              {p.method}
                            </span>
                            {p.payer_name && (
                              <span className="text-xs text-muted-foreground truncate">
                                {p.payer_name}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDateTime(p.paid_at)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleRemovePayment(p._id)}
                          className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                          title="Remove payment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add payment form */}
                {order.balance_due > 0 && (
                  <form
                    onSubmit={handleAddPayment}
                    className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                  >
                    <div className="sm:col-span-3">
                      <label className="text-xs text-muted-foreground block mb-1">
                        Amount (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={payAmount}
                        onChange={(e) => {
                          setPayAmount(e.target.value);
                          setHasEditedAmount(true);
                        }}
                        placeholder={order.balance_due.toFixed(2)}
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring text-right"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-xs text-muted-foreground block mb-1">
                        Method
                      </label>
                      <select
                        value={payMethod}
                        onChange={(e) =>
                          setPayMethod(e.target.value as PaymentMethod)
                        }
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring capitalize"
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-xs text-muted-foreground block mb-1">
                        Payer (optional)
                      </label>
                      <input
                        value={payerName}
                        onChange={(e) => setPayerName(e.target.value)}
                        placeholder="e.g. Anu"
                        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={paying}
                        className="w-full px-3 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
                      >
                        {paying ? "…" : "Add Payment"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Cancel order shortcut when waiting on payments */}
                {order.status === "served" && (
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleStatus("cancelled")}
                      className="text-xs text-muted-foreground hover:text-destructive"
                    >
                      Cancel order
                    </button>
                  </div>
                )}
              </div>
            )}

        </div>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

interface BillRowProps {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}

function BillRow({ label, value, muted, bold }: BillRowProps) {
  return (
    <div
      className={cn(
        "flex justify-between",
        muted && "text-muted-foreground",
        bold && "font-semibold"
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
