"use client";

import { Header } from "@/components/layout/header";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions";

export default function QuickActionsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Quick Actions" />
      <div className="flex-1 p-6">
        <div className="max-w-5xl">
          <p className="text-sm text-muted-foreground mb-6">
            Jump straight into the most common tasks. Pick an action to start a new
            order of that type, manage tables, or open the kitchen display.
          </p>
          <QuickActionsPanel variant="large" showHeading={false} />
        </div>
      </div>
    </div>
  );
}
