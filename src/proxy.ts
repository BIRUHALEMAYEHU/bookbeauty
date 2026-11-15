import { NextResponse, type NextRequest } from "next/server";
import { decideRoute, readHostConfig } from "@/lib/hosts";

/**
 * Sends each request to the address that serves it (D108, D109): public
 * pages on the main domain, the dashboard on the app address, the admin area
 * only on its own address. The rules live in src/lib/hosts.ts. Pages and
 * server actions still check permissions themselves; this is routing, not
 * the security boundary.
 */
export function proxy(request: NextRequest) {
  const decision = decideRoute(
    request.headers.get("host"),
    request.nextUrl.pathname,
    request.nextUrl.search,
    readHostConfig(),
  );

  if (decision.action === "redirect") return NextResponse.redirect(decision.to, 307);
  if (decision.action === "notFound") {
    return new NextResponse("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own files and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)$).*)"],
};
