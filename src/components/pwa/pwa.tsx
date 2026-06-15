"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Registers the service worker (production only) and shows a small banner when
 * the device goes offline. Live data syncs automatically via Convex when the
 * connection returns — this is just the "survive short hiccups" UX layer.
 */
export function Pwa() {
  const [offline, setOffline] = useState(false);

  // Register the service worker (skip in dev to avoid stale-cache headaches).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  // Track connectivity.
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] print:hidden">
      <div className="flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-lg">
        <WifiOff className="h-4 w-4" />
        Offline — your changes will sync when you&apos;re back online
      </div>
    </div>
  );
}
