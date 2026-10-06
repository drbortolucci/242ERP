import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/next";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.user.isPlatformAdmin && !s.organizationId) redirect("/plataforma");
  redirect("/app");
}
