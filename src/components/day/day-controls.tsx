"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { useTenant } from "@/components/outlet/outlet-context";
import { useSession } from "@/components/auth/session-context";
import { formatCurrency, formatDateTime, cn, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import {
  Sunrise,
  Sunset,
  ArrowLeftRight,
  X,
  Wallet,
  PencilLine,
  ReceiptText,
  CircleDot,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

type Summary = NonNullable<FunctionReturnType<typeof api.shifts.summary>>;
type Mode = "open" | "opening" | "handover" | "close";

// ─── Entry: the always-visible status bar ─────────────────────────────────────

/**
 * Cash-drawer day controls. Opens an in-page right sidebar for Open Day /
 * Handover / Close Day. Visible only to the people who handle the drawer
 * (manager, cashier, admin); hidden for waiters and the HQ super-admin.
 *
 * - `variant="bar"` (default): a full status strip for the Dashboard / Quick
 *   Actions pages.
 * - `variant="inline"`: compact toolbar buttons for a header (e.g. next to
 *   "Open Bills" on the new-order screen).
 */
export function DayControls({
  className,
  variant = "bar",
}: {
  className?: string;
  variant?: "bar" | "inline";
}) {
  const tenant = useTenant();
  const { session } = useSession();
  const [mode, setMode] = useState<Mode | null>(null);

  const allowed =
    !!session &&
    !session.is_hq &&
    (session.role === "manager" || session.role === "cashier" || session.is_admin);

  const summary = useQuery(
    api.shifts.summary,
    allowed && tenant.args ? tenant.args : "skip"
  );

  if (!allowed) return null;

  return (
    <>
      {variant === "inline" ? (
        <DayInline summary={summary} onOpenMode={setMode} className={className} />
      ) : (
        <DayBar summary={summary} onOpenMode={setMode} className={className} />
      )}
      {mode && (
        <DayDrawer
          mode={mode}
          summary={summary ?? null}
          defaultName={session?.name ?? ""}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}

// ─── Inline toolbar variant (for headers) ─────────────────────────────────────

function DayInline({
  summary,
  onOpenMode,
  className,
}: {
  summary: Summary | null | undefined;
  onOpenMode: (m: Mode) => void;
  className?: string;
}) {
  // Stay out of the way until we know the day's state.
  if (summary === undefined) return null;

  const btn =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors";

  if (summary === null) {
    return (
      <button
        type="button"
        onClick={() => onOpenMode("open")}
        className={cn(btn, "bg-green-600 text-white hover:bg-green-700", className)}
      >
        <Sunrise className="h-4 w-4" /> Open Day
      </button>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => onOpenMode("handover")}
        className={cn(btn, "bg-secondary text-secondary-foreground hover:bg-secondary/70")}
        title={`On duty: ${summary.session.current_handler_name}`}
      >
        <ArrowLeftRight className="h-4 w-4" /> Handover
      </button>
      <button
        type="button"
        onClick={() => onOpenMode("close")}
        className={cn(
          btn,
          "bg-slate-800 text-white hover:bg-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
        )}
      >
        <Sunset className="h-4 w-4" /> Close Day
      </button>
    </div>
  );
}

function DayBar({
  summary,
  onOpenMode,
  className,
}: {
  summary: Summary | null | undefined;
  onOpenMode: (m: Mode) => void;
  className?: string;
}) {
  // Loading
  if (summary === undefined) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground",
          className
        )}
      >
        Checking day status…
      </div>
    );
  }

  // Day not open yet
  if (summary === null) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/70 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/20 px-4 py-3",
          className
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <CircleDot className="h-4 w-4" />
          Day not started
        </span>
        <span className="text-xs text-amber-700/80 dark:text-amber-300/70">
          Open the day to set the drawer&apos;s opening cash before billing.
        </span>
        <button
          onClick={() => onOpenMode("open")}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          <Sunrise className="h-4 w-4" /> Open Day
        </button>
      </div>
    );
  }

  // Day open
  const s = summary.session;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-card px-4 py-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Day open</p>
          <p className="text-xs text-muted-foreground">
            {s.current_handler_name} on duty · since {formatDateTime(s.opened_at)}
          </p>
        </div>
      </div>

      <button
        onClick={() => onOpenMode("opening")}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent transition-colors"
        title="View / correct opening balance"
      >
        <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
        Opening {formatCurrency(s.opening_balance)}
        <PencilLine className="h-3 w-3 text-muted-foreground" />
      </button>

      <div className="hidden sm:flex items-center gap-4 text-xs">
        <Metric label="Cash in drawer" value={formatCurrency(summary.expected_cash)} />
        <Metric
          label="Open bills"
          value={
            summary.open_bills.length === 0
              ? "None"
              : `${summary.open_bills.length} · ${formatCurrency(summary.open_bills_total)}`
          }
          warn={summary.open_bills.length > 0}
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onOpenMode("handover")}
          className="flex items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-secondary/70 transition-colors"
        >
          <ArrowLeftRight className="h-4 w-4" /> Handover
        </button>
        <button
          onClick={() => onOpenMode("close")}
          className="flex items-center gap-1.5 rounded-md bg-slate-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-900 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white transition-colors"
        >
          <Sunset className="h-4 w-4" /> Close Day
        </button>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="leading-tight">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("font-semibold tabular-nums", warn && "text-amber-600 dark:text-amber-400")}>
        {value}
      </p>
    </div>
  );
}

