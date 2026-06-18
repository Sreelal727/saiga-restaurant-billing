/**
 * HTTP edge for the Flutter waiter app.
 *
 * All non-login routes require a Bearer token in `Authorization`. The token's
 * SHA-256 hash is matched against the `mobile_sessions` table. On every
 * authenticated call we also nudge `last_used_at` so sessions can be aged
 * out later if we want.
 *
 * Errors come back as `{ error: string }` with the appropriate status; happy
 * paths return shape-matched JSON. CORS is intentionally permissive (single
 * deployment, mobile app talks directly) but locked to JSON content types.
 */

import { httpRouter, GenericActionCtx } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { DataModel, Id, TableNames } from "./_generated/dataModel";

type ActionCtx = GenericActionCtx<DataModel>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

type ResolvedSession = {
  session_id: Id<"mobile_sessions">;
  identity: {
    staff_id: Id<"restaurant_staff"> | null;
    name: string;
    username: string;
    role: "waiter" | "manager" | "cashier";
    is_admin: boolean;
  };
  // Raw bearer token + the session's outlet — used to call outlet-scoped
  // mutations on behalf of the mobile session.
  token: string;
  outlet_id?: Id<"outlets">;
};

/**
 * Resolve the Bearer token on the request. Returns null if missing/invalid;
 * callers should respond with 401 in that case. On success we touch
 * `last_used_at` (fire-and-forget — failure here doesn't break the request).
 */
async function requireSession(
  ctx: ActionCtx,
  request: Request
): Promise<ResolvedSession | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const token_hash = await sha256Hex(token);
  const found = await ctx.runQuery(internal.mobileApi.sessionByHash, { token_hash });
  if (!found) return null;
  ctx.runMutation(internal.mobileApi.touchSession, {
    session_id: found.session._id,
  }).catch(() => {
    /* non-critical */
  });
  return {
    session_id: found.session._id,
    identity: found.identity,
    token,
    outlet_id: found.session.outlet_id,
  };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asId<T extends TableNames>(v: unknown): Id<T> | null {
  return typeof v === "string" && v.length > 0 ? (v as Id<T>) : null;
}

// ─── Route handlers ───────────────────────────────────────────────────────────

const ping = httpAction(async () => {
  return json({ ok: true, service: "saiga-mobile" });
});

const login = httpAction(async (ctx, request) => {
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const username = asString(body.username);
  const secret = asString(body.secret);
  if (!username || !secret) {
    return json({ error: "username and secret are required" }, 400);
  }

  // Throttle by normalized username. A 4-digit PIN has only 10k possible
  // values, so without a brake an attacker can enumerate it in seconds.
  const throttleKey = username.trim().toLowerCase();
  const throttle = await ctx.runMutation(
    internal.mobileApi.consumeLoginAttempt,
    { username: throttleKey }
  );
  if (!throttle.allowed) {
    return json(
      {
        error: `Too many sign-in attempts. Try again in ${throttle.retry_after_seconds}s.`,
      },
      429
    );
  }

  const token = generateRawToken();
  const token_hash = await sha256Hex(token);
  const result = await ctx.runMutation(internal.mobileApi.issueSession, {
    username,
    secret,
    token_hash,
  });
  if (!result) return json({ error: "Invalid credentials" }, 401);
  // Clear the throttle bucket on a confirmed-good login so a successful user
  // doesn't get penalised by their own typos.
  await ctx.runMutation(internal.mobileApi.clearLoginAttempts, {
    username: throttleKey,
  });
  return json({ token, identity: result.identity });
});

const logout = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) {
    const token_hash = await sha256Hex(match[1].trim());
    await ctx.runMutation(internal.mobileApi.revokeSession, { token_hash });
  }
  return json({ ok: true });
});

const me = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  return json({ identity: session.identity });
});

const home = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const data = await ctx.runQuery(internal.mobileApi.home, {});
  return json(data);
});

const menu = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const data = await ctx.runQuery(internal.mobileApi.menu, {});
  return json({ categories: data });
});

