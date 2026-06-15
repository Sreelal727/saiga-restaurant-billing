import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/providers";
import { Pwa } from "@/components/pwa/pwa";

export const metadata: Metadata = {
  title: "JABAL MANDI Billing",
  description: "Restaurant billing and POS for modern kitchens",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "JABAL MANDI", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#e2522e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
        <Pwa />
      </body>
    </html>
  );
}
