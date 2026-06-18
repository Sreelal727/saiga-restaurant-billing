"use client";

import { useEffect, useRef } from "react";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PrintOrderItem {
  _id: string;
  name: string;
  variant_label?: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface PrintOrder {
  order_number: string;
  order_type: string;
  table?: { table_number: string } | null;
  waiter?: { name: string } | null;
  customer_name?: string;
  paid_at?: number;
  _creationTime: number;
  items: ReadonlyArray<PrintOrderItem>;
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
  payment_method?: string | null;
  notes?: string;
}

export interface PrintSettings {
  restaurant_name?: string;
  address?: string;
  phone?: string;
}

export interface KotPayload {
  batch_number: number;
  items: ReadonlyArray<{
    _id: string;
    name: string;
    variant_label?: string;
    quantity: number;
    notes?: string;
  }>;
}

function lineName(name: string, variant_label?: string | null): string {
  return variant_label ? `${name} (${variant_label})` : name;
}

// ─── PrintArea ──────────────────────────────────────────────────────────────

/**
 * Renders the hidden, print-only receipt (bill or KOT) for one order and fires
 * window.print() whenever `nonce` changes. The global `.print-area` CSS isolates
 * this block so only the receipt reaches the printer. Returns null when idle, so
 * multiple PrintAreas can coexist without double-printing.
 */
export function PrintArea({
  order,
  settings,
  mode,
  width,
  kot,
  nonce,
  onAfterPrint,
}: {
  order: PrintOrder | null | undefined;
  settings: PrintSettings | null | undefined;
  mode: "bill" | "kot";
  width: number;
  kot?: KotPayload | null;
  nonce: number;
  onAfterPrint?: () => void;
}) {
  const afterRef = useRef(onAfterPrint);
  afterRef.current = onAfterPrint;

  useEffect(() => {
    if (!nonce || !order) return;
    const handle = requestAnimationFrame(() => {
      window.print();
      afterRef.current?.();
    });
    return () => cancelAnimationFrame(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (!nonce || !order) return null;

  const style: React.CSSProperties = { width: `${width}mm` };
  const pageCss = `@media print { @page { size: ${width}mm auto; margin: 0; } html, body { margin: 0 !important; padding: 0 !important; } }`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />
      {mode === "kot" ? (
        <KotBlock order={order} kot={kot ?? null} style={style} />
      ) : (
        <BillBlock order={order} settings={settings} style={style} />
      )}
    </>
  );
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

function KotBlock({
  order,
  kot,
  style,
}: {
  order: PrintOrder;
  kot: KotPayload | null;
  style: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn("print-area text-black bg-white p-2 text-sm hidden print:block")}
    >
      <div className="text-center mb-4">
        <p className="font-bold text-base uppercase tracking-wide">Kitchen Order</p>
        {kot && <p className="text-xs text-gray-500">KOT #{kot.batch_number}</p>}
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
      <table className="w-full text-sm mb-2">
        <thead>
          <tr className="text-gray-500 text-xs">
            <th className="text-left font-normal pb-1">Item</th>
            <th className="text-right font-normal pb-1">Qty</th>
          </tr>
        </thead>
        <tbody>
          {kot?.items.map((item) => (
            <tr key={item._id}>
              <td className="py-1">
                <div className="font-semibold">{lineName(item.name, item.variant_label)}</div>
                {item.notes && (
                  <div className="text-xs italic text-gray-600">— {item.notes}</div>
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
  );
}

function BillBlock({
  order,
  settings,
  style,
}: {
  order: PrintOrder;
  settings: PrintSettings | null | undefined;
  style: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn("print-area text-black bg-white p-2 text-sm hidden print:block")}
    >
      <BillBody order={order} settings={settings} />
    </div>
  );
}

/**
 * On-screen receipt preview (paper-like card) — used by the order detail "Bill"
 * view toggle. Same content as the printed bill.
 */
export function BillReceipt({
  order,
  settings,
  className,
}: {
  order: PrintOrder;
  settings: PrintSettings | null | undefined;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white text-black p-4 text-sm rounded-lg border border-gray-200 shadow-sm w-[320px] max-w-full",
        className
      )}
    >
      <BillBody order={order} settings={settings} />
    </div>
  );
}

function BillBody({
  order,
  settings,
}: {
  order: PrintOrder;
  settings: PrintSettings | null | undefined;
}) {
  return (
    <>
      <div className="text-center mb-4">
        <p className="font-bold text-lg">
          {(settings?.restaurant_name ?? "Restaurant").toUpperCase()}
        </p>
        {settings?.address && (
          <p className="text-[10px] text-gray-500 leading-tight">{settings.address}</p>
        )}
        {settings?.phone && <p className="text-[10px] text-gray-500">{settings.phone}</p>}
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
              <td className="py-0.5">{lineName(item.name, item.variant_label)}</td>
              <td className="text-center py-0.5">{item.quantity}</td>
              <td className="text-right py-0.5 tabular-nums">
                {formatCurrency(item.price * item.quantity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-t border-dashed border-gray-400 my-2" />

      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatCurrency(order.subtotal)}</span>
        </div>
        {order.discount_amount > 0 && (
          <div className="flex justify-between text-gray-500">
            <span>Discount</span>
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
    </>
  );
}
