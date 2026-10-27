// 수업보고서 평점 기준 v6 재채점 — 원장 2026-10-26 *"전혀 신뢰안가는 점수"* → *"원장님 점수표에 맞춤"* → *"진행해"*.
// 옛 기준(v4) 평점 줄을 기준 v6(원장 점수표 44건 · harness/owner.ts)으로 다시 매겨 **덮어쓴다**(옛 값은 백업 파일에).
// 앱과 같은 길: 요청 = ratingRequest(관문 generateJSON과 같은 사실 원칙·라이선스·키 그룹·사용량 기록) · 지침 = loadOwnerSystem · 해석·저장 행 = owner.ts.
//
// 실행(저장소 뿌리에서):
//   TSX_TSCONFIG_PATH=scripts/_oneoff/report-rating-v6/tsconfig.json node --env-file=D:/eywa_refactoring/.env.local --import tsx \
//     scripts/_oneoff/report-rating-v6/rerate.ts <check|submit|collect|apply> --out D:/tmp/rating-v6-rerate
//   check   = 쓰기·외부 호출 없음 — 대상 수 · 예시 수 · 관문 통과 · 요청 크기
//   submit  = 옛 평점 백업(backup.json) → 일괄 요청 보내기(state.json에 배치 번호)
//   collect = 결과 거두기 → results.jsonl(저장 안 함) + 분포
//   apply   = results.jsonl을 표에 덮어쓰기(지금 기준 평점은 덮지 않음 · 보고서가 그 사이 바뀌었으면 건너뜀)
// 되돌리기 = revert.mjs --backup <out>/backup.json (미리보기 → --apply)
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { collectJSONBatch, submitJSONBatch, type BatchItem } from "@/lib/ai/generate-batch";
import { anthropicRequestParams, requireAiLicense, tenantChoiceFor } from "@/lib/ai/generate";
import { withFactGuard } from "@/lib/ai/fact-guard";
import { kstToday } from "@/lib/date-kst";
import { OWNER_RUBRIC_ID, buildOwnerPrompt, ownerInputHash, ownerRatingRow, parseOwnerResult, type OwnerCardFields } from "@/features/report-rating/harness/owner";
import { piiHits } from "@/features/report-rating/harness/pii";
import { loadOwnerSystem, ownerSystemProblem } from "@/features/report-rating/server/anchors";
import { RATING_FEATURE, ratingRequest } from "@/features/report-rating/server/batch";

const mode = process.argv[2];
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", "D:/tmp/rating-v6-rerate")!;
const CHUNK = Number(arg("chunk", "800")); // 배치 하나에 싣는 요청 수 — 요청마다 예시 지침(약 3만 자)이 실려 256MB 한도 아래로 나눈다
mkdirSync(OUT, { recursive: true });
const db = createAdminClient();

type Report = OwnerCardFields & { id: string; student_id: string; ment_source: string | null; classnote_status: string | null; classnote_queued_at: string | null };
type Plan = { customId: string; reportId: string; hash: string; mentSource: string | null };
type State = { tenantId: string; at: string; batches: { batchId: string; plans: Plan[]; collected?: boolean }[] };

async function tenantId(): Promise<string> {
  const { data, error } = await db.from("tenants").select("id").eq("slug", "cs").single();
  if (error || !data) throw new Error(`지점을 찾지 못함: ${error?.message}`);
  return data.id as string;
}

/** 대상 = 이 지점의 평점 줄 중 지금 기준이 아닌 것. 정상 발송(success) · 테스트 학생 아님 · 전송 금지 정보 없음만 매긴다. */
async function targets(tid: string) {
  const rated = await fetchAllPaged<Record<string, unknown>>((from, to) => db.from("lesson_report_ratings").select("*").eq("tenant_id", tid).order("report_id").range(from, to));
  const old = rated.filter((r) => r.rubric !== OWNER_RUBRIC_ID);
  const reports = await fetchInChunks<Report>(old.map((r) => r.report_id as string), (chunk) =>
    db.from("lesson_reports").select("id, student_id, progress, homework_score, attitude, homework_today, notes, ment_source, classnote_status, classnote_queued_at").eq("tenant_id", tid).in("id", chunk));
  const tests = new Set((await fetchInChunks<{ id: string }>([...new Set(reports.map((r) => r.student_id))], (chunk) =>
    db.from("students").select("id").eq("tenant_id", tid).eq("is_test", true).in("id", chunk))).map((s) => s.id));
  const skip: Record<string, number> = {};
  const no = (k: string) => (skip[k] = (skip[k] ?? 0) + 1);
  const byId = new Map(reports.map((r) => [r.id, r]));
  const ok: Report[] = [];
  for (const row of old) {
    const r = byId.get(row.report_id as string);
    if (!r) no("보고서 없음");
    else if (r.classnote_status !== "success" || !r.classnote_queued_at) no(`정상 발송 아님(${r.classnote_status ?? "없음"})`);
    else if (tests.has(r.student_id)) no("테스트 학생");
    else if (piiHits(buildOwnerPrompt(r)).length) no("전송 금지 정보");
    else ok.push(r);
  }
  return { rated, old, ok, skip };
}

