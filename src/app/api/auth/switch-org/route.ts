import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { switchOrganization } from "@/modules/auth/service";
import { SESSION_COOKIE } from "@/server/auth/next";

export async function POST(req: Request) {
  const fd = await req.formData();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.redirect(new URL("/login", req.url), 303);
  await switchOrganization(token, String(fd.get("orgId") ?? ""));
  return NextResponse.redirect(new URL("/app", req.url), 303);
}
