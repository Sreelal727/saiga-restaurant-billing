// Pure helpers for the menu CSV importer — no React / Convex deps so they can be
// unit-tested in isolation. The import dialog wires these to papaparse + the
// `menu.bulkImport` mutation.

export interface CsvVariant {
  label: string;
  price: number;
  unit_factor?: number;
}

// The canonical fields a CSV column can map to.
export const IMPORT_FIELDS = [
  "category",
  "name",
  "description",
  "price",
  "variants",
  "open_price",
  "is_veg",
  "track_inventory",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const REQUIRED_FIELDS: ImportField[] = ["category", "name"];

// field -> CSV header (or null when unmapped)
export type ColumnMapping = Record<ImportField, string | null>;

export interface NormalizedRow {
  category: string;
  name: string;
  description?: string;
  price?: number;
  variants?: CsvVariant[];
  open_price: boolean;
  is_veg: boolean;
  has_inventory: boolean;
  errors: string[];
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** "yes"/"y"/"true"/"1"/"veg" → true; everything else (incl. blank) → false. */
export function parseBool(cell: string | undefined): boolean {
  const v = (cell ?? "").trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1" || v === "veg";
}

/** Parse a number cell; blank → undefined; invalid → NaN (caller validates). */
export function parseNum(cell: string | undefined): number | undefined {
  const v = (cell ?? "").trim();
  if (v === "") return undefined;
  return Number(v.replace(/[₹,\s]/g, ""));
}

/**
 * Parse a variants cell: "Quarter:280:0.25 | Half:560:0.5 | Full:1100".
 * Each part is label:price[:stock_factor]. Returns [] for a blank cell.
 * Throws on a malformed part so the row can be flagged.
 */
export function parseVariants(cell: string | undefined): CsvVariant[] {
  const raw = (cell ?? "").trim();
  if (raw === "") return [];
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const bits = part.split(":").map((b) => b.trim());
      const [label, priceStr, factorStr] = bits;
      if (!label) throw new Error(`Portion needs a label in "${part}"`);
      const price = Number(priceStr);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Bad portion price in "${part}"`);
      }
      const variant: CsvVariant = { label, price };
      if (factorStr !== undefined && factorStr !== "") {
        const factor = Number(factorStr);
        if (!Number.isFinite(factor) || factor <= 0) {
          throw new Error(`Bad stock factor in "${part}"`);
        }
        variant.unit_factor = factor;
      }
      return variant;
    });
}

// ─── Column auto-mapping ────────────────────────────────────────────────────

// Header synonyms → canonical field.
const HEADER_ALIASES: Record<string, ImportField> = {
  category: "category",
  categories: "category",
  cat: "category",
  group: "category",
  name: "name",
  item: "name",
  itemname: "name",
  "item name": "name",
  dish: "name",
  description: "description",
  desc: "description",
  details: "description",
  price: "price",
  rate: "price",
  amount: "price",
  mrp: "price",
  variants: "variants",
  variant: "variants",
  portions: "variants",
  sizes: "variants",
  size: "variants",
  open_price: "open_price",
  "open price": "open_price",
  openprice: "open_price",
  asize: "open_price",
  "as per size": "open_price",
  market: "open_price",
  is_veg: "is_veg",
  "is veg": "is_veg",
  veg: "is_veg",
  vegetarian: "is_veg",
  track_inventory: "track_inventory",
  "track inventory": "track_inventory",
  inventory: "track_inventory",
  stock: "track_inventory",
  "track stock": "track_inventory",
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Best-guess mapping from CSV headers to canonical fields. */
export function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping = Object.fromEntries(
    IMPORT_FIELDS.map((f) => [f, null])
  ) as ColumnMapping;
  for (const header of headers) {
    const key = normHeader(header);
    // exact alias (with underscores collapsed) or spaced alias
    const field =
      HEADER_ALIASES[key] ?? HEADER_ALIASES[key.replace(/\s+/g, "_")];
    if (field && !mapping[field]) mapping[field] = header;
  }
  return mapping;
}

// ─── Row normalization ──────────────────────────────────────────────────────

function cell(raw: Record<string, string>, header: string | null): string {
  return header ? (raw[header] ?? "") : "";
}

/** Turn one raw CSV record into a typed row + validation errors. */
export function normalizeRow(
  raw: Record<string, string>,
  mapping: ColumnMapping
): NormalizedRow {
  const errors: string[] = [];

  const category = cell(raw, mapping.category).trim();
  const name = cell(raw, mapping.name).trim();
  const description = cell(raw, mapping.description).trim() || undefined;
  const open_price = parseBool(cell(raw, mapping.open_price));
  const is_veg = parseBool(cell(raw, mapping.is_veg));
  const has_inventory = parseBool(cell(raw, mapping.track_inventory));

  if (!name) errors.push("Missing name");
  if (!category) errors.push("Missing category");

  let variants: CsvVariant[] | undefined;
  try {
    const parsed = parseVariants(cell(raw, mapping.variants));
    variants = parsed.length > 0 ? parsed : undefined;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Bad variants");
  }

  const price = parseNum(cell(raw, mapping.price));
  if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
    errors.push("Bad price");
  }

  // Pricing rule: portioned (variants) OR single (price>0) OR as-per-size.
  if (!open_price && !variants && !(price !== undefined && price > 0)) {
    errors.push("No price (set price, variants, or open_price)");
  }

  return {
    category,
    name,
    description,
    price,
    variants,
    open_price,
    is_veg,
    has_inventory,
    errors,
  };
}

// ─── Template ────────────────────────────────────────────────────────────────

export function buildTemplateCsv(): string {
  const header =
    "category,name,description,price,variants,open_price,is_veg,track_inventory";
  const rows = [
    "Mandi,Beef Ribs Mandi,Tender slow-cooked beef,,Quarter:280:0.25|Half:560:0.5|Full:1100,no,no,yes",
    "Drinks,Water Bottle,,20,,no,yes,no",
    "Drinks,Fresh Juice,Seasonal fruit,,,yes,yes,no",
    "Starters,Chicken Wings,6 pieces,180,,no,no,yes",
  ];
  return [header, ...rows].join("\n") + "\n";
}
