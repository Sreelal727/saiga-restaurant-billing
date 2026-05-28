"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Header } from "@/components/layout/header";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Phone, Mail, MapPin, FileText } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  confirmed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  preparing: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  ready: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  served: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  paid: "bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const customer = useQuery(api.customers.get, {
    id: id as Id<"restaurant_customers">,
  });

  if (customer === undefined) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <Header title="Customer" />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      </div>
    );
  }

  if (customer === null) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <Header title="Customer" />
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Customer not found
        </div>
      </div>
    );
  }

  const back = (
    <Link
      href="/customers"
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> Customers
    </Link>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title={customer.name} action={back} />
      <div className="flex-1 p-6 max-w-3xl mx-auto w-full space-y-4">

        {/* Profile */}
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{customer.phone}</span>
            </div>
            {customer.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{customer.email}</span>
              </div>
            )}
            {customer.default_address && (
              <div className="sm:col-span-2 flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                <span>{customer.default_address}</span>
              </div>
            )}
            {customer.notes && (
              <div className="sm:col-span-2 text-muted-foreground italic">
                {customer.notes}
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-4">
          <Stat label="Orders" value={String(customer.order_count)} />
          <Stat
            label="Paid orders"
            value={String(customer.paid_order_count)}
          />
          <Stat
            label="Total spent"
            value={formatCurrency(customer.total_spent)}
            highlight
          />
        </div>

        {/* Order history */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">
              Order History ({customer.orders.length})
            </h3>
          </div>
          {customer.orders.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No orders yet
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Order #
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {customer.orders.map((o) => (
                  <tr key={o._id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/orders/${o._id}`}
                        className="font-medium hover:text-primary"
                      >
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">
                      {o.order_type.replace("_", " ")}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(o._creationTime)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                          STATUS_STYLE[o.status] ?? ""
                        )}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {formatCurrency(o.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          highlight && "text-primary"
        )}
      >
        {value}
      </p>
    </div>
  );
}
