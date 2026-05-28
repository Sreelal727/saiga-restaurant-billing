import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Registers Convex Auth's HTTP endpoints (sign-in/up, sign-out, session, etc.)
auth.addHttpRoutes(http);

export default http;
