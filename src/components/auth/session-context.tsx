"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { LoginScreen } from "./login-screen";

// Bumped to v2 because the storage shape changed: we now only stash the opaque
// session token, never the identity. The identity is always fetched fresh
// from the server so a tampered localStorage entry can't grant elevated role.
const TOKEN_KEY = "saiga.session.token.v2";
const LEGACY_KEY = "saiga.session.v1";

export type Role = "manager" | "cashier" | "waiter";

export interface Session {
  staff_id: Id<"restaurant_staff"> | null;
  name: string;
  username: string;
  role: Role;
  is_admin: boolean;
  // Multi-tenancy
  outlet_id: Id<"outlets"> | null;
  is_hq: boolean;
  outlet_name: string | null;
}

interface SessionContextValue {
  session: Session | null;
  /** Opaque session token — passed to tenant-scoped Convex calls. */
  token: string | null;
  signIn: (username: string, secret: string) => Promise<Session | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  // Clear the old localStorage entry so an attacker who already set
  // {is_admin: true} can't ride it forward.
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore — storage may be unavailable in some embedded webviews
  }
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const convex = useConvex();
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  // On mount: read the stored token (if any), ask the server for the identity
  // it maps to. If the session was revoked / staff deactivated / token forged,
  // the server returns null and we drop the user back to the login screen.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const stored = readToken();
      if (!stored) {
        if (!cancelled) {
          setSession(null);
          setToken(null);
          setBootstrapped(true);
        }
        return;
      }
      try {
        const identity = await convex.action(api.auth.validateSession, {
          token: stored,
        });
        if (cancelled) return;
        if (identity) {
          setSession({
            staff_id: identity.staff_id,
            name: identity.name,
            username: identity.username,
            role: identity.role as Role,
            is_admin: identity.is_admin,
            outlet_id: identity.outlet_id,
            is_hq: identity.is_hq,
            outlet_name: identity.outlet_name,
          });
          setToken(stored);
        } else {
          writeToken(null);
          setSession(null);
          setToken(null);
        }
      } catch {
        // Network blip — leave the stored token in place and try again next
        // mount. UI stays on the login screen until we can confirm.
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [convex]);

  const signIn = useCallback(
    async (username: string, secret: string) => {
      const result = await convex.action(api.auth.signIn, { username, secret });
      if (!result) return null;
      writeToken(result.token);
      setToken(result.token);
      const next: Session = {
        staff_id: result.identity.staff_id,
        name: result.identity.name,
        username: result.identity.username,
        role: result.identity.role as Role,
        is_admin: result.identity.is_admin,
        outlet_id: result.identity.outlet_id,
        is_hq: result.identity.is_hq,
        outlet_name: result.identity.outlet_name,
      };
      setSession(next);
      return next;
    },
    [convex]
  );

  const signOut = useCallback(async () => {
    const current = readToken();
    writeToken(null);
    setSession(null);
    setToken(null);
    if (current) {
      try {
        await convex.action(api.auth.signOut, { token: current });
      } catch {
        // best-effort; client-side clear is what matters
      }
    }
  }, [convex]);

  const value = useMemo<SessionContextValue>(
    () => ({ session, token, signIn, signOut }),
    [session, token, signIn, signOut]
  );

  return (
    <SessionContext.Provider value={value}>
      {bootstrapped ? children : <BootstrapSplash />}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Renders the login screen until a session exists. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

function BootstrapSplash() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
      Loading…
    </div>
  );
}
