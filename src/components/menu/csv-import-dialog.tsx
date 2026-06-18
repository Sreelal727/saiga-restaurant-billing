"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import Papa from "papaparse";
import { api } from "../../../convex/_generated/api";
import { useTenant } from "@/components/outlet/outlet-context";
import { toast } from "sonner";
import { cn, formatCurrency } from "@/lib/utils";
import { X, Upload, Download, FileText } from "lucide-react";
import {
  IMPORT_FIELDS,
  REQUIRED_FIELDS,
  autoMapColumns,
  normalizeRow,
  buildTemplateCsv,
  type ColumnMapping,
  type ImportField,
  type NormalizedRow,
} from "@/lib/menu-csv";

type Step = "upload" | "map" | "preview";
type RowStatus = "new" | "duplicate" | "error";

const FIELD_LABEL: Record<ImportField, string> = {
  category: "Category",
  name: "Name",
  description: "Description",
  price: "Price",
  variants: "Variants (portions)",
  open_price: "As per size",
  is_veg: "Vegetarian",
  track_inventory: "Track inventory",
};

export function CsvImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const tenant = useTenant();
  const existing = useQuery(api.menu.listAdmin, tenant.args ?? "skip");
  const bulkImport = useMutation(api.menu.bulkImport);

  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoMapColumns([]));
  const [dupAction, setDupAction] = useState<Record<number, "skip" | "add">>({});
  const [importing, setImporting] = useState(false);

  function reset() {
    setStep("upload");
    setHeaders([]);
    setRawRows([]);
    setMapping(autoMapColumns([]));
    setDupAction({});
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const hdrs = (res.meta.fields ?? []).filter(Boolean);
        if (hdrs.length === 0) {
          toast.error("No columns found in the CSV");
          return;
        }
        setHeaders(hdrs);
        setRawRows(res.data);
        setMapping(autoMapColumns(hdrs));
        setStep("map");
      },
      error: () => toast.error("Could not read the CSV file"),
    });
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "menu-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // Existing (category|name) keys for duplicate detection.
  const existingKeys = useMemo(() => {
    const set = new Set<string>();
    for (const cat of existing ?? []) {
      for (const item of cat.items) {
        set.add(`${cat.name.trim().toLowerCase()}|${item.name.trim().toLowerCase()}`);
      }
    }
    return set;
  }, [existing]);

  const existingCatNames = useMemo(
    () => new Set((existing ?? []).map((c) => c.name.trim().toLowerCase())),
    [existing]
  );

  // Normalize + classify each row.
  const rows = useMemo(() => {
    if (step !== "preview") return [];
    return rawRows.map((raw) => {
      const norm = normalizeRow(raw, mapping);
      let status: RowStatus = "new";
      if (norm.errors.length > 0) status = "error";
      else if (
        existingKeys.has(
          `${norm.category.trim().toLowerCase()}|${norm.name.trim().toLowerCase()}`
        )
      )
        status = "duplicate";
      return { norm, status };
    });
  }, [step, rawRows, mapping, existingKeys]);

  const newCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.status === "error") continue;
      const key = r.norm.category.trim().toLowerCase();
      if (key && !existingCatNames.has(key)) set.add(r.norm.category.trim());
    }
    return [...set];
  }, [rows, existingCatNames]);

  const counts = useMemo(() => {
    let nw = 0,
      dup = 0,
      err = 0;
    for (const r of rows) {
      if (r.status === "error") err++;
      else if (r.status === "duplicate") dup++;
      else nw++;
    }
    return { nw, dup, err };
  }, [rows]);

  function actionFor(i: number): "skip" | "add" {
    return dupAction[i] ?? "skip";
  }

  function setAllDuplicates(action: "skip" | "add") {
    const next: Record<number, "skip" | "add"> = {};
    rows.forEach((r, i) => {
      if (r.status === "duplicate") next[i] = action;
    });
    setDupAction(next);
  }

  const mappingReady = REQUIRED_FIELDS.every((f) => mapping[f]);

  async function handleImport() {
    if (!tenant.args) {
      toast.error("No outlet selected");
      return;
    }
    const toSend = rows
      .filter(
        (r, i) =>
          r.status === "new" || (r.status === "duplicate" && actionFor(i) === "add")
      )
      .map(({ norm }) => toBulkRow(norm));

    if (toSend.length === 0) {
      toast.error("Nothing to import");
      return;
    }
    setImporting(true);
    try {
      const result = await bulkImport({ ...tenant.args, rows: toSend });
      const parts = [`${result.created_items} item(s) added`];
      if (result.created_categories.length > 0)
        parts.push(`${result.created_categories.length} new categor${result.created_categories.length === 1 ? "y" : "ies"}`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} failed`);
      toast.success(parts.join(" · "));
      if (result.errors.length > 0) {
        toast.error(
          `Skipped: ${result.errors.slice(0, 3).map((e) => e.name).join(", ")}${result.errors.length > 3 ? "…" : ""}`
        );
      }
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Import menu from CSV</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a CSV with your items. Columns can be in any order — you&apos;ll
                map them next. Need the format?
                <button
                  onClick={downloadTemplate}
                  className="ml-1 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download template
                </button>
              </p>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-12 cursor-pointer hover:bg-accent/40 transition-colors">
                <Upload className="h-7 w-7 text-muted-foreground" />
                <span className="text-sm font-medium">Choose a CSV file</span>
                <span className="text-xs text-muted-foreground">
                  category, name, price, variants, open_price, is_veg, track_inventory
                </span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {step === "map" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Map your CSV columns to the menu fields. We&apos;ve guessed where we
                could. <span className="text-foreground font-medium">Category</span> and{" "}
                <span className="text-foreground font-medium">Name</span> are required.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="flex items-center gap-2">
                    <label className="text-sm w-40 shrink-0">
                      {FIELD_LABEL[field]}
                      {REQUIRED_FIELDS.includes(field) && (
                        <span className="text-destructive"> *</span>
                      )}
                    </label>
                    <select
                      value={mapping[field] ?? ""}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [field]: e.target.value || null }))
                      }
                      className="flex-1 px-2 py-1.5 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">— none —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Chip className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  {counts.nw} new
                </Chip>
                {newCategories.length > 0 && (
                  <Chip className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {newCategories.length} new categor{newCategories.length === 1 ? "y" : "ies"}
                  </Chip>
                )}
                <Chip className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
                  {counts.dup} duplicate{counts.dup === 1 ? "" : "s"}
                </Chip>
                {counts.err > 0 && (
                  <Chip className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                    {counts.err} error{counts.err === 1 ? "" : "s"}
                  </Chip>
                )}
                {counts.dup > 0 && (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setAllDuplicates("skip")}
                      className="text-primary hover:underline"
                    >
                      Skip all dupes
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      onClick={() => setAllDuplicates("add")}
                      className="text-primary hover:underline"
                    >
                      Add all dupes
                    </button>
                  </div>
                )}
              </div>

              {/* Rows */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
                  {rows.map((r, i) => (
                    <RowLine
                      key={i}
                      norm={r.norm}
                      status={r.status}
                      action={actionFor(i)}
                      onToggle={() =>
                        setDupAction((d) => ({
                          ...d,
                          [i]: actionFor(i) === "skip" ? "add" : "skip",
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <button
            onClick={step === "upload" ? handleClose : () => setStep(step === "preview" ? "map" : "upload")}
            className="px-4 py-2 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/70 transition-colors"
          >
            {step === "upload" ? "Cancel" : "Back"}
          </button>
          {step === "map" && (
            <button
              onClick={() => {
                setDupAction({});
                setStep("preview");
              }}
              disabled={!mappingReady}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Preview ({rawRows.length} rows)
            </button>
          )}
          {step === "preview" && (
            <button
              onClick={handleImport}
              disabled={importing || existing === undefined}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing
                ? "Importing…"
                : `Import ${counts.nw + Object.values(dupAction).filter((a) => a === "add").length} item(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function toBulkRow(norm: NormalizedRow) {
  return {
    category: norm.category,
    name: norm.name,
    description: norm.description,
    price: norm.price,
    variants: norm.variants,
    open_price: norm.open_price || undefined,
    is_veg: norm.is_veg,
    has_inventory: norm.has_inventory,
  };
}

function priceSummary(norm: NormalizedRow): string {
  if (norm.open_price) return "As per size";
  if (norm.variants && norm.variants.length > 0)
    return norm.variants.map((v) => `${v.label} ${formatCurrency(v.price)}`).join(", ");
  return norm.price !== undefined ? formatCurrency(norm.price) : "—";
}

function RowLine({
  norm,
  status,
  action,
  onToggle,
}: {
  norm: NormalizedRow;
  status: RowStatus;
  action: "skip" | "add";
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 text-sm",
        status === "error" && "bg-red-50 dark:bg-red-900/10",
        status === "duplicate" && action === "skip" && "opacity-60"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{norm.name || "(no name)"}</span>
          <span className="text-xs text-muted-foreground truncate">
            {norm.category || "(no category)"}
          </span>
          {norm.is_veg && (
            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" title="Veg" />
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {status === "error" ? (
            <span className="text-red-600 dark:text-red-400">{norm.errors.join("; ")}</span>
          ) : (
            priceSummary(norm)
          )}
        </div>
      </div>
      {status === "new" && (
        <Chip className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
          New
        </Chip>
      )}
      {status === "error" && (
        <Chip className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
          Error
        </Chip>
      )}
      {status === "duplicate" && (
        <button
          onClick={onToggle}
          className={cn(
            "px-2 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
            action === "add"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
          )}
          title="Toggle add / skip for this duplicate"
        >
          {action === "add" ? "Will add" : "Duplicate — skip"}
        </button>
      )}
    </div>
  );
}

function Chip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium shrink-0",
        className
      )}
    >
      {children}
    </span>
  );
}