// ─── Drawer shell ─────────────────────────────────────────────────────────────

const TITLES: Record<Mode, string> = {
  open: "Open Day",
  opening: "Opening Balance",
  handover: "Handover",
  close: "Close Day",
};

function DayDrawer({
  mode,
  summary,
  defaultName,
  onClose,
}: {
  mode: Mode;
  summary: Summary | null;
  defaultName: string;
  onClose: () => void;
}) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl"
        role="dialog"
        aria-label={TITLES[mode]}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">{TITLES[mode]}</p>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {mode === "open" && <OpenDayPanel defaultName={defaultName} onDone={onClose} />}
          {mode === "opening" && summary && (
            <OpeningBalancePanel summary={summary} defaultName={defaultName} onDone={onClose} />
          )}
          {mode === "handover" && summary && (
            <HandoverPanel summary={summary} onDone={onClose} />
          )}
          {mode === "close" && summary && (
            <CloseDayPanel summary={summary} defaultName={defaultName} onDone={onClose} />
          )}
        </div>
      </aside>
    </>
  );
}

// ─── Shared field bits ────────────────────────────────────────────────────────

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function MoneyInput({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ₹
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.5"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputCls, "pl-7 text-right tabular-nums")}
      />
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "muted" | "warn" | "ok";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={cn(tone === "muted" && "text-muted-foreground")}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          strong && "font-semibold",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "ok" && "text-green-600 dark:text-green-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">{children}</div>
  );
}

// ─── Open Day ─────────────────────────────────────────────────────────────────

