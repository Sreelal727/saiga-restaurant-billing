"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Id } from "../../../convex/_generated/dataModel";
import { useSession } from "@/components/auth/session-context";

/**
 * The "active outlet" every tenant-scoped Convex call operates on:
 *  - A normal outlet login → its own bound outlet (from the session).
 *  - The HQ super admin → an outlet it explicitly selects (switcher); null
 *    until one is chosen (HQ defaults to consolidated views).
 */
interface OutletContextValue {
  outletId: Id<"outlets"> | null;
  isHq: boolean;
  outletName: string | null;
  selectedOutletId: Id<"outlets"> | null;
  setSelectedOutletId: (id: Id<"outlets"> | null) => void;
}

const OutletContext = createContext<OutletContextValue | null>(null);

export function OutletProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const [selectedOutletId, setSelectedOutletId] = useState<Id<"outlets"> | null>(null);

  const value = useMemo<OutletContextValue>(() => {
    const isHq = !!session?.is_hq;
    const outletId = isHq ? selectedOutletId : session?.outlet_id ?? null;
    return {
      outletId,
      isHq,
      outletName: session?.outlet_name ?? null,
      selectedOutletId,
      setSelectedOutletId,
    };
  }, [session, selectedOutletId]);

  return <OutletContext.Provider value={value}>{children}</OutletContext.Provider>;
}

export function useOutlet(): OutletContextValue {
  const ctx = useContext(OutletContext);
  if (!ctx) throw new Error("useOutlet must be used inside <OutletProvider>");
  return ctx;
}

/**
 * Convenience for tenant-scoped Convex calls. Returns the args object to spread
 * into useQuery/useMutation, or "skip"/null when not ready (no token or no
 * active outlet yet — e.g. HQ hasn't picked an outlet).
 */
export function useTenant(): {
  token: string | null;
  outletId: Id<"outlets"> | null;
  ready: boolean;
  args: { token: string; outletId: Id<"outlets"> } | null;
} {
  const { token } = useSession();
  const { outletId } = useOutlet();
  const ready = !!token && !!outletId;
  return {
    token,
    outletId,
    ready,
    args: ready ? { token: token!, outletId: outletId! } : null,
  };
}
