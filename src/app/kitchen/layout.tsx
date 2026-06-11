import { SessionGate } from "@/components/auth/session-context";

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <SessionGate>{children}</SessionGate>;
}
