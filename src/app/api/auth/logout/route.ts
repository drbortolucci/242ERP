import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logout } from "@/modules/auth/service";
import { SESSION_COOKIE } from "@/server/auth/next";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
