import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/auth-edge";

// Routes that don't require authentication
const publicRoutes = ["/login", "/signup", "/", "/api/auth/signup", "/api/auth/login", "/api/auth/verify", "/api/auth/send-otp", "/api/auth/signup-phone", "/api/auth/send-login-otp", "/api/auth/login-phone", "/api/health"];

// Routes that accept X-API-Key header instead of JWT (backend-to-backend)
const apiKeyRoutes = ["/api/tasks/sync", "/api/automod/review"];

// Routes that require specific roles
const adminRoutes = ["/admin"];
const modRoutes = ["/mod"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (publicRoutes.some((route) => pathname === route || pathname.startsWith(route + "/"))) {
    return NextResponse.next();
  }

  // Allow static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Handle CORS preflight for backend integration routes
  if (apiKeyRoutes.some((route) => pathname === route) && req.method === "OPTIONS") {
    const corsOrigin = process.env.BACKEND_CORS_ORIGIN || "*";
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
      },
    });
  }

  // Allow backend API key auth for specific routes (they validate the key themselves)
  if (apiKeyRoutes.some((route) => pathname === route)) {
    const apiKey = req.headers.get("x-api-key");
    if (apiKey) {
      return NextResponse.next();
    }
  }

  // Check auth token
  const token = req.cookies.get("auth_token")?.value;
  if (!token) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Pages redirect to login
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const payload = await verifyJWT(token);
  if (!payload) {
    // Clear invalid cookie
    const response = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Invalid or expired token" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
    response.cookies.delete("auth_token");
    return response;
  }

  // Role-based route protection
  if (adminRoutes.some((route) => pathname.startsWith(route))) {
    if (payload.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/channels", req.url));
    }
  }

  if (modRoutes.some((route) => pathname.startsWith(route))) {
    if (!["mod", "supermod", "admin"].includes(payload.role)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/channels", req.url));
    }
  }

  // Attach user info to headers for server components
  const response = NextResponse.next();
  response.headers.set("x-user-id", payload.userId);
  response.headers.set("x-user-role", payload.role);
  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
