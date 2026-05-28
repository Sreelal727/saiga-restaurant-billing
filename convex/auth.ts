import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

/**
 * Username-based password authentication.
 *
 * Convex Auth's `Password` provider is designed around email, but we accept
 * any string in the email slot. The client passes a `username` field; we map
 * it to a synthetic "<username>@local" identifier so Convex Auth's uniqueness
 * checks work without storing fake email addresses for staff who don't have
 * one.
 *
 * Display name is set to the raw username so the UI shows e.g. "anu" not
 * "anu@local".
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const username = String(params.username ?? "").trim().toLowerCase();
        if (username.length < 3) {
          throw new Error("Username must be at least 3 characters");
        }
        if (!/^[a-z0-9._-]+$/.test(username)) {
          throw new Error(
            "Username may only contain letters, numbers, '.', '_' or '-'"
          );
        }
        return {
          email: `${username}@local`,
          name: username,
        };
      },
    }),
  ],
});
