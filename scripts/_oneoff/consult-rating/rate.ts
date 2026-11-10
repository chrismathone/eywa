// 상담 평점 — 구독 CLI(내부 요금제)로 일괄 평점. 운영 배치와 **같은 지침·프롬프트·해석·규칙**(src/features/consultation-rating/harness)을 쓴다.
// 결과 = ~/eywa-data/consult-rating/04-ratings/runs/<표본>-<모델>[-repN].jsonl (저장소 밖 · 원문 포함이라 밖으로 내보내지 않는다)
// 실행(.env.local을 싣지 않는다 — 평가 단계는 운영 DB·API 키 없이):
//   TSX_TSCONFIG_PATH=scripts/_oneoff/consult-rating/tsconfig.json AI_DEV_CLAUDE_CLI=1 NODE_ENV=development \
//   node --import tsx scripts/_oneoff/consult-rating/rate.ts --set all|<samples/NAME.map.json의 NAME> --model haiku|sonnet [--limit N] [--rep N] [--conc 3]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { bodyOf, consultationCard } from "@/features/consultation-rating/harness/card";
import { copyStudentCounts, isRecordingPlaceholder } from "@/features/consultation-rating/harness/copies";
import { parseConsultationResult } from "@/features/consultation-rating/harness/parse";
import { ratingRequest } from "@/features/consultation-rating/harness/request";
import { emptyRow, isEmptyRecord, ratingRow } from "@/features/consultation-rating/harness/rules";
import type { ConsultationRatingInput } from "@/features/consultation-rating/harness/types";
import { piiHits } from "@/features/report-rating/harness/pii";
import { RESULT_ROOT, assertEvalEnv, callModel, type ModelKey } from "./lib/runner";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
type Row = { id: string; student_id: string; summary: string; subject: string | null; audience: string | null; grade: string | null; follow_up_action: string | null; transcription: string | null; processing_status: string | null };

export function toInput(r: Row, copies: Map<string, number>): ConsultationRatingInput {
  const visible = visibleConsultationSummary(r.summary);
  const aud = r.audience === "parent" || r.audience === "student" || r.audience === "both" ? r.audience : null;
  return { id: r.id, summary: visible, subject: r.subject, audience: aud, grade: r.grade, followUpAction: r.follow_up_action, copyStudents: copies.get(r.id) ?? 1,
    // 녹음 상담은 전사가 정상 끝난(completed) 것만 — 실패로 끝난 녹음의 전사 부스러기를 채점하지 않는다(서버 material.ts와 같은 규칙).
    transcript: isRecordingPlaceholder(visible) && r.processing_status === "completed" ? r.transcription?.trim() || null : null };
}

async function main() {
  const set = arg("set", "all")!, model = arg("model", "haiku") as ModelKey, limit = Number(arg("limit", "0")), rep = Number(arg("rep", "0")), conc = Number(arg("conc", "3"));
  const cacheOnly = process.argv.includes("--cache-only"); // 다른 실행이 매기는 중 — 이미 매긴 것만 뽑는다(새 호출 없음)
  assertEvalEnv();
  const rows: Row[] = readFileSync(join(RESULT_ROOT, "cs-all.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const copies = copyStudentCounts(rows);
  const wanted = set === "all" ? null : new Set(Object.values(JSON.parse(readFileSync(join(RESULT_ROOT, "samples", `${set}.map.json`), "utf8")) as Record<string, string>));
  let targets = rows.filter((r) => !wanted || wanted.has(r.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (limit) targets = targets.slice(0, limit);
  const t0 = Date.now();
  let done = 0;
  const out = await Promise.all(targets.map(async (r) => {
    const c = toInput(r, copies);
    const base = { consultation_id: r.id };
    let res;
    if (isRecordingPlaceholder(c.summary) && !c.transcript) res = { ...base, ok: false, error: "녹음 분석이 끝나지 않았거나 실패했습니다" };
    else if (piiHits(consultationCard(c)).length) res = { ...base, ok: false, error: "외부 AI 전송 금지 정보" }; // 보내는 카드 전체(후속 조치 칸 포함)
    else if (isEmptyRecord(c)) res = { ...base, ok: true, rule: "empty", row: emptyRow(c) };
    else {
      const req = ratingRequest("cs-local", c);
      const m = await callModel<unknown>({ task: "ratings", version: "c1", item: r.id.slice(0, 8), model, system: req.system, prompt: req.prompt, maxTokens: req.maxTokens!,
        effort: req.reasoningEffort as "medium", feature: "student_consultation_rating", tenantId: "cs-local", cacheDir: join(RESULT_ROOT, "04-ratings", "cache"), rep, concurrency: conc, cacheOnly });
      if (!m.ok) res = { ...base, ok: false, error: m.error };
      else {
        const parsed = parseConsultationResult(m.data, bodyOf(c));
        res = parsed ? { ...base, ok: true, ms: m.ms, cached: m.cached, raw: parsed, row: ratingRow(c, parsed, m.actualModels.join("+")) } : { ...base, ok: false, error: "응답 해석 실패", raw: m.data };
      }
    }
    if (++done % 50 === 0) console.log(`… ${done}/${targets.length} (${Math.round((Date.now() - t0) / 1000)}초)`);
    return res;
  }));
  const dir = join(RESULT_ROOT, "04-ratings", "runs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${set}-${model}${rep ? `-rep${rep}` : ""}${cacheOnly ? "-cached" : ""}.jsonl`);
  writeFileSync(file, out.map((x) => JSON.stringify(x)).join("\n") + "\n");
  const dist: Record<string, number> = {};
  for (const x of out) if (x.ok && "row" in x && x.row) dist[x.row.points] = (dist[x.row.points] ?? 0) + 1;
  console.log(JSON.stringify({ file, n: out.length, ok: out.filter((x) => x.ok).length, 분포: dist, 초: Math.round((Date.now() - t0) / 1000) }));
}
main().catch((e) => { console.error(e); process.exit(1); });
