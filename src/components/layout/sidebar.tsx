"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ClipboardList,
  BookOpen,
  Package,
  Users,
  Settings,
  ChefHat,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tables", label: "Tables", icon: UtensilsCrossed },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/menu", label: "Menu", icon: BookOpen },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-sidebar-border">
        <ChefHat className="h-6 w-6 text-primary" />
        <span className="font-semibold text-sm leading-tight">
          Saiga Restaurant
        </span>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
