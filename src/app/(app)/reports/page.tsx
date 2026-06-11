"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Download, FileText } from "lucide-react";

// Re-renders every 60s so range presets whose upper bound is "now" advance.
function useMinuteTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

// ─── Date range helpers ───────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "this_month", label: "This Month" },
] as const;

type Preset = (typeof PRESETS)[number]["key"];

function getRange(preset: Preset): { from: number; to: number } {
  const now = new Date();
  switch (preset) {
    case "today": {
      return { from: startOfDay(now).getTime(), to: Date.now() };
    }
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const start = startOfDay(d);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { from: start.getTime(), to: end.getTime() };
    }
    case "this_week": {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      return { from: startOfDay(d).getTime(), to: Date.now() };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start.getTime(), to: Date.now() };
    }
  }
}

// ─── Components ───────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  highlight?: boolean;
  sub?: string;
}

function SummaryCard({ label, value, highlight, sub }: SummaryCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", highlight && "text-primary")}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>("today");
  // Re-derive the range on a clock tick so "Today" / "This Week" / "This Month"
  // include orders paid since the page was opened. Pinned to the minute so
  // useQuery doesn't churn on every render. `tickMinute` is intentionally a
  // dependency even though getRange doesn't read it — the whole point is to
  // force re-execution.
  const tickMinute = useMinuteTick();
  const range = useMemo(
    () => getRange(preset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, tickMinute]
  );

  const report = useQuery(api.reports.gstReport, range);

  function downloadCSV(): void {
    if (!report) return;
    const headers = [
      "Order #",
      "Type",
      "Paid At",
      "Payment",
      "Subtotal",
      "Discount",
      `CGST`,
      `SGST`,
      "Total",
    ];
    const rows = report.orders.map((o) => [
      o.order_number,
      o.order_type.replace("_", " "),
      o.paid_at ? new Date(o.paid_at).toLocaleString("en-IN") : "",
      o.payment_method ?? "",
      o.subtotal.toFixed(2),
      o.discount_amount.toFixed(2),
      o.cgst_amount.toFixed(2),
      o.sgst_amount.toFixed(2),
      o.total.toFixed(2),
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `gst-report-${preset}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const exportBtn =
    report && report.total_orders > 0 ? (
      <button
        onClick={downloadCSV}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 transition-colors"
      >
        <Download className="h-4 w-4" />
        Export CSV
      </button>
    ) : undefined;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="GST Report" action={exportBtn} />

      <div className="flex-1 p-6 space-y-6">
        {/* Preset selector */}
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                preset === key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {report === undefined ? (
          <div className="text-center text-muted-foreground text-sm py-16">Loading…</div>
        ) : (
          <>
            {/* KPI summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <SummaryCard
                label="Total Orders"
                value={String(report.total_orders)}
                sub="Paid orders"
              />
              <SummaryCard
                label="Gross Revenue"
                value={formatCurrency(report.total_revenue)}
                highlight
              />
              <SummaryCard label="CGST Collected" value={formatCurrency(report.total_cgst)} />
              <SummaryCard label="SGST Collected" value={formatCurrency(report.total_sgst)} />
              <SummaryCard label="Total Tax" value={formatCurrency(report.total_tax)} />
              <SummaryCard label="Net Subtotal" value={formatCurrency(report.total_subtotal)} />
              <SummaryCard label="Total Discounts" value={formatCurrency(report.total_discount)} />
            </div>

            {/* Payment method breakdown */}
            {Object.keys(report.payment_breakdown).length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="font-medium text-sm mb-3">Payment Method Breakdown</h3>
                <div className="grid grid-cols-3 gap-4">
                  {Object.entries(report.payment_breakdown).map(([method, data]) => (
                    <div
                      key={method}
                      className="text-center p-3 bg-secondary/40 rounded-lg"
                    >
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                        {method}
                      </p>
                      <p className="font-semibold tabular-nums">
                        {formatCurrency(data.amount)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {data.count} order{data.count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Orders table */}
            {report.orders.length > 0 ? (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium text-sm">
                    {report.total_orders} Order{report.total_orders !== 1 ? "s" : ""}
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-secondary/40">
                        {[
                          "Order #",
                          "Type",
                          "Paid At",
                          "Payment",
                          "Subtotal",
                          "Discount",
                          "CGST",
                          "SGST",
                          "Total",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {report.orders.map((o) => (
                        <tr key={o._id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium">{o.order_number}</td>
                          <td className="px-4 py-2.5 capitalize text-muted-foreground">
                            {o.order_type.replace("_", " ")}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {o.paid_at ? formatDateTime(o.paid_at) : "—"}
                          </td>
                          <td className="px-4 py-2.5 capitalize text-muted-foreground">
                            {o.payment_method ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">
                            {formatCurrency(o.subtotal)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                            {o.discount_amount > 0
                              ? `−${formatCurrency(o.discount_amount)}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                            {formatCurrency(o.cgst_amount)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                            {formatCurrency(o.sgst_amount)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums font-semibold">
                            {formatCurrency(o.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground text-sm py-16 bg-card border border-border rounded-lg">
                No paid orders in this period
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
