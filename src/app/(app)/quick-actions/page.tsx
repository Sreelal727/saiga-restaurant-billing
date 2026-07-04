"use client";

import { Header } from "@/components/layout/header";
import { QuickActionsPanel } from "@/components/quick-actions/quick-actions";
import { DayControls } from "@/components/day/day-controls";

export default function QuickActionsPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      <Header title="Quick Actions" />
      <div className="flex-1 p-6 flex flex-col items-center">
        <div className="w-full max-w-3xl mx-auto pt-6 sm:pt-12">
          <DayControls className="mb-8" />
          <p className="text-base text-muted-foreground text-center mb-8 max-w-xl mx-auto">
            Jump straight into the most common tasks. Pick an action to start a new
            order of that type, manage tables, or open the kitchen display.
          </p>
          <QuickActionsPanel variant="large" showHeading={false} />
        </div>
      </div>
    </div>
  );
}
