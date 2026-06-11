"use client";

import { useState, use } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  Leaf,
  Drumstick,
  Minus,
  Plus,
  ShoppingBag,
  ChefHat,
  AlertCircle,
  BellRing,
} from "lucide-react";
import { cn, formatCurrency, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

type CartLine = {
  menu_item_id: Id<"menu_items">;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

type CallReason = "service" | "bill" | "water" | "other";

const CALL_REASONS: Array<{ value: CallReason; label: string; emoji: string }> = [
  { value: "service", label: "Need service",   emoji: "🙋" },
  { value: "water",   label: "Water",          emoji: "💧" },
  { value: "bill",    label: "Bring the bill", emoji: "🧾" },
  { value: "other",   label: "Something else", emoji: "💬" },
];

const ORDER_STATUS_COPY: Record<string, { label: string; tone: string }> = {
  pending:   { label: "Waiting for the kitchen",   tone: "text-amber-700 bg-amber-50 border-amber-200" },
  confirmed: { label: "Confirmed — coming up",     tone: "text-blue-700 bg-blue-50 border-blue-200" },
  preparing: { label: "Being prepared",            tone: "text-orange-700 bg-orange-50 border-orange-200" },
  ready:     { label: "Ready to serve",            tone: "text-purple-700 bg-purple-50 border-purple-200" },
  served:    { label: "Enjoy your meal",           tone: "text-emerald-700 bg-emerald-50 border-emerald-200" },
};

export default function CustomerOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const ctx = useQuery(api.selfOrder.getContext, { token });
  const submit = useMutation(api.selfOrder.submit);
  const callWaiter = useMutation(api.selfOrder.callWaiter);

  const [cart, setCart] = useState<Map<Id<"menu_items">, CartLine>>(new Map());
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [vegOnly, setVegOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCall, setShowCall] = useState(false);
  const [calling, setCalling] = useState<CallReason | null>(null);

  // Loading / not-found ───────────────────────────────────────────────────────
  if (ctx === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading menu…
      </div>
    );
  }
  if (ctx === null) {
    return <InvalidTokenScreen />;
  }
  if ("table_reserved" in ctx && ctx.table_reserved) {
    return <ReservedTableScreen />;
  }

  const { table, settings, menu, activeOrder } = ctx;
  const currency = settings.currency;

  const visibleMenu = vegOnly
    ? menu
        .map((cat) => ({ ...cat, items: cat.items.filter((i) => i.is_veg) }))
        .filter((cat) => cat.items.length > 0)
    : menu;

  const cartLines = Array.from(cart.values());
  const cartCount = cartLines.reduce((s, l) => s + l.quantity, 0);
  const cartSubtotal = cartLines.reduce((s, l) => s + l.price * l.quantity, 0);
  const cartCgst = (cartSubtotal * settings.cgst_rate) / 100;
  const cartSgst = (cartSubtotal * settings.sgst_rate) / 100;
  const cartEstimate = cartSubtotal + cartCgst + cartSgst;

  function setQty(item: { _id: Id<"menu_items">; name: string; price: number }, delta: number) {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(item._id);
      const newQty = (existing?.quantity ?? 0) + delta;
      if (newQty <= 0) {
        next.delete(item._id);
      } else {
        next.set(item._id, {
          menu_item_id: item._id,
          name: item.name,
          price: item.price,
          quantity: Math.min(newQty, 20),
          notes: existing?.notes,
        });
      }
      return next;
    });
  }

  function setNotes(menuItemId: Id<"menu_items">, notes: string) {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(menuItemId);
      if (!existing) return prev;
      next.set(menuItemId, { ...existing, notes: notes.slice(0, 100) });
      return next;
    });
  }

  async function handleCallWaiter(reason: CallReason) {
    setCalling(reason);
    try {
      const res = await callWaiter({ token, reason });
      toast.success(
        res.deduplicated
          ? "We've already pinged your waiter — they're on the way."
          : "Waiter notified — they'll be with you shortly."
      );
      setShowCall(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setCalling(null);
    }
  }

  async function handleSubmit() {
    if (cartLines.length === 0) return;
    setSubmitting(true);
    try {
      await submit({
        token,
        items: cartLines.map((l) => ({
          menu_item_id: l.menu_item_id,
          quantity: l.quantity,
          notes: l.notes,
        })),
      });
      toast.success("Order sent — your waiter will confirm shortly");
      setCart(new Map());
      setShowCart(false);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col pb-32">
      {/* Header ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 bg-white border-b border-stone-200">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-stone-500">
              {settings.restaurant_name}
            </p>
            <h1 className="text-lg font-semibold leading-tight truncate">
              Table {table.table_number}
            </h1>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-stone-700 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={vegOnly}
              onChange={(e) => setVegOnly(e.target.checked)}
              className="accent-emerald-600 h-4 w-4"
            />
            Veg only
          </label>
        </div>

        {/* Category chips */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 scrollbar-none">
          {visibleMenu.map((cat) => (
            <a
              key={cat._id}
              href={`#cat-${cat._id}`}
              onClick={() => setActiveCategory(cat._id)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                activeCategory === cat._id
                  ? "bg-stone-900 text-white border-stone-900"
                  : "bg-white text-stone-700 border-stone-200"
              )}
            >
              {cat.name}
            </a>
          ))}
        </div>
      </header>

      {/* Active order banner ──────────────────────────────────────────────── */}
      {activeOrder && (
        <ActiveOrderBanner
          order={activeOrder}
          currency={currency}
        />
      )}

      {/* Menu ─────────────────────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-4 space-y-8">
        {visibleMenu.length === 0 && (
          <p className="text-center text-sm text-stone-500 py-10">
            No items match this filter.
          </p>
        )}
        {visibleMenu.map((cat) => (
          <section key={cat._id} id={`cat-${cat._id}`} className="space-y-3">
            <h2 className="text-sm font-semibold text-stone-900 sticky top-[110px] bg-stone-50 py-1">
              {cat.name}
            </h2>
            <ul className="space-y-3">
              {cat.items.map((item) => {
                const inCart = cart.get(item._id);
                return (
                  <li
                    key={item._id}
                    className="bg-white rounded-xl border border-stone-200 p-3 flex gap-3"
                  >
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt=""
                        className="h-20 w-20 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-lg bg-stone-100 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start gap-1.5">
                        <VegBadge isVeg={item.is_veg} />
                        <h3 className="text-sm font-medium leading-snug">
                          {item.name}
                        </h3>
                      </div>
                      {item.description && (
                        <p className="text-xs text-stone-500 mt-1 line-clamp-2">
                          {item.description}
                        </p>
                      )}
                      <div className="mt-auto pt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatCurrency(item.price, currency)}
                        </span>
                        {inCart ? (
                          <QtyStepper
                            qty={inCart.quantity}
                            onMinus={() => setQty(item, -1)}
                            onPlus={() => setQty(item, 1)}
                          />
                        ) : (
                          <button
                            onClick={() => setQty(item, 1)}
                            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700 active:bg-emerald-800 transition-colors"
                          >
                            Add
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </main>

      {/* Bottom action bar ────────────────────────────────────────────────── */}
      {!showCart && (
        <div className="fixed bottom-4 inset-x-4 z-30 flex items-stretch gap-2">
          <button
            onClick={() => setShowCall(true)}
            className={cn(
              "shrink-0 bg-white text-stone-900 border border-stone-200 rounded-xl px-3 flex items-center justify-center gap-1.5 shadow-lg text-sm font-medium",
              cartCount === 0 && "flex-1"
            )}
            aria-label="Call waiter"
          >
            <BellRing className="h-4 w-4" />
            <span className={cartCount > 0 ? "sr-only sm:not-sr-only" : ""}>
              Call waiter
            </span>
          </button>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="flex-1 bg-stone-900 text-white rounded-xl px-4 py-3 flex items-center justify-between shadow-lg"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <ShoppingBag className="h-4 w-4" />
                {cartCount} item{cartCount !== 1 ? "s" : ""}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCurrency(cartEstimate, currency)} →
              </span>
            </button>
          )}
        </div>
      )}

      {/* Call waiter sheet ────────────────────────────────────────────────── */}
      {showCall && (
        <CallWaiterSheet
          calling={calling}
          onClose={() => setShowCall(false)}
          onPick={handleCallWaiter}
        />
      )}

      {/* Cart sheet ───────────────────────────────────────────────────────── */}
      {showCart && (
        <CartSheet
          lines={cartLines}
          subtotal={cartSubtotal}
          cgst={cartCgst}
          sgst={cartSgst}
          cgstRate={settings.cgst_rate}
          sgstRate={settings.sgst_rate}
          total={cartEstimate}
          currency={currency}
          submitting={submitting}
          onClose={() => setShowCart(false)}
          onSubmit={handleSubmit}
          onQty={(line, delta) =>
            setQty(
              { _id: line.menu_item_id, name: line.name, price: line.price },
              delta
            )
          }
          onNotes={setNotes}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VegBadge({ isVeg }: { isVeg: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 mt-0.5 h-3.5 w-3.5 inline-flex items-center justify-center rounded-sm border",
        isVeg ? "border-emerald-600" : "border-red-600"
      )}
      aria-label={isVeg ? "Vegetarian" : "Non-vegetarian"}
    >
      {isVeg ? (
        <Leaf className="h-2 w-2 text-emerald-600" />
      ) : (
        <Drumstick className="h-2 w-2 text-red-600" />
      )}
    </span>
  );
}

