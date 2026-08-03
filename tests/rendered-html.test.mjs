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
  const [source, catalogueRaw, config, manifestRaw, worker] = await Promise.all([
    readFile(new URL("../app/LeetTrackApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/problemCatalog.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const catalogue = JSON.parse(catalogueRaw);
  assert.equal(catalogue.length, 117);
  assert.equal(new Set(catalogue.map((item) => item.slug)).size, 117);
  assert.match(source, /leet-track-logs-v2/);
  assert.match(source, /parseLeetBackup/);
  assert.match(config, /output:\s*isGitHubPages \? "export"/);
  assert.equal(JSON.parse(manifestRaw).display, "standalone");
  assert.match(worker, /event\.request\.mode === "navigate"/);
  assert.match(worker, /requestUrl\.origin !== self\.location\.origin/);
});
