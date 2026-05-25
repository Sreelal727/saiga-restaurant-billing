import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | undefined, currency = "₹") {
  if (value === undefined) return "—";
  return `${currency}${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDateTime(ts: number | undefined) {
  if (ts === undefined) return "—";
  return new Date(ts).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
