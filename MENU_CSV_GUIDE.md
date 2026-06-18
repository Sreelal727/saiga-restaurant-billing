# Menu CSV Upload — Standard & Rules

How to bulk-add menu items by uploading a CSV on the **Menu** page
(**Upload CSV** button → Upload → Map columns → Preview → Import).

Import is **per outlet**: switch to the right outlet (JABAL MANDI / DHK / Toll)
before importing — items are added only to the currently selected outlet.

---

## 1. Columns

Column **order does not matter** — you map your columns to these fields in the
"Map columns" step. Using these exact header names makes the mapping automatic.

| Column            | Required | Description |
|-------------------|----------|-------------|
| `category`        | **Yes**  | Category name (e.g. `Mandi`, `Drinks`). Created automatically if it doesn't exist. Matched case-insensitively, so `drinks` and `Drinks` are the same category. |
| `name`            | **Yes**  | The item name (e.g. `Beef Ribs Mandi`). |
| `description`     | No       | Short description shown under the item. |
| `price`           | No       | Single fixed price as a number. Used **only** when `variants` is empty and `open_price` is not yes. |
| `variants`        | No       | Portion sizes. Format: `Label:price:stockfactor`, multiple parts separated by a pipe `\|`. Stock factor is optional. |
| `open_price`      | No       | `yes` = "as per size" — no fixed price; the cashier types the price at billing. |
| `is_veg`          | No       | `yes` = vegetarian (green dot), `no` = non-veg. |
| `track_inventory` | No       | `yes` = track stock for this item. Stock starts at 0 (pcs); set actual quantities later in the Inventory page. |

---

## 2. The pricing rule (how each row is classified)

Every item is exactly **one** of three pricing types. A row must match one of
these or it is flagged as an **error** in the preview and not imported:

1. **Portioned item** (Quarter/Half/Full, 2-size, etc.)
   → fill **`variants`**, leave **`price`** empty.

2. **Single fixed-price item**
   → fill **`price`** (greater than 0), leave **`variants`** empty.

3. **As-per-size / open price** (market price, decided at billing)
   → set **`open_price` = yes**. `price` and `variants` are ignored.

Differentiator in short:
- `variants` has a value  → **portioned**
- `variants` empty + `price` filled → **single price**
- `open_price` = yes → **as per size**

---

## 3. Value formats

### Booleans (`open_price`, `is_veg`, `track_inventory`)
Accepted as **true**: `yes`, `y`, `true`, `1` (and `veg` for `is_veg`).
Anything else, including blank, is **false** (`no`).

### Price (`price`)
A plain number. `₹`, commas, and spaces are ignored, so all of these work:
`280`, `1100`, `1,100`, `₹280`.

### Variants (`variants`)
Format: each portion is `Label:price:stockfactor`, and portions are separated
by a pipe `|`. The stock factor is optional.

```
Quarter:280:0.25 | Half:560:0.5 | Full:1100
```

- **Label** — the portion name shown on screen and the bill (e.g. `Quarter`, `Half`, `Full`, `Small`, `Large`).
- **price** — the price for that portion (number).
- **stockfactor** — *optional.* How much inventory one portion consumes
  (e.g. Quarter = `0.25`, Half = `0.5`, Full = `1`). If omitted, it defaults to `1`.

Notes:
- Any number of portions and any labels are allowed (2-size, 3-size, …).
- Each portion label must be unique within the item.
- For a portioned item, leave the `price` column empty — the item's base price is
  automatically set to the lowest portion price.
- Spaces around the `|` and `:` are fine; they are trimmed.

---

## 4. Examples

```csv
category,name,description,price,variants,open_price,is_veg,track_inventory
Mandi,Beef Ribs Mandi,Tender slow-cooked beef,,Quarter:280:0.25|Half:560:0.5|Full:1100,no,no,yes
Drinks,Water Bottle,,20,,no,yes,no
Drinks,Fresh Juice,Seasonal fruit,,,yes,yes,no
Starters,Chicken Wings,6 pieces,180,,no,no,yes
Mandi,Chicken Mandi,,,Half:300:0.5|Full:550,no,no,yes
Desserts,Kunafa,,150,,no,yes,no
```

Row by row:
1. **Beef Ribs Mandi** — 3 portions (Quarter/Half/Full), inventory tracked. Price column empty.
2. **Water Bottle** — single price ₹20, veg, no inventory.
3. **Fresh Juice** — as-per-size (price entered at billing). Price/variants empty.
4. **Chicken Wings** — single price ₹180, inventory tracked.
5. **Chicken Mandi** — 2 portions (Half/Full).
6. **Kunafa** — single price ₹150, veg.

This is the same content as the **Download template** link inside the dialog.

---

## 5. Import behaviour & rules

- **Auto-create categories:** any `category` that doesn't already exist in the
  outlet is created automatically during import.
- **Duplicates:** a row whose `name` already exists in the same `category`
  (case-insensitive) is flagged **Duplicate** in the preview. For each duplicate
  you choose **skip** or **add** (with bulk "Skip all / Add all" options).
  Default is **skip**, so re-uploading the same file won't create copies.
- **Errors:** rows that break the pricing rule, have no name/category, or have a
  malformed `variants` cell are shown as **Error** with the reason and are
  **excluded** from import (the rest still import).
- **Per outlet:** items are created only in the currently selected outlet.
- **Inventory:** `track_inventory = yes` creates a stock record at quantity 0
  (unit "pcs"). Set real quantities afterwards in the Inventory page.
- **Limit:** up to 1000 rows per import.

---

## 6. Not included in the CSV (add these afterwards)

- **Opening stock quantities** — set in the Inventory page after import.
- **Item images** — add per item in the Menu editor.
- **Editing existing items in bulk** — the importer only adds new items
  (duplicates are skip/add, not update). Edit existing items in the Menu editor.

---

## 7. Quick checklist before uploading

- [ ] `category` and `name` filled on every row.
- [ ] Each row is portioned (`variants`) **or** single (`price`) **or** `open_price=yes`.
- [ ] Portioned items have the `price` column empty.
- [ ] `variants` use `Label:price[:stockfactor]` separated by `|`.
- [ ] Booleans are `yes`/`no`.
- [ ] You're on the correct outlet.
