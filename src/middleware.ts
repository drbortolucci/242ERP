import { NextResponse, type NextRequest } from "next/server";

/** Proteção leve por presença do cookie; a validação real da sessão ocorre no servidor (layouts/serviços). */
export function middleware(req: NextRequest) {
  const has = req.cookies.has("erp_session");
  const { pathname } = req.nextUrl;
  const res = has ? NextResponse.next() : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(pathname)}`, req.url));
  res.headers.set("x-correlation-id", crypto.randomUUID());
  return res;
}

export const config = { matcher: ["/app/:path*", "/portal/:path*", "/plataforma/:path*"] };
