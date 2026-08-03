import type { CatalogProblem, SolveLog } from "./domain";

export const LEETCODE_USER_SLUG = "LJ1bZ7zbZn";
export const LEETCODE_PROFILE_URL = `https://leetcode.cn/u/${LEETCODE_USER_SLUG}/`;
export const LEETCODE_SYNC_RANGES = [1, 3, 7, 14, 30] as const;

export type LeetCodeSyncDays = (typeof LEETCODE_SYNC_RANGES)[number];

export type LeetCodeSubmission = {
  submissionId: string;
  submitTime: number;
  titleSlug: string;
  title: string;
  questionFrontendId: string;
};

export type LeetCodeSyncResponse = {
  userSlug: string;
  days: LeetCodeSyncDays;
  availableCount: number;
  limited: boolean;
  submissions: LeetCodeSubmission[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSyncDays(value: unknown): value is LeetCodeSyncDays {
  return typeof value === "number" && LEETCODE_SYNC_RANGES.includes(value as LeetCodeSyncDays);
}

function isSubmission(value: unknown): value is LeetCodeSubmission {
  return isRecord(value)
    && typeof value.submissionId === "string"
    && value.submissionId.length > 0
    && typeof value.submitTime === "number"
    && Number.isFinite(value.submitTime)
    && typeof value.titleSlug === "string"
    && value.titleSlug.length > 0
    && typeof value.title === "string"
    && typeof value.questionFrontendId === "string";
}

export function parseLeetCodeSyncResponse(value: unknown): LeetCodeSyncResponse | null {
  if (!isRecord(value)
    || typeof value.userSlug !== "string"
    || !isSyncDays(value.days)
    || typeof value.availableCount !== "number"
    || !Number.isFinite(value.availableCount)
    || typeof value.limited !== "boolean"
    || !Array.isArray(value.submissions)
    || !value.submissions.every(isSubmission)) return null;
  return value as LeetCodeSyncResponse;
}

export function mergeLeetCodeSubmissions(
  logs: SolveLog[],
  problems: CatalogProblem[],
  submissions: LeetCodeSubmission[],
) {
  const knownSlugs = new Set(problems.filter((problem) => !problem.custom).map((problem) => problem.slug));
  const existingIds = new Set(logs.map((log) => log.id));
  const matched = submissions.filter((submission) => knownSlugs.has(submission.titleSlug));
  const imported = matched
    .filter((submission) => !existingIds.has(`leetcode-cn:${submission.submissionId}`))
    .map((submission) => ({
      id: `leetcode-cn:${submission.submissionId}`,
      problemSlug: submission.titleSlug,
      solvedAt: new Date(submission.submitTime * 1_000).toISOString(),
      duration: 0,
      attempts: 1,
      status: "待复习" as const,
      tags: [],
      note: "",
      source: "leetcode-cn" as const,
    }));

  return {
    logs: [...logs, ...imported],
    importedCount: imported.length,
    duplicateCount: matched.length - imported.length,
    outsideListCount: submissions.length - matched.length,
  };
}
