/** SQL Server unique-index violations (2601/2627) and Prisma's mapped P2002. */
export function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2002") return true;
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/(\b2601\b|\b2627\b|Cannot insert duplicate key|duplicate key value)/i.test(text)) return true;
  let serialized = "";
  try { serialized = JSON.stringify(error ?? ""); } catch { /* non-serialisable error */ }
  return serialized.includes('"number":2601') || serialized.includes('"number":2627');
}
