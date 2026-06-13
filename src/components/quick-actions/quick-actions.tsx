"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  UtensilsCrossed,
  Package,
  Bike,
  QrCode,
  ChefHat,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ─── Action definitions (single source of truth) ───────────────────────────────

export interface QuickActionDef {
  href: string;
  label: string;
  sub: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon chip background + text. */
  accent: string;
  /** Tailwind ring/border accent used on hover for the large variant. */
  hover: string;
  newTab?: boolean;
}

export const QUICK_ACTIONS: QuickActionDef[] = [
  {
    href: "/orders/new?type=dine_in",
    label: "New Dine-In",
    sub: "Take an order at a table",
    icon: UtensilsCrossed,
    accent: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    hover: "hover:border-orange-400/70 hover:shadow-orange-200/40",
  },
  {
    href: "/orders/new?type=takeaway",
    label: "New Takeaway",
    sub: "Parcel / pickup order",
    icon: Package,
    accent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    hover: "hover:border-blue-400/70 hover:shadow-blue-200/40",
  },
  {
    href: "/orders/new?type=delivery",
    label: "New Delivery",
    sub: "Order with delivery address",
    icon: Bike,
    accent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    hover: "hover:border-green-400/70 hover:shadow-green-200/40",
  },
  {
    href: "/tables",
    label: "Tables & QR",
    sub: "Manage tables, print QR codes",
    icon: QrCode,
    accent: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    hover: "hover:border-purple-400/70 hover:shadow-purple-200/40",
  },
  {
    href: "/kitchen",
    label: "Kitchen Display",
    sub: "Open the KDS in a new tab",
    icon: ChefHat,
    accent: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    hover: "hover:border-red-400/70 hover:shadow-red-200/40",
    newTab: true,
  },
];

// ─── Tile (large + compact) ─────────────────────────────────────────────────────

function ActionTile({ action, variant }: { action: QuickActionDef; variant: "large" | "compact" }) {
  const Icon = action.icon;
  const large = variant === "large";

  const className = cn(
    "group flex items-center rounded-xl border border-border bg-card transition-all",
    "hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    large
      ? cn("gap-4 p-5 hover:-translate-y-0.5 hover:shadow-lg", action.hover)
      : "gap-3 p-3 hover:border-primary/40"
  );

  const inner = (
    <>
      <span
        className={cn(
          "flex items-center justify-center rounded-xl shrink-0 transition-transform group-hover:scale-105",
          action.accent,
          large ? "h-14 w-14" : "h-10 w-10"
        )}
      >
        <Icon className={large ? "h-7 w-7" : "h-5 w-5"} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold truncate", large ? "text-base" : "text-sm")}>
          {action.label}
        </p>
        <p className={cn("text-muted-foreground truncate", large ? "text-sm" : "text-xs")}>
          {action.sub}
        </p>
      </div>
      {large && (
        <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground shrink-0">
          {action.newTab ? "↗" : "→"}
        </span>
      )}
    </>
  );

  if (action.newTab) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={action.href} className={className}>
      {inner}
    </Link>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────────

interface QuickActionsPanelProps {
  /** "large" = dedicated page tiles; "compact" = embedded strip on other pages. */
  variant?: "large" | "compact";
  /** Render the heading row. Defaults to true. */
  showHeading?: boolean;
  title?: string;
  className?: string;
}

export function QuickActionsPanel({
  variant = "compact",
  showHeading = true,
  title = "Quick Actions",
  className,
}: QuickActionsPanelProps) {
  const large = variant === "large";

  const grid = large
    ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
    : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3";

  if (large) {
    return (
      <div className={className}>
        {showHeading && (
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
        )}
        <div className={grid}>
          {QUICK_ACTIONS.map((action) => (
            <ActionTile key={action.href} action={action} variant="large" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("bg-card border border-border rounded-lg p-4", className)}>
      {showHeading && (
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">{title}</h2>
        </div>
      )}
      <div className={grid}>
        {QUICK_ACTIONS.map((action) => (
          <ActionTile key={action.href} action={action} variant="compact" />
        ))}
      </div>
    </div>
  );
}
