"use client";

import { use } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
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

const PAYMENT_METHODS = ["cash", "card", "upi"] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const order = useQuery(api.orders.get, { id: id as Id<"restaurant_orders"> });
  const updateStatus = useMutation(api.orders.updateStatus);
  const recordPayment = useMutation(api.orders.recordPayment);

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

  async function handlePay(method: (typeof PAYMENT_METHODS)[number]): Promise<void> {
    if (!order) return;
    try {
      await recordPayment({ id: order._id, payment_method: method });
      toast.success("Payment recorded");
    } catch {
      toast.error("Failed to record payment");
    }
  }

  function handlePrint(): void {
    window.print();
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

  const printBtn = (
    <button
      onClick={handlePrint}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/70 transition-colors print:hidden"
    >
      <Printer className="h-4 w-4" />
      Print Bill
    </button>
  );

  return (
    <>
      {/* ── Print-only receipt ── */}
      <div className="hidden print:block text-black bg-white p-6 max-w-xs mx-auto text-sm">
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

          {/* Actions */}
          {order.status !== "paid" && order.status !== "cancelled" && (
            <div className="bg-card border border-border rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium">Actions</p>
              <div className="flex flex-wrap gap-2">
                {order.status === "served" ? (
                  PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      onClick={() => handlePay(m)}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 capitalize"
                    >
                      Pay via {m}
                    </button>
                  ))
                ) : (
                  <>
                    {!["confirmed", "preparing", "ready", "served"].includes(
                      order.status
                    ) && (
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
                  </>
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
