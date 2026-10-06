import { prisma } from "../src/server/db";
import { ensurePlans } from "../src/modules/saas/plans";

async function main() {
  await ensurePlans();
  console.log("Planos garantidos.");
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
