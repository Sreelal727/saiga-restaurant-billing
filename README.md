# Saiga Restaurant Billing System

A full-featured multi-tenant restaurant POS and billing system.

## Features

- **Multi-Tenancy** — Each restaurant gets its own isolated data (tenant slug login)
- **Dashboard** — Revenue KPIs, charts, table status, low-stock alerts
- **Table Management** — Visual floor plan, per-floor views, real-time status
- **Order Management** — Dine-in, Parcel Pickup, Parcel Delivery
- **Billing** — CGST, SGST, tips, discounts (% or flat), customized item prices
- **Charges** — Delivery charge, packing charge, parcel charge
- **Waiter Assignment** — Assign staff per order, track orders per waiter
- **Menu Management** — Categories, items, veg/non-veg, availability toggle
- **Inventory Tracking** — Stock levels with low-stock alerts and restock flow
- **Staff Management** — Add/edit waiters, captains, cashiers
- **Payment** — Cash, Card, UPI, Online with tip-on-payment
- **Settings** — GST rates, restaurant info, currency

## Tech Stack

| Layer    | Technology                    |
|----------|-------------------------------|
| Frontend | React 18 + TypeScript + Vite  |
| Styling  | Tailwind CSS                  |
| Charts   | Recharts                      |
| State    | Zustand + React Query         |
| Backend  | Node.js + Express + TypeScript|
| Database | SQLite via Prisma ORM         |
| Auth     | JWT (8h expiry)               |

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

```bash
# 1. Install root dependencies
npm install

# 2. Setup server (installs deps, runs migrations, seeds demo data)
cd server
npm install
npx prisma migrate dev --name init
npx ts-node prisma/seed.ts

# 3. Setup client
cd ../client
npm install
```

### Run

```bash
# From root — runs both server (port 5000) and client (port 5173)
npm run dev

# Or individually:
cd server && npm run dev   # API: http://localhost:5000
cd client && npm run dev   # UI:  http://localhost:5173
```

### Admin credentials

Admin login is gated by the `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment
variables stored in the Convex dashboard. No default password ships with the
code — the deployment must have `ADMIN_PASSWORD` set or admin login is refused.
Staff log in with the username + 4-digit PIN configured on the Staff page.

## Project Structure

```
saiga-restaurant-billing/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma      # Database schema
│   │   └── seed.ts            # Demo data seeder
│   └── src/
│       ├── routes/            # Express route handlers
│       ├── middleware/        # Auth + error handlers
│       └── index.ts           # Server entry point
└── client/
    └── src/
        ├── pages/             # Dashboard, Tables, Orders, etc.
        ├── components/        # Layout, Sidebar, Modal
        ├── api/               # Axios client
        ├── store/             # Zustand auth store
        └── types/             # TypeScript interfaces
```

## API Endpoints

| Method | Endpoint                        | Description           |
|--------|---------------------------------|-----------------------|
| POST   | /api/auth/login                 | Login with tenant slug|
| GET    | /api/dashboard                  | Dashboard stats       |
| GET    | /api/tables                     | All tables            |
| GET    | /api/orders                     | Orders list           |
| POST   | /api/orders                     | Create order          |
| PUT    | /api/orders/:id/payment         | Record payment        |
| GET    | /api/menu/items                 | Menu items            |
| GET    | /api/inventory                  | Inventory levels      |
| GET    | /api/inventory/low-stock        | Low stock alert items |

## Resetting Demo Data

```bash
cd server
npx prisma migrate reset --force
npx ts-node prisma/seed.ts
```
