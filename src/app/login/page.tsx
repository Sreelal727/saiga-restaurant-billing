"use client";

import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { ChefHat, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      toast.error("Enter a username and password");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", {
        username: username.trim().toLowerCase(),
        password,
        flow: "signIn",
      });
      router.push("/dashboard");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? "Invalid username or password"
          : "Sign-in failed"
      );
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <ChefHat className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold">Saiga Restaurant</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-border rounded-xl p-6 space-y-4"
        >
          <div>
            <label
              htmlFor="username"
              className="text-xs text-muted-foreground block mb-1"
            >
              Username
            </label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. admin"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="text-xs text-muted-foreground block mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-center text-muted-foreground">
          Need a login? Ask a manager to create one for you.
        </p>
      </div>
    </div>
  );
}
