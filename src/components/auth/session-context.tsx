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

const STORAGE_KEY = "saiga.session.v1";

export type Role = "manager" | "cashier" | "waiter";

export interface Session {
  staff_id: Id<"restaurant_staff"> | null;
  name: string;
  username: string;
  role: Role;
  is_admin: boolean;
}

interface SessionContextValue {
  session: Session | null;
  signIn: (username: string, secret: string) => Promise<Session | null>;
  signOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const convex = useConvex();
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);

  // On mount, restore from localStorage and revalidate with the server. If
  // the server says the staff record is gone/inactive, drop the session.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (raw) {
          const stored = JSON.parse(raw) as Session;
          const fresh = await convex.query(api.auth.validateSession, {
            staff_id: stored.staff_id,
            is_admin: stored.is_admin,
          });
          if (!cancelled) {
            if (fresh) {
              const next: Session = {
                staff_id: fresh.staff_id,
                name: fresh.name,
                username: fresh.username ?? stored.username,
                role: fresh.role as Role,
                is_admin: fresh.is_admin,
              };
              setSession(next);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } else {
              localStorage.removeItem(STORAGE_KEY);
              setSession(null);
            }
          }
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem(STORAGE_KEY);
          setSession(null);
        }
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
      const result = await convex.query(api.auth.verifyCredentials, {
        username,
        secret,
      });
      if (!result) return null;
      const next: Session = {
        staff_id: result.staff_id,
        name: result.name,
        username: result.username,
        role: result.role as Role,
        is_admin: result.is_admin,
      };
      setSession(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    },
    [convex]
  );

  const signOut = useCallback(() => {
    setSession(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, signIn, signOut }),
    [session, signIn, signOut]
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
