"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, type Role } from "@/components/auth/session-context";
import { OutletSwitcher } from "@/components/outlet/outlet-switcher";
import {
  LayoutDashboard,
  Zap,
  UtensilsCrossed,
  ClipboardList,
  BookOpen,
  Package,
  Users,
  Contact,
  CalendarClock,
  Settings,
  BarChart3,
  MonitorCheck,
  LogOut,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles allowed to see this nav item. Missing = all roles. */
  roles?: ReadonlyArray<Role>;
  /** Only the HQ / super admin sees this item. */
  hqOnly?: boolean;
  /** Hidden for the HQ / super admin (CEO). */
  hideForHq?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/hq", label: "CEO View", icon: Building2, hqOnly: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/quick-actions", label: "Quick Actions", icon: Zap, hideForHq: true },
  { href: "/tables", label: "Tables", icon: UtensilsCrossed },
  { href: "/reservations", label: "Reservations", icon: CalendarClock },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/menu", label: "Menu", icon: BookOpen, roles: ["manager", "cashier"] },
  { href: "/inventory", label: "Inventory", icon: Package, roles: ["manager", "cashier"] },
  { href: "/customers", label: "Customers", icon: Contact, hideForHq: true },
  { href: "/staff", label: "Staff", icon: Users, roles: ["manager"] },
  { href: "/reports", label: "Reports", icon: BarChart3, roles: ["manager"] },
  { href: "/settings", label: "Settings", icon: Settings, roles: ["manager"], hideForHq: true },
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

  const isHq = !!session?.is_hq;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.hqOnly) return isHq;
    if (item.hideForHq && isHq) return false;
    if (!item.roles) return true;
    if (!role) return false;
    return item.roles.includes(role);
  });

  return (
    <>
      {/* Spacer keeps content in place; the real sidebar overlays on hover. */}
      <div className="w-16 shrink-0" aria-hidden />
      <aside className="group fixed inset-y-0 left-0 z-40 flex flex-col w-16 hover:w-56 transition-[width] duration-200 ease-out bg-sidebar text-sidebar-foreground overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-4 py-5 border-b border-sidebar-border">
        <OutletSwitcher />
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
              <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {!isHq && (
        <div className="px-2 py-2 border-t border-sidebar-border">
          <a
            href="/kitchen"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
          >
            <MonitorCheck className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              Kitchen Display
            </span>
            <span className="ml-auto text-xs opacity-0 group-hover:opacity-50 transition-opacity">↗</span>
          </a>
        </div>
      )}

      <div className="px-2 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <div className="h-7 w-7 rounded-full bg-sidebar-accent flex items-center justify-center shrink-0">
            <ShieldCheck className="h-3.5 w-3.5 text-sidebar-foreground/70" />
          </div>
          <div className="flex-1 min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
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
          <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            Sign out
          </span>
        </button>
      </div>
      </aside>
    </>
  );
}