async function main() {
  const tid = await tenantId();
  if (mode === "check") {
    const owner = await loadOwnerSystem(tid);
    const t = await targets(tid);
    await requireAiLicense({ feature: RATING_FEATURE, tenantId: tid });
    const choice = await tenantChoiceFor({ feature: RATING_FEATURE, tenantId: tid });
    const sample = t.ok[0];
    const params = sample ? anthropicRequestParams("claude-haiku-5-5", { ...ratingRequest(tid, owner.system, buildOwnerPrompt(sample)), prompt: withFactGuard(buildOwnerPrompt(sample)) }, false) : null;
    console.log(JSON.stringify({
      평점줄: t.rated.length, 옛기준: t.old.length, 매길것: t.ok.length, 건너뜀: t.skip,
      예시: { 쓴다: owner.used, 뺌: owner.dropped, 문제: ownerSystemProblem(owner) }, 지점모델선택: choice,
      요청크기_바이트: params ? JSON.stringify(params).length : 0, 지침글자: owner.system.length,
    }, null, 1));
    if (sample) writeFileSync(join(OUT, "sample-prompt.txt"), `${owner.system}\n\n=====\n\n${withFactGuard(buildOwnerPrompt(sample))}`);
    return;
  }
  if (mode === "submit") {
    if (existsSync(join(OUT, "state.json"))) throw new Error("이미 보낸 기록(state.json)이 있습니다 — 거두기(collect)를 하거나 폴더를 바꾸세요");
    const owner = await loadOwnerSystem(tid);
    const problem = ownerSystemProblem(owner);
    if (problem) throw new Error(problem);
    const t = await targets(tid);
    writeFileSync(join(OUT, "backup.json"), JSON.stringify({ at: new Date().toISOString(), tenantId: tid, rows: t.rated }, null, 0));
    console.log(`백업 ${t.rated.length}줄 → ${join(OUT, "backup.json")}`);
    const state: State = { tenantId: tid, at: new Date().toISOString(), batches: [] };
    for (let i = 0; i < t.ok.length; i += CHUNK) {
      const part = t.ok.slice(i, i + CHUNK);
      const plans: Plan[] = part.map((r, j) => ({ customId: `rv6_${i + j}`, reportId: r.id, hash: ownerInputHash(r.id, r, r.ment_source), mentSource: r.ment_source }));
      const items: BatchItem[] = part.map((r, j) => ({ customId: plans[j].customId, opts: ratingRequest(tid, owner.system, buildOwnerPrompt(r)) }));
      const sent = await submitJSONBatch(items);
      if (!sent?.batchId) throw new Error(`배치를 만들지 못함: ${JSON.stringify(sent?.rejected?.slice(0, 3))}`);
      if (sent.rejected.length) console.log(`  거절 ${sent.rejected.length}: ${sent.rejected[0]?.error}`);
      const okPlans = plans.filter((p) => sent.models[p.customId]);
      state.batches.push({ batchId: sent.batchId, plans: okPlans });
      writeFileSync(join(OUT, "state.json"), JSON.stringify(state, null, 0));
      console.log(`배치 ${state.batches.length}: ${sent.batchId} · ${okPlans.length}건`);
    }
    return;
  }
  const state = JSON.parse(readFileSync(join(OUT, "state.json"), "utf8")) as State;
  if (state.tenantId !== tid) throw new Error("지점이 다릅니다");
  if (mode === "collect") {
    const resFile = join(OUT, "results.jsonl");
    const dist = [0, 0, 0, 0, 0, 0];
    let pending = 0;
    for (const b of state.batches) {
      if (b.collected) continue;
      const metas = Object.fromEntries(b.plans.map((p) => [p.customId, { feature: RATING_FEATURE, tenantId: tid }]));
      const out = await collectJSONBatch(b.batchId, metas);
      if (!out) { pending++; console.log(`처리 중: ${b.batchId}`); continue; }
      for (const p of b.plans) {
        const o = out[p.customId];
        const res = o?.ok ? parseOwnerResult(o.data) : null;
        appendFileSync(resFile, JSON.stringify({ ...p, ok: !!res, model: o?.ok ? o.model : null, error: o && !o.ok ? o.error : res ? undefined : "해석 실패", res }) + "\n");
      }
      b.collected = true;
      writeFileSync(join(OUT, "state.json"), JSON.stringify(state, null, 0));
      console.log(`거둠: ${b.batchId}`);
    }
    if (existsSync(resFile)) {
      const rows = readFileSync(resFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      for (const r of rows) if (r.res) dist[ownerRatingRow(r.reportId, r.res, r.mentSource, r.model, r.hash).points]++;
      console.log(JSON.stringify({ 거둔: rows.length, 해석: rows.filter((r) => r.res).length, 실패: rows.filter((r) => !r.res).length, 남은배치: pending, 분포_1to5: dist.slice(1) }));
    }
    return;
  }
  if (mode === "apply") {
    // 거두기가 끊겼다 다시 돌면 같은 보고서 줄이 두 번 적힐 수 있다 — 보고서마다 마지막 하나만(한 upsert에 같은 줄이 둘이면 실패한다).
    const rows = [...new Map(readFileSync(join(OUT, "results.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.res).map((r) => [r.reportId, r])).values()];
    // 그 사이 보고서가 바뀌었으면(고쳐 다시 보냄) 덮지 않는다 — 지문을 지금 값으로 다시 잰다. 지금 기준 평점이 이미 있으면 덮지 않는다.
    const now = new Map((await fetchInChunks<Report>(rows.map((r) => r.reportId), (chunk) =>
      db.from("lesson_reports").select("id, student_id, progress, homework_score, attitude, homework_today, notes, ment_source, classnote_status, classnote_queued_at").eq("tenant_id", tid).in("id", chunk))).map((r) => [r.id, r]));
    const cur = new Map((await fetchInChunks<{ report_id: string; rubric: string }>(rows.map((r) => r.reportId), (chunk) =>
      db.from("lesson_report_ratings").select("report_id, rubric").eq("tenant_id", tid).in("report_id", chunk))).map((r) => [r.report_id, r.rubric]));
    const put: Record<string, unknown>[] = [];
    const skip: Record<string, number> = {};
    for (const r of rows) {
      const rep = now.get(r.reportId);
      if (!rep || rep.classnote_status !== "success") skip["정상 발송 아님"] = (skip["정상 발송 아님"] ?? 0) + 1;
      else if (ownerInputHash(rep.id, rep, rep.ment_source) !== r.hash) skip["보고서가 바뀜"] = (skip["보고서가 바뀜"] ?? 0) + 1;
      else if (cur.get(r.reportId) === OWNER_RUBRIC_ID) skip["이미 지금 기준"] = (skip["이미 지금 기준"] ?? 0) + 1;
      else put.push({ ...ownerRatingRow(r.reportId, r.res, r.mentSource, r.model, r.hash), tenant_id: tid, rated_on: kstToday() });
    }
    if (!process.argv.includes("--yes")) { console.log(JSON.stringify({ 덮어쓸것: put.length, 건너뜀: skip, 안내: "--yes를 붙이면 씁니다" })); return; }
    let n = 0;
    for (let i = 0; i < put.length; i += 200) {
      const { error } = await db.from("lesson_report_ratings").upsert(put.slice(i, i + 200), { onConflict: "report_id" });
      if (error) throw new Error(`저장 실패(${n}줄 쓴 뒤): ${error.message}`);
      n += Math.min(200, put.length - i);
    }
    writeFileSync(join(OUT, "applied.json"), JSON.stringify({ at: new Date().toISOString(), ids: put.map((p) => p.report_id), skip }, null, 0));
    console.log(JSON.stringify({ 덮어씀: n, 건너뜀: skip }));
    return;
  }
  throw new Error("단계: check | submit | collect | apply");
}
main().catch((e) => { console.error(e); process.exit(1); });