function OpenDayPanel({
  defaultName,
  onDone,
}: {
  defaultName: string;
  onDone: () => void;
}) {
  const tenant = useTenant();
  const info = useQuery(api.shifts.openInfo, tenant.args ?? "skip");
  const openDay = useMutation(api.shifts.openDay);

  const [name, setName] = useState(defaultName);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // Prefill the opening cash with the carry-in from the last close, until the
  // user edits it.
  useEffect(() => {
    if (info && !touched) setAmount(String(info.suggested_opening));
  }, [info, touched]);

  const suggested = info?.suggested_opening ?? 0;
  const parsed = Number(amount);
  const differs = Number.isFinite(parsed) && Math.round(parsed * 100) !== Math.round(suggested * 100);

  async function submit() {
    if (!tenant.args) return;
    if (!name.trim()) return toast.error("Enter your name");
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Enter a valid opening balance");
    setBusy(true);
    try {
      await openDay({
        ...tenant.args,
        opened_by_name: name.trim(),
        opening_balance: parsed,
      });
      toast.success("Day opened");
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <SummaryRow
          label="Carried in from last close"
          value={info ? formatCurrency(suggested) : "…"}
          tone="muted"
        />
        {info?.last_closed_at && (
          <p className="text-[11px] text-muted-foreground">
            Last closed {formatDateTime(info.last_closed_at)}
          </p>
        )}
      </Card>

      <Field label="Opened by" hint="The person starting the day.">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={inputCls}
        />
      </Field>

      <Field
        label="Opening cash in drawer"
        hint={
          differs
            ? "Differs from the carried-in amount — this will be logged as a correction."
            : "Count the drawer and confirm the opening cash."
        }
      >
        <MoneyInput
          value={amount}
          onChange={(v) => {
            setTouched(true);
            setAmount(v);
          }}
          autoFocus
        />
      </Field>

      <button
        onClick={submit}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        <Sunrise className="h-4 w-4" />
        {busy ? "Opening…" : "Open Day"}
      </button>
    </div>
  );
}

// ─── Opening Balance (view + correct) ─────────────────────────────────────────

function OpeningBalancePanel({
  summary,
  defaultName,
  onDone,
}: {
  summary: Summary;
  defaultName: string;
  onDone: () => void;
}) {
  const tenant = useTenant();
  const correct = useMutation(api.shifts.correctOpeningBalance);
  const s = summary.session;

  const [amount, setAmount] = useState(String(s.opening_balance));
  const [note, setNote] = useState("");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!tenant.args) return;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Enter a valid amount");
    if (!name.trim()) return toast.error("Enter who is correcting this");
    setBusy(true);
    try {
      await correct({
        ...tenant.args,
        amount: parsed,
        note: note.trim() || undefined,
        by_name: name.trim(),
      });
      toast.success("Opening balance corrected");
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const history = [...s.opening_corrections].reverse();

  return (
    <div className="space-y-4">
      <Card>
        <SummaryRow label="Current opening balance" value={formatCurrency(s.opening_balance)} strong />
        <SummaryRow
          label="Carried in at open"
          value={formatCurrency(s.suggested_opening)}
          tone="muted"
        />
        <SummaryRow label="Opened by" value={s.opened_by_name} tone="muted" />
      </Card>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Correct opening balance</p>
        <Field label="Corrected amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Reason (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. miscounted ₹500 note"
            className={inputCls}
          />
        </Field>
        <Field label="Corrected by">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <button
          onClick={submit}
          disabled={busy}
          className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save correction"}
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Correction history
        </p>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No corrections yet.</p>
        ) : (
          <ul className="space-y-2">
            {history.map((c, i) => (
              <li key={i} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="tabular-nums">
                    {formatCurrency(c.previous)} → <b>{formatCurrency(c.amount)}</b>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDateTime(c.at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  by {c.by_name}
                  {c.note ? ` · ${c.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Handover ─────────────────────────────────────────────────────────────────

function HandoverPanel({ summary, onDone }: { summary: Summary; onDone: () => void }) {
  const tenant = useTenant();
  const handover = useMutation(api.shifts.handover);
  const s = summary.session;
  const shift = summary.shift;

  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!tenant.args) return;
    if (!to.trim()) return toast.error("Enter who is taking over");
    setBusy(true);
    try {
      await handover({
        ...tenant.args,
        from_name: s.current_handler_name,
        to_name: to.trim(),
        notes: notes.trim() || undefined,
      });
      toast.success(`Handed over to ${to.trim()}`);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs text-muted-foreground">
          This shift · since {formatDateTime(shift.since)}
        </p>
        <SummaryRow label="Cash collected" value={formatCurrency(shift.cash_collected)} />
        <SummaryRow label="Card" value={formatCurrency(shift.card_collected)} tone="muted" />
        <SummaryRow label="UPI" value={formatCurrency(shift.upi_collected)} tone="muted" />
        {shift.online_collected > 0 && (
          <SummaryRow label="Online" value={formatCurrency(shift.online_collected)} tone="muted" />
        )}
        <div className="border-t border-border pt-1.5">
          <SummaryRow
            label={`Total collected (${shift.orders_count} bill${shift.orders_count === 1 ? "" : "s"})`}
            value={formatCurrency(shift.total_collected)}
            strong
          />
        </div>
      </Card>

      <Card>
        <SummaryRow
          label="Expected cash in drawer"
          value={formatCurrency(summary.expected_cash)}
          strong
        />
        <SummaryRow
          label="Open bills"
          value={
            summary.open_bills.length === 0
              ? "None"
              : `${summary.open_bills.length} · ${formatCurrency(summary.open_bills_total)}`
          }
          tone={summary.open_bills.length > 0 ? "warn" : undefined}
        />
      </Card>

      <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
        Handing over from <b>{s.current_handler_name}</b>
      </div>

      <Field label="Taking over" hint="The next person on duty.">
        <input
          autoFocus
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Name"
          className={inputCls}
        />
      </Field>
      <Field label="Notes (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything to pass on"
          className={inputCls}
        />
      </Field>

      <button
        onClick={submit}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <ArrowLeftRight className="h-4 w-4" />
        {busy ? "Handing over…" : "Confirm handover"}
      </button>

      {summary.handovers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Earlier handovers today
          </p>
          <ul className="space-y-2">
            {summary.handovers.map((h) => (
              <li key={h._id} className="rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>
                    {h.from_name} → <b>{h.to_name}</b>
                  </span>
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(h.at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(h.snapshot.total_collected)} collected
                  {h.notes ? ` · ${h.notes}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Close Day ────────────────────────────────────────────────────────────────

function CloseDayPanel({
  summary,
  defaultName,
  onDone,
}: {
  summary: Summary;
  defaultName: string;
  onDone: () => void;
}) {
  const tenant = useTenant();
  const closeDay = useMutation(api.shifts.closeDay);
  const day = summary.day;
  const s = summary.session;

  const [counted, setCounted] = useState("");
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [carryOver, setCarryOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasOpenBills = summary.open_bills.length > 0;
  const parsed = Number(counted);
  const variance = useMemo(() => {
    if (counted === "" || !Number.isFinite(parsed)) return null;
    return Math.round((parsed - summary.expected_cash) * 100) / 100;
  }, [counted, parsed, summary.expected_cash]);

  const blocked = hasOpenBills && !carryOver;

  async function submit() {
    if (!tenant.args) return;
    if (!Number.isFinite(parsed) || parsed < 0) return toast.error("Enter the counted cash");
    if (!name.trim()) return toast.error("Enter who is closing the day");
    if (blocked) return toast.error("Settle the open bills or tick carry-over");
    setBusy(true);
    try {
      const res = await closeDay({
        ...tenant.args,
        counted_cash: parsed,
        closed_by_name: name.trim(),
        carry_over_open_bills: carryOver,
        notes: notes.trim() || undefined,
      });
      const varTxt =
        res.cash_variance === 0
          ? "drawer balanced"
          : res.cash_variance > 0
            ? `${formatCurrency(res.cash_variance)} over`
            : `${formatCurrency(-res.cash_variance)} short`;
      toast.success(`Day closed · ${varTxt}`);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs text-muted-foreground">
          Today · since {formatDateTime(s.opened_at)}
        </p>
        <SummaryRow label="Opening balance" value={formatCurrency(s.opening_balance)} tone="muted" />
        <SummaryRow label="Cash collected" value={formatCurrency(day.cash_collected)} />
        <SummaryRow label="Card" value={formatCurrency(day.card_collected)} tone="muted" />
        <SummaryRow label="UPI" value={formatCurrency(day.upi_collected)} tone="muted" />
        {day.online_collected > 0 && (
          <SummaryRow label="Online" value={formatCurrency(day.online_collected)} tone="muted" />
        )}
        <div className="border-t border-border pt-1.5">
          <SummaryRow
            label={`Total collected (${day.orders_count} bill${day.orders_count === 1 ? "" : "s"})`}
            value={formatCurrency(day.total_collected)}
            strong
          />
        </div>
      </Card>

      {/* Open bills */}
      <div className="rounded-lg border border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <ReceiptText className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Open bills</p>
          <span className="ml-auto text-xs text-muted-foreground">
            {hasOpenBills
              ? `${summary.open_bills.length} · ${formatCurrency(summary.open_bills_total)}`
              : "None"}
          </span>
        </div>
        {hasOpenBills ? (
          <>
            <ul className="max-h-40 divide-y divide-border overflow-y-auto">
              {summary.open_bills.map((b) => (
                <li key={b._id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {b.order_number}
                    <span className="text-xs text-muted-foreground">
                      {b.table_number ? ` · T${b.table_number}` : ""} · {b.status}
                    </span>
                  </span>
                  <span className="tabular-nums font-medium">{formatCurrency(b.balance_due)}</span>
                </li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-start gap-2 border-t border-border px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={carryOver}
                onChange={(e) => setCarryOver(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Carry these {summary.open_bills.length} bill(s) over to the next day
                <span className="block text-xs text-muted-foreground">
                  They stay open and show up at tomorrow&apos;s Open Day. Otherwise settle them
                  before closing.
                </span>
              </span>
            </label>
          </>
        ) : (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            Everything is settled — nothing to carry over.
          </p>
        )}
      </div>

      {/* Cash reconciliation */}
      <Card>
        <SummaryRow
          label="Expected cash (opening + cash)"
          value={formatCurrency(summary.expected_cash)}
          strong
        />
      </Card>

      <Field label="Counted cash in drawer" hint="Physically count the drawer and enter it.">
        <MoneyInput value={counted} onChange={setCounted} autoFocus />
      </Field>

      {variance !== null && (
        <div
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium",
            variance === 0
              ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
          )}
        >
          {variance === 0
            ? "Drawer balances exactly."
            : variance > 0
              ? `Over by ${formatCurrency(variance)}`
              : `Short by ${formatCurrency(-variance)}`}
        </div>
      )}

      <Field label="Closed by">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Notes (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth recording"
          className={inputCls}
        />
      </Field>

      <button
        onClick={submit}
        disabled={busy || blocked}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-800 py-2.5 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
      >
        <Sunset className="h-4 w-4" />
        {busy ? "Closing…" : "Close Day"}
      </button>
      {blocked && (
        <p className="text-center text-xs text-amber-600 dark:text-amber-400">
          Settle the open bills or tick carry-over to close.
        </p>
      )}
    </div>
  );
}
