import { Sidebar } from "@/components/layout/sidebar";
import { SessionGate } from "@/components/auth/session-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {children}
        </div>
      </div>
    </SessionGate>
  );
}
