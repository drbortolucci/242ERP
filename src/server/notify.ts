import { prisma } from "./db";
import { sendEmail } from "./providers/email";

/** Notificação interna (e e-mail simulado/real conforme ambiente) para usuários da organização. */
export async function notify(orgId: string, userIds: string[], n: { title: string; body?: string; link?: string; email?: boolean }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  await prisma.notification.createMany({ data: ids.map((userId) => ({ organizationId: orgId, userId, title: n.title, body: n.body ?? null, link: n.link ?? null })) });
  if (n.email) {
    const users = await prisma.user.findMany({ where: { id: { in: ids } } });
    for (const u of users) await sendEmail({ to: u.email, subject: n.title, body: `${n.body ?? ""}\n${n.link ? (process.env.APP_URL ?? "") + n.link : ""}`, organizationId: orgId });
  }
}

/** Usuários da organização que possuem determinada permissão (para notificações de aprovação). */
export async function usersWithPermission(orgId: string, perm: string) {
  const roles = await prisma.role.findMany({ where: { organizationId: orgId, permissions: { has: perm } } });
  const ms = await prisma.membership.findMany({ where: { organizationId: orgId, active: true, roleIds: { hasSome: roles.map((r) => r.id) } } });
  return ms.map((m) => m.userId);
}
