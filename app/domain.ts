export type Difficulty = "简单" | "中等" | "困难";
export type Mastery = "待复习" | "巩固中" | "已掌握";

export type CatalogProblem = {
  order: number;
  number: string;
  title: string;
  slug: string;
  difficulty: Difficulty;
  custom?: boolean;
};

export type SolveLog = {
  id: string;
  problemSlug: string;
  solvedAt: string;
  duration: number;
  attempts: number;
  status: Mastery;
  tags: string[];
  note: string;
};

export type LegacyProblem = {
  id: string;
  number: string;
  title: string;
  difficulty: Difficulty;
  status: Mastery;
  tags: string[];
  solvedAt: string;
  duration: number;
  attempts: number;
  note: string;
  favorite: boolean;
};

export type BackupV2 = {
  version: 2;
  exportedAt: string;
  listSlug: "7m3kaU3o";
  weeklyGoal: number;
  logs: SolveLog[];
  favoriteSlugs: string[];
  customProblems: CatalogProblem[];
};

export type BackupV1 = {
  version: 1;
  weeklyGoal: number;
  problems: LegacyProblem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDifficulty(value: unknown): value is Difficulty {
  return value === "简单" || value === "中等" || value === "困难";
}

function isMastery(value: unknown): value is Mastery {
  return value === "待复习" || value === "巩固中" || value === "已掌握";
}

function isCatalogProblem(value: unknown): value is CatalogProblem {
  return isRecord(value)
    && isFiniteNumber(value.order, 1, 100_000)
    && typeof value.number === "string"
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.slug)
    && isDifficulty(value.difficulty)
    && (value.custom === undefined || typeof value.custom === "boolean");
}

function isSolveLog(value: unknown): value is SolveLog {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.problemSlug)
    && isIsoDate(value.solvedAt)
    && isFiniteNumber(value.duration, 1, 1_440)
    && isFiniteNumber(value.attempts, 1, 100)
    && isMastery(value.status)
    && isStringArray(value.tags)
    && typeof value.note === "string";
}

function isLegacyProblem(value: unknown): value is LegacyProblem {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && typeof value.number === "string"
    && isNonEmptyString(value.title)
    && isDifficulty(value.difficulty)
    && isMastery(value.status)
    && isStringArray(value.tags)
    && isIsoDate(value.solvedAt)
    && isFiniteNumber(value.duration, 1, 1_440)
    && isFiniteNumber(value.attempts, 1, 100)
    && typeof value.note === "string"
    && typeof value.favorite === "boolean";
}

function hasUniqueIds(items: Array<{ id: string }>) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function parseLeetBackup(value: unknown): BackupV2 | BackupV1 | null {
  if (!isRecord(value) || !isFiniteNumber(value.weeklyGoal, 1, 30)) return null;

  if (value.version === 2) {
    if (value.listSlug !== "7m3kaU3o"
      || !isIsoDate(value.exportedAt)
      || !Array.isArray(value.logs)
      || !value.logs.every(isSolveLog)
      || !hasUniqueIds(value.logs)
      || !isStringArray(value.favoriteSlugs)
      || !Array.isArray(value.customProblems)
      || !value.customProblems.every(isCatalogProblem)) return null;

    const slugs = value.customProblems.map((problem) => problem.slug);
    if (new Set(slugs).size !== slugs.length) return null;
    return value as BackupV2;
  }

  if (value.version === 1
    && Array.isArray(value.problems)
    && value.problems.every(isLegacyProblem)
    && hasUniqueIds(value.problems)) return value as BackupV1;

  return null;
}

export function safeLocalDateToIso(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
