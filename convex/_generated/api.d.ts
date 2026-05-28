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
import type * as menu from "../menu.js";
import type * as orders from "../orders.js";
import type * as reports from "../reports.js";
import type * as reservations from "../reservations.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as staff from "../staff.js";
import type * as tables from "../tables.js";
import type * as users from "../users.js";

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
  menu: typeof menu;
  orders: typeof orders;
  reports: typeof reports;
  reservations: typeof reservations;
  seed: typeof seed;
  settings: typeof settings;
  staff: typeof staff;
  tables: typeof tables;
  users: typeof users;
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
