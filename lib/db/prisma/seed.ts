import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const adminName = process.env.SEED_ADMIN_NAME ?? "Admin";
const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

if (!process.env.SEED_ADMIN_PASSWORD) {
  console.warn("[seed] SEED_ADMIN_PASSWORD not set — using local-dev default. Set a real password via env.");
}

async function main() {
  const org = await db.organization.upsert({
    where: { id: "org1" },
    create: { id: "org1", name: "Acme", plan: "pro", learnerCount: 1, programmeCount: 1 },
    update: {},
  });

  for (const name of ["owner", "admin", "trainer", "learner", "stakeholder"]) {
    await db.role.upsert({ where: { name }, create: { id: name, name }, update: {} });
  }

  const programme = await db.programme.upsert({
    where: { id: "p1" },
    create: { id: "p1", orgId: org.id, name: "Onboarding", type: "Onboarding", status: "active", learnerCount: 1, courseCount: 1, progress: 0, owner: adminName },
    update: {},
  });

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const user = await db.user.upsert({
    where: { email: adminEmail },
    create: { orgId: org.id, name: adminName, email: adminEmail, passwordHash },
    update: { name: adminName, passwordHash },
  });

  const adminRole = await db.role.findUniqueOrThrow({ where: { name: "admin" } });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    create: { userId: user.id, roleId: adminRole.id, programmeId: programme.id },
    update: {},
  });

  await db.reviewCreditSetting.upsert({
    where: { orgId: org.id },
    create: { orgId: org.id, enabled: 0, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20 },
    update: {},
  });

  console.log(`Seeded admin ${adminEmail} in org ${org.id}`);
}

await main().finally(() => db.$disconnect());
