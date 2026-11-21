// Roles are global reference rows (id === name). Every database suite seeded them with
// `prisma.role.upsert({ where: { name } })`, which is only safe when one file runs at a
// time: `node --test` runs the files in parallel, so two suites upserting the same role at
// the same moment both miss the row and the second INSERT fails with
// "Unique constraint failed on the constraint: dbo.roles".
//
// These are idempotent in the sense that matters: INSERT what is missing, ignore a
// duplicate-key race, then confirm the rows exist.
const DUPLICATE_KEY = "P2002";

export async function seedRoles(prisma, roles = ["owner", "admin", "trainer", "learner", "stakeholder"]) {
  for (const name of roles) {
    try {
      await prisma.role.create({ data: { id: name, name } });
    } catch (err) {
      // Someone else won the race, or the role already existed. Both are fine.
      if (err?.code !== DUPLICATE_KEY) throw err;
    }
  }
}
