/** Same-origin writes behind the application's reverse proxy, including public host aliases. */
import type { NextRequest } from "next/server";

export function isValidRequestOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // Authenticated native clients do not send Origin.
  try {
    const supplied = new URL(origin);
    if (!["https:", "http:"].includes(supplied.protocol) || supplied.origin !== origin) return false;
    const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
    if (configured && supplied.origin === new URL(configured).origin) return true;
    // The deployment proxy must overwrite forwarded headers. Host is also browser-controlled
    // by the destination, not by the page initiating a cross-site request.
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto");
    if (host) {
      const protocol = proto ? `${proto}:` : request.nextUrl.protocol;
      if (!["http:", "https:"].includes(protocol)) return false;
      if (supplied.origin === new URL(`${protocol}//${host}`).origin) return true;
      // Apache may preserve the public Host without forwarding the TLS scheme.
      // Next then fills x-forwarded-proto=http from the backend socket. Permit
      // HTTPS on that exact host/port, never a foreign host or an HTTP downgrade.
      return protocol === "http:" && supplied.protocol === "https:" &&
        supplied.origin === new URL(`https://${host}`).origin;
    }
    return supplied.origin === request.nextUrl.origin;
  } catch { return false; }
}
