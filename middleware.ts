import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isPublicPage = createRouteMatcher(["/login"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const isPublic = isPublicPage(request);
  const authed = await convexAuth.isAuthenticated();

  if (!isPublic && !authed) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
  if (isPublic && authed) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
});

export const config = {
  // Canonical Convex Auth / Clerk-style matcher. The third entry explicitly
  // routes `/api/*` (incl. `/api/auth`) through middleware so the auth proxy
  // can handle sign-in/out POSTs.
  matcher: [
    "/((?!.+\\.[\\w]+$|_next).*)",
    "/",
    "/(api|trpc)(.*)",
  ],
};