function QtyStepper({
  qty,
  onMinus,
  onPlus,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-md px-1 py-1">
      <button
        onClick={onMinus}
        className="h-6 w-6 rounded flex items-center justify-center text-emerald-700 hover:bg-emerald-100"
        aria-label="Decrease"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="text-xs font-semibold w-4 text-center tabular-nums text-emerald-900">
        {qty}
      </span>
      <button
        onClick={onPlus}
        className="h-6 w-6 rounded flex items-center justify-center text-emerald-700 hover:bg-emerald-100"
        aria-label="Increase"
        disabled={qty >= 20}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ActiveOrderBanner({
  order,
  currency,
}: {
  order: {
    order_number: string;
    status: string;
    total: number;
    items: Array<{
      _id: Id<"order_items">;
      name: string;
      quantity: number;
      sent_to_kitchen: boolean;
    }>;
  };
  currency: string;
}) {
  const copy = ORDER_STATUS_COPY[order.status] ?? {
    label: order.status,
    tone: "text-stone-700 bg-stone-50 border-stone-200",
  };
  const pendingCount = order.items.filter((i) => !i.sent_to_kitchen).length;

  return (
    <div className="px-4 py-3 bg-white border-b border-stone-200">
      <div className={cn("rounded-lg border px-3 py-2.5 flex items-start gap-2.5", copy.tone)}>
        <ChefHat className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">{copy.label}</p>
          <p className="text-xs opacity-80 mt-0.5">
            {order.order_number} ·{" "}
            {order.items.reduce((s, i) => s + i.quantity, 0)} item
            {order.items.length !== 1 ? "s" : ""} ·{" "}
            {formatCurrency(order.total, currency)}
          </p>
          {pendingCount > 0 && (
            <p className="text-xs opacity-80 mt-0.5">
              {pendingCount} item{pendingCount !== 1 ? "s" : ""} waiting for waiter to send to kitchen
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CartSheet({
  lines,
  subtotal,
  cgst,
  sgst,
  cgstRate,
  sgstRate,
  total,
  currency,
  submitting,
  onClose,
  onSubmit,
  onQty,
  onNotes,
}: {
  lines: CartLine[];
  subtotal: number;
  cgst: number;
  sgst: number;
  cgstRate: number;
  sgstRate: number;
  total: number;
  currency: string;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
  onQty: (line: CartLine, delta: number) => void;
  onNotes: (menuItemId: Id<"menu_items">, notes: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold">Your order</h2>
          <button
            onClick={onClose}
            className="text-stone-500 text-sm hover:text-stone-900"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {lines.map((line) => (
            <div
              key={line.menu_item_id}
              className="bg-stone-50 rounded-lg p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{line.name}</p>
                  <p className="text-xs text-stone-500 tabular-nums">
                    {formatCurrency(line.price, currency)} × {line.quantity}
                  </p>
                </div>
                <QtyStepper
                  qty={line.quantity}
                  onMinus={() => onQty(line, -1)}
                  onPlus={() => onQty(line, 1)}
                />
              </div>
              <input
                value={line.notes ?? ""}
                onChange={(e) => onNotes(line.menu_item_id, e.target.value)}
                placeholder="Note for the kitchen (optional)"
                maxLength={100}
                className="w-full bg-white border border-stone-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          ))}
        </div>

        <div className="border-t border-stone-200 p-4 space-y-3 bg-stone-50">
          <div className="text-xs text-stone-600 space-y-1">
            <Row label="Subtotal" value={formatCurrency(subtotal, currency)} />
            {cgstRate > 0 && (
              <Row label={`CGST (${cgstRate}%)`} value={formatCurrency(cgst, currency)} />
            )}
            {sgstRate > 0 && (
              <Row label={`SGST (${sgstRate}%)`} value={formatCurrency(sgst, currency)} />
            )}
            <div className="border-t border-stone-200 my-2" />
            <Row
              label="Estimated total"
              value={formatCurrency(total, currency)}
              strong
            />
          </div>
          <p className="text-[11px] text-stone-500 leading-snug">
            Your waiter will confirm the order and bring the bill at the end of the meal.
          </p>
          <button
            disabled={submitting || lines.length === 0}
            onClick={onSubmit}
            className="w-full bg-stone-900 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send to kitchen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex justify-between tabular-nums", strong && "font-semibold text-stone-900 text-sm")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CallWaiterSheet({
  calling,
  onClose,
  onPick,
}: {
  calling: CallReason | null;
  onClose: () => void;
  onPick: (reason: CallReason) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-white rounded-t-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="font-semibold">Need something?</h2>
          <button
            onClick={onClose}
            className="text-stone-500 text-sm hover:text-stone-900"
          >
            Close
          </button>
        </div>

        <div className="p-4 grid grid-cols-2 gap-2.5">
          {CALL_REASONS.map((r) => {
            const isActive = calling === r.value;
            return (
              <button
                key={r.value}
                disabled={calling !== null}
                onClick={() => onPick(r.value)}
                className={cn(
                  "rounded-xl border py-4 px-3 text-sm font-medium text-stone-900 flex flex-col items-center gap-1 transition-colors",
                  isActive
                    ? "border-stone-900 bg-stone-100"
                    : "border-stone-200 bg-white hover:border-stone-400",
                  calling !== null && !isActive && "opacity-40"
                )}
              >
                <span className="text-2xl leading-none">{r.emoji}</span>
                <span>{isActive ? "Calling…" : r.label}</span>
              </button>
            );
          })}
        </div>

        <p className="px-4 pb-4 text-[11px] text-stone-500 text-center">
          We&apos;ll only ping a waiter — no commitment.
        </p>
      </div>
    </div>
  );
}

function InvalidTokenScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-stone-400 mx-auto" />
        <h1 className="text-lg font-semibold">Table link not recognised</h1>
        <p className="text-sm text-stone-500">
          The QR code on this table looks expired or incorrect. Please ask a
          staff member to help.
        </p>
      </div>
    </div>
  );
}

function ReservedTableScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <AlertCircle className="h-10 w-10 text-stone-400 mx-auto" />
        <h1 className="text-lg font-semibold">This table is reserved</h1>
        <p className="text-sm text-stone-500">
          Please ask a staff member to seat you — they&apos;ll help with the
          right table.
        </p>
      </div>
    </div>
  );
}

