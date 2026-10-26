import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Origin of the NestJS API (same default as lib/api.ts). Only this origin may be fetched.
function apiOrigin(): string {
  const url = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001";
  try {
    return new URL(url).origin;
  } catch {
    return "http://127.0.0.1:3001";
  }
}

// Content Security Policy: limits what an injected script could load or send,
// which matters because the session token lives in sessionStorage.
// 'unsafe-inline' scripts are required by Next's inline hydration data (no nonce
// middleware yet); 'unsafe-eval' and websockets only in development (React refresh).
function contentSecurityPolicy(): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https://images.unsplash.com"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", apiOrigin(), ...(isProduction ? [] : ["ws:", "wss:"])],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (isProduction) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS on plain http://localhost; it applies once served over HTTPS.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Always revalidate the service worker so updates reach installed apps quickly.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
