// ① 퇴원 사유 — 실행 결과 ↔ 독립 평가자(Codex 블라인드) 대조 지표. 조정용 표본에서만 불일치를 들여다본다.
// node --import tsx scripts/_oneoff/ai-credit-mvp/withdrawals/metrics.ts <runs/파일.jsonl> <codex 표본: tuning|final> [--show]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RESULT_ROOT } from "../lib/runner";
import { EXCLUDED_DEFAULT } from "./guideline";

type Codex = { sid: string; status: string; reason: string | null; detail: string | null; memo: string | null; note: string };
type Run = { sid: string; status: string; reason: string | null; detail: string | null; memo: string | null; notes: string[]; quoteChecked: number; quoteFailed: number; evidence: { src: string; quote: string }[] };

export function compare(runs: Run[], codex: Codex[]) {
  const C = new Map(codex.map((c) => [c.sid, c]));
  const both = runs.filter((r) => C.has(r.sid) && r.status !== "보류(개인정보)");
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const statusSame = both.filter((r) => r.status === C.get(r.sid)!.status).length;
  const bothProp = both.filter((r) => r.status === "제안" && C.get(r.sid)!.status === "제안");
  const reasonSame = bothProp.filter((r) => r.reason === C.get(r.sid)!.reason).length;
  const detailBoth = bothProp.filter((r) => r.reason === C.get(r.sid)!.reason && r.detail && C.get(r.sid)!.detail);
  const detailSame = detailBoth.filter((r) => r.detail === C.get(r.sid)!.detail).length;
  // 강사 평가에서 빠지는 사유를 잘못 붙임 = 우리가 제안했는데 평가자는 그 사유로 제안하지 않음
  const excludedWrong = both.filter((r) => r.status === "제안" && r.reason && (EXCLUDED_DEFAULT as readonly string[]).includes(r.reason)
    && !(C.get(r.sid)!.status === "제안" && C.get(r.sid)!.reason === r.reason));
  const checked = runs.reduce((a, r) => a + r.quoteChecked, 0), failed = runs.reduce((a, r) => a + r.quoteFailed, 0);
  // 우리가 '제안'인데 평가자는 아님(과잉 제안) · 평가자는 '제안'인데 우리는 아님(놓침)
  const over = both.filter((r) => r.status === "제안" && C.get(r.sid)!.status !== "제안").length;
  const miss = both.filter((r) => r.status !== "제안" && C.get(r.sid)!.status === "제안").length;
  // 완전 일치 = 상태가 같고, 둘 다 제안이면 대분류까지 같다(버전 비교의 주 지표).
  const full = both.filter((r) => r.status === C.get(r.sid)!.status && (r.status !== "제안" || r.reason === C.get(r.sid)!.reason)).length;
  return {
    n: both.length, 완전일치: pct(full, both.length), 상태일치: pct(statusSame, both.length), 둘다제안: bothProp.length, 대분류일치: pct(reasonSame, bothProp.length),
    세부일치: `${detailSame}/${detailBoth.length}`, 제외사유오부착: excludedWrong.length, 인용검사: `${checked - failed}/${checked}`,
    과잉제안: over, 놓친제안: miss,
    우리상태: count(both.map((r) => r.status)), 평가자상태: count(both.map((r) => C.get(r.sid)!.status)),
    diffs: both.filter((r) => r.status !== C.get(r.sid)!.status || (r.status === "제안" && r.reason !== C.get(r.sid)!.reason)).map((r) => ({ sid: r.sid, ours: `${r.status} ${r.reason ?? ""}/${r.detail ?? ""}${r.memo ? ` (${r.memo})` : ""}`, ourNotes: r.notes.join("; "), codex: `${C.get(r.sid)!.status} ${C.get(r.sid)!.reason ?? ""}/${C.get(r.sid)!.detail ?? ""}${C.get(r.sid)!.memo ? ` (${C.get(r.sid)!.memo})` : ""}`, codexNote: C.get(r.sid)!.note })),
  };
}
const count = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

if (process.argv[1]?.endsWith("metrics.ts")) {
  const [runFile, set] = process.argv.slice(2);
  const runs: Run[] = readFileSync(join(RESULT_ROOT, "03-withdrawals", runFile), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const codex: Codex[] = JSON.parse(readFileSync(join(RESULT_ROOT, "03-withdrawals", "codex", set, "out.json"), "utf8")).cases;
  const { diffs, ...m } = compare(runs, codex);
  console.log(JSON.stringify(m));
  if (process.argv.includes("--show")) for (const d of diffs) console.log(JSON.stringify(d));
}
