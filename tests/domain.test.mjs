import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLeetBackup,
  parseRecoverySnapshots,
  parseStoredFavoriteSlugs,
  parseStoredLogs,
  safeLocalDateToIso,
} from "../app/domain.ts";
import {
  mergeLeetCodeSubmissions,
  parseLeetCodeSyncResponse,
} from "../app/leetcode-sync.ts";

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

test("reads stored logs independently without treating an empty list as corrupt", () => {
  assert.deepEqual(parseStoredLogs([]), []);
  assert.equal(parseStoredLogs([{ ...validLog, duration: 0 }]), null);
  assert.equal(parseStoredLogs([{ ...validLog, duration: 0, source: "leetcode-cn" }])?.length, 1);
  assert.deepEqual(parseStoredFavoriteSlugs(["two-sum", "two-sum"]), ["two-sum"]);
});

test("imports matching LeetCode submissions without overwriting or duplicating logs", () => {
  const response = parseLeetCodeSyncResponse({
    userSlug: "LJ1bZ7zbZn",
    days: 3,
    availableCount: 3,
    limited: false,
    submissions: [
      { submissionId: "100", submitTime: 1785759543, titleSlug: "two-sum", title: "两数之和", questionFrontendId: "1" },
      { submissionId: "101", submitTime: 1785759443, titleSlug: "outside", title: "题单外", questionFrontendId: "999" },
    ],
  });
  assert.ok(response);
  const existing = { ...validLog, id: "leetcode-cn:99", source: "leetcode-cn", duration: 0 };
  const merged = mergeLeetCodeSubmissions([existing], [{ order: 1, number: "1", title: "两数之和", slug: "two-sum", difficulty: "简单" }], [
    ...response.submissions,
    { submissionId: "99", submitTime: 1785759343, titleSlug: "two-sum", title: "两数之和", questionFrontendId: "1" },
  ]);
  assert.equal(merged.importedCount, 1);
  assert.equal(merged.duplicateCount, 1);
  assert.equal(merged.outsideListCount, 1);
  assert.equal(merged.logs[1].id, "leetcode-cn:100");
  assert.equal(merged.logs[1].duration, 0);
});

test("keeps valid recovery snapshots and ignores malformed entries", () => {
  const valid = {
    version: 2,
    exportedAt: "2026-08-03T09:00:00.000Z",
    listSlug: "7m3kaU3o",
    weeklyGoal: 7,
    logs: [validLog],
    favoriteSlugs: [],
    customProblems: [],
  };
  assert.deepEqual(parseRecoverySnapshots([{ nope: true }, valid]), [valid]);
});
