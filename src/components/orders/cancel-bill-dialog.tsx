"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useTenant } from "@/components/outlet/outlet-context";
import { getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";

/**
 * Password-gated confirmation for cancelling (voiding) an open bill. The person
 * must re-enter the login password of the account currently signed in — the
 * server re-checks it in `orders.cancelOrder`. Reason is optional but recorded.
 */
export function CancelBillDialog({
  open,
  orderId,
  orderNumber,
  onClose,
  onCancelled,
}: {
  open: boolean;
  orderId: Id<"restaurant_orders"> | null;
  orderNumber: string;
  onClose: () => void;
  onCancelled?: () => void;
}) {
  const tenant = useTenant();
  const cancelOrder = useMutation(api.orders.cancelOrder);

  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the fields each time the dialog opens for a fresh bill.
  useEffect(() => {
    if (open) {
      setPassword("");
      setReason("");
      setBusy(false);
    }
  }, [open, orderId]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !orderId) return null;

  async function submit() {
    if (!tenant.args || !orderId) return;
    if (!password.trim()) {
      toast.error("Enter your login password");
      return;
    }
    setBusy(true);
    try {
      await cancelOrder({
        ...tenant.args,
        id: orderId,
        password,
        reason: reason.trim() || undefined,
      });
      toast.success(`Bill ${orderNumber} cancelled`);
      onCancelled?.();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/40 print:hidden" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Cancel bill"
        className="fixed left-1/2 top-1/2 z-[61] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background shadow-2xl print:hidden"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <p className="text-sm font-semibold">Cancel bill {orderNumber}</p>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">
            This voids the bill and frees its table. It can&apos;t be undone. Enter your
            login password to confirm.
          </p>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Login password</span>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Password / PIN"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reason (optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate bill, customer left"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Keep bill
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-destructive px-3.5 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {busy ? "Cancelling…" : "Cancel bill"}
          </button>
        </div>
      </div>
    </>
  );
}
