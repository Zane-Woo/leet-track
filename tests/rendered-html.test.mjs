import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders LeetTrack metadata and loading shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>题迹 · 力扣刷题记录<\/title>/);
  assert.doesNotMatch(html, /题迹 · 力扣刷题记录 · 题迹/);
  assert.match(html, /正在打开题迹/);
  assert.match(html, /manifest\.webmanifest/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("ships the fixed catalogue, local persistence and safe offline fallback", async () => {
  const [source, cloud, leetcodeSync, edgeFunction, migration, catalogueRaw, config, manifestRaw, worker] = await Promise.all([
    readFile(new URL("../app/LeetTrackApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/leetcode-sync.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/leetcode-recent/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260803_leet_track_cloud_sync.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/problemCatalog.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const catalogue = JSON.parse(catalogueRaw);
  assert.equal(catalogue.length, 117);
  assert.equal(new Set(catalogue.map((item) => item.slug)).size, 117);
  assert.match(source, /leet-track-logs-v2/);
  assert.match(source, /leet-track-recovery-v1/);
  assert.match(source, /leet-track-local-updated-at-v1/);
  assert.match(source, /storageWritable/);
  assert.match(source, /发现可恢复的本机记录/);
  assert.match(source, /parseLeetBackup/);
  assert.match(source, /今天刷哪题/);
  assert.match(source, /展开全部 \$\{logs\.length\} 条/);
  assert.match(source, /aria-expanded=\{showAllRecent\}/);
  assert.match(source, /选择常用标签/);
  assert.match(source, /其他 \/ 自定义/);
  assert.match(source, /立即同步/);
  assert.match(source, /同步范围/);
  assert.match(source, /localRevisionRef\.current !== reconciliationRevision/);
  assert.match(source, /logs: merged\.logs/);
  assert.match(leetcodeSync, /leetcode-cn:/);
  assert.match(edgeFunction, /recentACSubmissions/);
  assert.match(edgeFunction, /auth: "publishable"/);
  assert.match(cloud, /sync_leet_track_state/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(config, /output:\s*isGitHubPages \? "export"/);
  assert.equal(JSON.parse(manifestRaw).display, "standalone");
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /requestUrl\.origin !== self\.location\.origin/);
  assert.match(worker, /leet-track-v4/);
});
