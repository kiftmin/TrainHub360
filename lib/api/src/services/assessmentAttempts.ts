import { db, Prisma } from "../db.js";

export interface VersionNode {
  id: string;
  supersedesId: string | null;
  changeKind: string | null;
}

export interface AttemptStats {
  chainIds: string[];
  attemptsUsed: number;
  bestScore: number | null;
  passedBefore: boolean;
}

type VersionClient = Prisma.TransactionClient | typeof db;

export async function versionChain(client: VersionClient, assessment: VersionNode): Promise<VersionNode[]> {
  const chain: VersionNode[] = [assessment];
  const seen = new Set<string>([assessment.id]);
  let cursor = assessment;
  while (cursor.changeKind === "minor" && cursor.supersedesId && !seen.has(cursor.supersedesId)) {
    const previous = await client.assessment.findUnique({
      where: { id: cursor.supersedesId },
      select: { id: true, supersedesId: true, changeKind: true },
    });
    if (!previous) break;
    chain.push(previous);
    seen.add(previous.id);
    cursor = previous;
  }
  return chain;
}

export async function attemptStats(
  client: VersionClient,
  assessment: VersionNode,
  enrolmentId: string,
  passMark: number,
): Promise<AttemptStats> {
  const chain = await versionChain(client, assessment);
  const chainIds = chain.map((node) => node.id);
  const attempts = await client.assessmentAttempt.findMany({
    where: { assessmentId: { in: chainIds }, enrolmentId },
    select: { assessmentId: true, status: true, score: true, percent: true },
  });
  const ownFinished = attempts.filter(
    (attempt) => attempt.assessmentId === assessment.id && ["submitted", "grading", "graded"].includes(attempt.status),
  ).length;
  const earlier = attempts.filter((attempt) => attempt.assessmentId !== assessment.id).length;
  const attemptsUsed = ownFinished + earlier;
  const scores = attempts
    .filter((attempt) => ["submitted", "graded"].includes(attempt.status))
    .map((attempt) => attempt.percent ?? attempt.score)
    .filter((score): score is number => score !== null);
  const bestScore = scores.length ? Math.max(...scores) : null;
  return { chainIds, attemptsUsed, bestScore, passedBefore: bestScore !== null && bestScore >= passMark };
}
