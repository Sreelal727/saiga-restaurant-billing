"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, type Role } from "@/components/auth/session-context";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ClipboardList,
  BookOpen,
  Package,
  Users,
  Contact,
  CalendarClock,
  Settings,
  ChefHat,
  BarChart3,
  MonitorCheck,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles allowed to see this nav item. Missing = all roles. */
  roles?: ReadonlyArray<Role>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tables", label: "Tables", icon: UtensilsCrossed },
  { href: "/reservations", label: "Reservations", icon: CalendarClock },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/menu", label: "Menu", icon: BookOpen, roles: ["manager", "cashier"] },
  { href: "/inventory", label: "Inventory", icon: Package, roles: ["manager", "cashier"] },
  { href: "/customers", label: "Customers", icon: Contact },
  { href: "/staff", label: "Staff", icon: Users, roles: ["manager"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["manager"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["manager"] },
];

const ROLE_LABEL: Record<Role, string> = {
  manager: "Manager",
  cashier: "Cashier",
  waiter: "Waiter",
};

export function Sidebar() {
  const pathname = usePathname();
  const { session, signOut } = useSession();
  const role = session?.role ?? null;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!role) return false;
    return item.roles.includes(role);
  });

  return (
    <aside className="flex flex-col w-56 shrink-0 h-full bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-sidebar-border">
        <ChefHat className="h-6 w-6 text-primary" />
        <span className="font-semibold text-sm leading-tight">Saiga Restaurant</span>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => {
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

      <div className="px-2 py-2 border-t border-sidebar-border">
        <a
          href="/kitchen"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
        >
          <MonitorCheck className="h-4 w-4 shrink-0" />
          Kitchen Display
          <span className="ml-auto text-xs opacity-50">↗</span>
        </a>
      </div>

      <div className="px-2 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
            <ShieldCheck className="h-3.5 w-3.5 text-sidebar-foreground/70" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {session?.name ?? "Guest"}
            </p>
            <p className="text-xs text-sidebar-foreground/60 truncate">
              {role ? ROLE_LABEL[role] : "No role"}
              {session?.username ? ` · @${session.username}` : ""}
            </p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-1 w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
