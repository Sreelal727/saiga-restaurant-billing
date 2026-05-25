"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

interface HeaderProps {
  title: string;
  action?: React.ReactNode;
}

export function Header({ title, action }: HeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-border bg-card">
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-2">
        {action}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Toggle theme"
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </button>
      </div>
    </header>
  );
}
