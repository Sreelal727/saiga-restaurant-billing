/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as categories from "../categories.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as lib_sha256 from "../lib/sha256.js";
import type * as lib_tenant from "../lib/tenant.js";
import type * as menu from "../menu.js";
import type * as migrations from "../migrations.js";
import type * as mobileApi from "../mobileApi.js";
import type * as orders from "../orders.js";
import type * as outlets from "../outlets.js";
import type * as reports from "../reports.js";
import type * as reservations from "../reservations.js";
import type * as seed from "../seed.js";
import type * as seedE2E from "../seedE2E.js";
import type * as selfOrder from "../selfOrder.js";
import type * as settings from "../settings.js";
import type * as staff from "../staff.js";
import type * as tables from "../tables.js";
import type * as users from "../users.js";
import type * as waiterCalls from "../waiterCalls.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  categories: typeof categories;
  customers: typeof customers;
  dashboard: typeof dashboard;
  http: typeof http;
  inventory: typeof inventory;
  "lib/sha256": typeof lib_sha256;
  "lib/tenant": typeof lib_tenant;
  menu: typeof menu;
  migrations: typeof migrations;
  mobileApi: typeof mobileApi;
  orders: typeof orders;
  outlets: typeof outlets;
  reports: typeof reports;
  reservations: typeof reservations;
  seed: typeof seed;
  seedE2E: typeof seedE2E;
  selfOrder: typeof selfOrder;
  settings: typeof settings;
  staff: typeof staff;
  tables: typeof tables;
  users: typeof users;
  waiterCalls: typeof waiterCalls;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
