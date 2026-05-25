"use client";

import { use } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// FIX [TS-HIGH-1]: Typed OrderStatus union prevents status: string + as any
type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "served"
  | "paid"
  | "cancelled";

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

  // FIX [TS-HIGH-1]: Use OrderStatus type, no more "as any"
  async function handleStatus(status: OrderStatus) {
    if (!order) return;
    try {
      await updateStatus({ id: order._id, status });
      toast.success(`Order status updated to ${status}`);
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function handlePay(method: (typeof PAYMENT_METHODS)[number]) {
    if (!order) return;
    try {
      await recordPayment({ id: order._id, payment_method: method });
      toast.success("Payment recorded");
    } catch {
      toast.error("Failed to record payment");
    }
  }

  const backLink = (
    <Link href="/orders" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />
      Orders
    </Link>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title={order.order_number} action={backLink} />
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-4">

        {/* Meta */}
        <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
          <InfoRow label="Status">
            <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium capitalize", STATUS_STYLE[order.status])}>
              {order.status}
            </span>
          </InfoRow>
          <InfoRow label="Type">
            <span className="capitalize">{order.order_type.replace("_", " ")}</span>
          </InfoRow>
          {order.table && <InfoRow label="Table">{order.table.table_number}</InfoRow>}
          {order.waiter && <InfoRow label="Waiter">{order.waiter.name}</InfoRow>}
          {order.customer_name && <InfoRow label="Customer">{order.customer_name}</InfoRow>}
          {order.customer_phone && <InfoRow label="Phone">{order.customer_phone}</InfoRow>}
          <InfoRow label="Created">{formatDateTime(order._creationTime)}</InfoRow>
          {order.paid_at && <InfoRow label="Paid At">{formatDateTime(order.paid_at)}</InfoRow>}
        </div>

        {/* Items */}
        <div className="bg-card border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border text-sm font-medium">Items</div>
          <div className="divide-y divide-border">
            {order.items.map((item) => (
              <div key={item._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1">{item.name}</span>
                {item.notes && (
                  <span className="text-xs text-muted-foreground italic">{item.notes}</span>
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
          <BillRow label={`CGST (${order.cgst_rate}%)`} value={formatCurrency(order.cgst_amount)} muted />
          <BillRow label={`SGST (${order.sgst_rate}%)`} value={formatCurrency(order.sgst_amount)} muted />
          {order.tips > 0 && <BillRow label="Tips" value={formatCurrency(order.tips)} muted />}
          {order.packing_charge > 0 && (
            <BillRow label="Packing Charge" value={formatCurrency(order.packing_charge)} muted />
          )}
          {order.delivery_charge > 0 && (
            <BillRow label="Delivery Charge" value={formatCurrency(order.delivery_charge)} muted />
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
                  {["confirmed", "preparing", "ready", "served"].includes(order.status) === false && (
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
                className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-destructive hover:text-white"
              >
                Cancel Order
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

function BillRow({
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
    <div className={cn("flex justify-between", muted && "text-muted-foreground", bold && "font-semibold")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
