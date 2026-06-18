"use client";

import { useState } from "react";
import { ChefHat, KeyRound, Loader2, UserRound, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "./session-context";
import { cn } from "@/lib/utils";

type Mode = "select" | "admin" | "staff";

export function LoginScreen() {
  const { signIn } = useSession();
  const [mode, setMode] = useState<Mode>("select");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(usernameValue: string, secret: string) {
    if (busy) return;
    if (!usernameValue.trim() || !secret) {
      toast.error("Fill in both fields");
      return;
    }
    setBusy(true);
    try {
      const session = await signIn(usernameValue, secret);
      if (!session) {
        toast.error("Invalid credentials");
        setBusy(false);
        return;
      }
      toast.success(`Welcome, ${session.name}`);
    } catch {
      toast.error("Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
            <ChefHat className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Saiga Restaurant</h1>
            <p className="text-sm text-muted-foreground">Restaurant billing & POS</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          {mode === "select" && (
            <RoleChooser onPick={setMode} />
          )}

          {mode === "admin" && (
            <AdminForm
              username={username}
              password={password}
              onUsername={setUsername}
              onPassword={setPassword}
              busy={busy}
              onBack={() => setMode("select")}
              onSubmit={(e) => {
                e.preventDefault();
                submit(username, password);
              }}
            />
          )}

          {mode === "staff" && (
            <StaffForm
              username={username}
              pin={pin}
              onUsername={setUsername}
              onPin={setPin}
              busy={busy}
              onBack={() => setMode("select")}
              onSubmit={(e) => {
                e.preventDefault();
                submit(username, pin);
              }}
            />
          )}
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Trouble signing in? Ask the manager to reset your PIN.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function RoleChooser({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-center">Sign in</h2>
      <p className="text-xs text-center text-muted-foreground -mt-1">
        Pick how you would like to sign in
      </p>
      <button
        onClick={() => onPick("admin")}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left group"
      >
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
          <KeyRound className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">Billing</p>
          <p className="text-xs text-muted-foreground">Username and password</p>
        </div>
      </button>
      <button
        onClick={() => onPick("staff")}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left group"
      >
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
          <UserRound className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">Staff</p>
          <p className="text-xs text-muted-foreground">Username and 4-digit PIN</p>
        </div>
      </button>
    </div>
  );
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <button
        type="button"
        onClick={onBack}
        className="p-1 -ml-1 rounded text-muted-foreground hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

function AdminForm(props: {
  username: string;
  password: string;
  onUsername: (s: string) => void;
  onPassword: (s: string) => void;
  busy: boolean;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <BackBar label="Billing sign in" onBack={props.onBack} />
      <Field
        label="Username"
        id="admin-username"
        autoFocus
        autoComplete="username"
        value={props.username}
        onChange={props.onUsername}
        placeholder="Billing"
      />
      <Field
        label="Password"
        id="admin-password"
        type="password"
        autoComplete="current-password"
        value={props.password}
        onChange={props.onPassword}
      />
      <SubmitButton busy={props.busy}>Sign in</SubmitButton>
    </form>
  );
}

function StaffForm(props: {
  username: string;
  pin: string;
  onUsername: (s: string) => void;
  onPin: (s: string) => void;
  busy: boolean;
  onBack: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={props.onSubmit} className="space-y-4">
      <BackBar label="Staff sign in" onBack={props.onBack} />
      <Field
        label="Username"
        id="staff-username"
        autoFocus
        autoComplete="username"
        value={props.username}
        onChange={props.onUsername}
        placeholder="e.g. ravi"
      />
      <div>
        <label
          htmlFor="staff-pin"
          className="text-xs text-muted-foreground block mb-1"
        >
          4-digit PIN
        </label>
        <input
          id="staff-pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          pattern="[0-9]{4}"
          value={props.pin}
          onChange={(e) =>
            props.onPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          className="w-full px-4 py-3 text-lg tabular-nums tracking-[0.4em] text-center rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="••••"
        />
      </div>
      <SubmitButton busy={props.busy}>Sign in</SubmitButton>
    </form>
  );
}

function Field(props: {
  label: string;
  id: string;
  value: string;
  onChange: (s: string) => void;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        htmlFor={props.id}
        className="text-xs text-muted-foreground block mb-1"
      >
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function SubmitButton({
  children,
  busy,
}: {
  children: React.ReactNode;
  busy: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className={cn(
        "w-full py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2",
        busy && "opacity-60 cursor-wait"
      )}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {busy ? "Signing in…" : children}
    </button>
  );
}
