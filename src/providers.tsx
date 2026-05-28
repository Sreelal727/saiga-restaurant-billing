"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { SessionProvider, SessionGate } from "@/components/auth/session-context";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
const convex = new ConvexReactClient(url);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
        <SessionProvider>
          <SessionGate>{children}</SessionGate>
        </SessionProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </ConvexProvider>
  );
}