const orderDetail = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const url = new URL(request.url);
  const order_id = asId<"restaurant_orders">(url.searchParams.get("order_id"));
  if (!order_id) return json({ error: "order_id is required" }, 400);
  try {
    const detail = await ctx.runQuery(internal.mobileApi.orderDetail, { order_id });
    if (!detail) return json({ error: "Order not found" }, 404);
    return json(detail);
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

const createOrAppend = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const table_id = asId<"restaurant_tables">(body.table_id);
  const items = parseLineItems(body.items);
  if (!table_id) return json({ error: "table_id is required" }, 400);
  if (!items) return json({ error: "items is required (non-empty array)" }, 400);
  try {
    const result = await ctx.runMutation(internal.mobileApi.createOrAppend, {
      table_id,
      waiter_id: session.identity.staff_id,
      items,
    });
    return json(result);
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

const removeItem = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const item_id = asId<"order_items">(body.item_id);
  if (!item_id) return json({ error: "item_id is required" }, 400);
  try {
    await ctx.runMutation(internal.mobileApi.removeUnsentItem, { item_id });
    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

const sendKot = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const order_id = asId<"restaurant_orders">(body.order_id);
  if (!order_id) return json({ error: "order_id is required" }, 400);
  try {
    const result = await ctx.runMutation(internal.mobileApi.sendKot, { order_id });
    return json(result);
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

const setStatus = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const order_id = asId<"restaurant_orders">(body.order_id);
  const status = asString(body.status);
  const allowed = new Set([
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "served",
    "cancelled",
  ]);
  if (!order_id) return json({ error: "order_id is required" }, 400);
  if (!status || !allowed.has(status)) {
    return json({ error: "status is required (allowed: pending|confirmed|preparing|ready|served|cancelled)" }, 400);
  }
  try {
    await ctx.runMutation(internal.mobileApi.updateOrderStatus, {
      order_id,
      status: status as
        | "pending"
        | "confirmed"
        | "preparing"
        | "ready"
        | "served"
        | "cancelled",
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

const ackCall = httpAction(async (ctx, request) => {
  const session = await requireSession(ctx, request);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const table_id = asId<"restaurant_tables">(body.table_id);
  if (!table_id) return json({ error: "table_id is required" }, 400);
  if (!session.outlet_id) {
    return json({ error: "Session is not assigned to an outlet" }, 400);
  }
  try {
    const result = await ctx.runMutation(api.waiterCalls.acknowledgeAllForTable, {
      token: session.token,
      outletId: session.outlet_id,
      table_id,
      acknowledged_by: session.identity.staff_id ?? undefined,
    });
    return json(result);
  } catch (e) {
    return json({ error: errMessage(e) }, 400);
  }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Request failed";
}

function parseLineItems(raw: unknown): Array<{
  menu_item_id: Id<"menu_items">;
  quantity: number;
  notes?: string;
}> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: Array<{
    menu_item_id: Id<"menu_items">;
    quantity: number;
    notes?: string;
  }> = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const obj = r as Record<string, unknown>;
    const menu_item_id = asId<"menu_items">(obj.menu_item_id);
    const quantity =
      typeof obj.quantity === "number" && Number.isFinite(obj.quantity)
        ? obj.quantity
        : null;
    if (!menu_item_id || quantity === null) return null;
    const notes = typeof obj.notes === "string" ? obj.notes : undefined;
    out.push({ menu_item_id, quantity, notes });
  }
  return out;
}

// ─── Router ───────────────────────────────────────────────────────────────────

const http = httpRouter();

const ROUTES: Array<{
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  handler: ReturnType<typeof httpAction>;
}> = [
  { path: "/api/mobile/ping", method: "GET", handler: ping },
  { path: "/api/mobile/login", method: "POST", handler: login },
  { path: "/api/mobile/logout", method: "POST", handler: logout },
  { path: "/api/mobile/me", method: "GET", handler: me },
  { path: "/api/mobile/home", method: "GET", handler: home },
  { path: "/api/mobile/menu", method: "GET", handler: menu },
  { path: "/api/mobile/orders/detail", method: "GET", handler: orderDetail },
  { path: "/api/mobile/orders", method: "POST", handler: createOrAppend },
  { path: "/api/mobile/orders/items/remove", method: "POST", handler: removeItem },
  { path: "/api/mobile/orders/kot", method: "POST", handler: sendKot },
  { path: "/api/mobile/orders/status", method: "POST", handler: setStatus },
  { path: "/api/mobile/calls/ack", method: "POST", handler: ackCall },
];

for (const route of ROUTES) {
  http.route({ path: route.path, method: route.method, handler: route.handler });
  http.route({
    path: route.path,
    method: "OPTIONS",
    handler: httpAction(async () => corsPreflight()),
  });
}

export default http;
