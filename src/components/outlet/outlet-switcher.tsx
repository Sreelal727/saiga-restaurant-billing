"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useSession } from "@/components/auth/session-context";
import { useOutlet } from "@/components/outlet/outlet-context";
import { ChefHat, Building2 } from "lucide-react";

/**
 * Shown in the sidebar header.
 *  - Outlet login → the outlet name (read-only).
 *  - HQ / super admin → a dropdown to switch the active outlet (auto-selects the
 *    default outlet on first load so HQ lands somewhere usable).
 */
export function OutletSwitcher() {
  const { session, token } = useSession();
  const { isHq, outletName, selectedOutletId, setSelectedOutletId } = useOutlet();

  const outlets = useQuery(
    api.outlets.listForHq,
    isHq && token ? { token } : "skip"
  );

  // HQ: default to the first (default) outlet once the list loads.
  useEffect(() => {
    if (isHq && !selectedOutletId && outlets && outlets.length > 0) {
      setSelectedOutletId(outlets[0]._id);
    }
  }, [isHq, selectedOutletId, outlets, setSelectedOutletId]);

  if (!session) {
    return (
      <div className="flex items-center gap-2">
        <ChefHat className="h-6 w-6 text-primary" />
        <span className="font-semibold text-sm leading-tight">JABAL MANDI</span>
      </div>
    );
  }

  if (isHq) {
    return (
      <div className="flex items-center gap-2 w-full">
        <Building2 className="h-5 w-5 text-primary shrink-0" />
        <select
          value={selectedOutletId ?? ""}
          onChange={(e) => setSelectedOutletId(e.target.value as Id<"outlets">)}
          className="flex-1 min-w-0 bg-sidebar-accent text-sidebar-foreground text-sm rounded-md px-2 py-1 border border-sidebar-border focus:outline-none"
          aria-label="Switch outlet"
        >
          {!outlets && <option value="">Loading…</option>}
          {outlets?.map((o) => (
            <option key={o._id} value={o._id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <ChefHat className="h-6 w-6 text-primary shrink-0" />
      <span className="font-semibold text-sm leading-tight truncate">
        {outletName ?? "Outlet"}
      </span>
    </div>
  );
}
