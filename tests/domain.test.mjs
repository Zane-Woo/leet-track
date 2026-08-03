import assert from "node:assert/strict";
import test from "node:test";
import { parseLeetBackup, safeLocalDateToIso } from "../app/domain.ts";

const validLog = {
  id: "log-1",
  problemSlug: "two-sum",
  solvedAt: "2026-08-03T08:00:00.000Z",
  duration: 30,
  attempts: 1,
  status: "已掌握",
  tags: ["数组"],
  note: "哈希表",
};

test("accepts a valid v2 backup", () => {
  const backup = parseLeetBackup({
    version: 2,
    exportedAt: "2026-08-03T09:00:00.000Z",
    listSlug: "7m3kaU3o",
    weeklyGoal: 7,
    logs: [validLog],
    favoriteSlugs: ["two-sum"],
    customProblems: [],
  });
  assert.equal(backup?.version, 2);
  assert.equal(backup?.logs.length, 1);
});

test("rejects malformed dates, ranges and duplicate ids", () => {
  const base = {
    version: 2,
    exportedAt: "2026-08-03T09:00:00.000Z",
    listSlug: "7m3kaU3o",
    weeklyGoal: 7,
    favoriteSlugs: [],
    customProblems: [],
  };
  assert.equal(parseLeetBackup({ ...base, logs: [{ ...validLog, solvedAt: "not-a-date" }] }), null);
  assert.equal(parseLeetBackup({ ...base, weeklyGoal: 0, logs: [] }), null);
  assert.equal(parseLeetBackup({ ...base, logs: [validLog, { ...validLog }] }), null);
});

test("converts valid local dates without throwing", () => {
  assert.equal(safeLocalDateToIso(""), null);
  assert.match(safeLocalDateToIso("2026-08-03T18:30") ?? "", /^2026-08-03T/);
});
