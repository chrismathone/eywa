// 비용 장부 집계 — 02-harness/usage.jsonl → 07-decision/costs.csv. 구독 CLI(청구 없음 · 정가 환산만)와 실제 API를 따로.
// node scripts/_oneoff/ai-credit-mvp/costs.mjs
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "D:/tmp/ai-credit-mvp-2026-10-26";
const rows = readFileSync(`${ROOT}/02-harness/usage.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const g = new Map();
for (const x of rows) {
  const k = `${x.task}|${x.mode}|${x.requested ?? x.model ?? ""}`;
  const a = g.get(k) ?? { task: x.task, mode: x.mode, model: x.requested ?? x.model ?? "", calls: 0, cached: 0, failed: 0, listUsd: 0, apiUsd: 0, sec: 0 };
  a.calls++; if (x.cached) a.cached++; if (!x.ok) a.failed++;
  a.listUsd += x.listCostUsd ?? 0; a.apiUsd += x.mode === "api" && !x.cached ? x.costUsd ?? 0 : 0; a.sec += (x.ms ?? 0) / 1000;
  g.set(k, a);
}
const list = [...g.values()].sort((a, b) => a.task.localeCompare(b.task) || a.mode.localeCompare(b.mode));
const head = ["작업", "방식", "모델", "호출", "캐시 재사용", "실패", "구독 CLI 정가 환산 $(청구 안 됨)", "실제 API $", "호출 시간 합 초"];
const out = [head, ...list.map((a) => [a.task, a.mode === "cli" ? "구독 CLI" : "실제 API", a.model, a.calls, a.cached, a.failed, a.listUsd.toFixed(2), a.apiUsd.toFixed(4), Math.round(a.sec)])];
const tot = list.reduce((s, a) => ({ cli: s.cli + (a.mode === "cli" ? a.calls - a.cached : 0), api: s.api + a.apiUsd, list: s.list + a.listUsd }), { cli: 0, api: 0, list: 0 });
out.push([], ["합계", "", "", `구독 CLI 실제 호출 ${tot.cli}회`, "", "", tot.list.toFixed(2), tot.api.toFixed(4), ""]);
writeFileSync(`${ROOT}/07-decision/costs.csv`, "\ufeff" + out.map((r) => r.join(",")).join("\n") + "\n");
console.log(JSON.stringify({ 구독CLI_호출: tot.cli, 정가환산: +tot.list.toFixed(2), API_실제: +tot.api.toFixed(4), 상한: 5 }));
