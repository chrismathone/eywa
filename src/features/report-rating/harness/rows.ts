// 점수 → `lesson_report_ratings` 저장 행(순수) — 10-23 업로드(build-upload.mjs)와 같은 화면용 근거 문장.
// 🔴 claim은 'flagged'(1차 판정만)까지만 — 'confirmed'는 Sonnet·Codex 두 검증이 일치했다는 뜻이라 단독 판정에 붙이지 않는다.
import { createHash } from "node:crypto";
import { RATING_RUBRIC } from "./prompt";
import { points, scoreCheck } from "./score";
import { RATING_ITEMS, type Checklist, type RatingReport, type Scored, type Signals } from "./types";

const LABEL = { warmth: "따뜻함", personal: "개별성", concern: "아쉬운 점 전달", clarity: "알기 쉬움", trust: "믿음" } as const;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function personalNote(x: Scored, s: Signals): string {
  const n = x.personal.note || "";
  if (n.startsWith("이 아이만의 문장")) return n;
  if (s.ment_empty) return "멘트가 비어 있음";
  if (x.personal.score === 3) return "이 아이 기록 값(점수·수행률)은 있으나 이 아이만의 문장은 없음";
  if (x.personal.score === 1 && s.class_same > 0) return `반 친구 ${s.class_same}명과 같은 문장 — 이 아이만의 문장이 없음`;
  if (s.one_line_copy) return "칸 값을 옮긴 한 줄뿐 — 이 아이만의 문장이 없음";
  return "이 아이만의 문장이 없음";
}
function concernNote(x: Scored, c: Checklist, s: Signals): string {
  const k = x.concern.score;
  if (!k) return "해당 없음";
  const what = (x.concern.note || "").trim();
  // 점수 계산과 같은 판정 — 코드가 멘트에서 아쉬운 점 문장을 찾았으면 '다룸'이다(10-23 업로드는 모델 값만 봐서 "다루지 않음"으로 어긋났다).
  const mentioned = !!c.concern?.mentioned_in_ment || !!s.ment_concern_code;
  const how = k === 5 ? "멘트가 짚고 도울 방법까지 전함" : k === 4 ? "멘트가 짚고 맥락·도움을 함께 전함"
    : k === 3 ? (mentioned ? "언급만 하고 도울 방법·맥락은 없음" : "멘트에서 다루지 않음")
    : k === 2 ? "가정에만 맡기거나 칭찬으로 덮음" : "아이에게 꼬리표·반복 비난";
  return what ? `${how} — 아쉬운 점: ${what}` : how;
}
function clarityNote(x: Scored, s: Signals): string {
  const missing = [s.card_learned ? null : "배운 내용", s.card_how ? null : "수업 모습", s.card_homework ? null : "과제"].filter(Boolean);
  const n = (x.clarity.note || "").trim();
  if (n === "배운 것·결과·과제 모두 분명") return n;
  const vague = /^빠진 요소 \d+개$/.test(n) ? "" : n;
  const parts: string[] = [];
  if (vague) parts.push(`애매한 부분: ${vague}`);
  if (missing.length) parts.push(`빠진 것: ${missing.join(", ")}`);
  return parts.join(" · ") || n;
}
function trustNote(x: Scored): string {
  const t = x.trust.score, n = (x.trust.note || "").trim();
  if (t === 5) return n || "칸과 멘트 일치";
  if (t <= 2) return n === "칸과 멘트 일치" ? "다른 아이 이야기가 섞임" : `칸과 멘트가 어긋남: ${n}`;
  if (t === 3) return `추측이거나 점수와 다른 문장: ${n}`;
  return `작은 차이: ${n}`;
}

export type RatingRow = {
  report_id: string; points: number; items: { key: string; label: string; score: number; note: string }[];
  parent_feeling: string | null; suggestion: string | null; claim: "flagged" | null; claim_reason: string | null;
  rubric: string; model: string; input_hash: string;
};

export function ratingRow(r: RatingReport, c: Checklist, sig: Signals, model: string, inputHash: string): RatingRow | null {
  const x = scoreCheck(c, sig, r);
  const p = points(x);
  if (p == null) return null;
  const note = { warmth: () => (x.warmth.note || "").trim(), personal: () => personalNote(x, sig), concern: () => concernNote(x, c, sig), clarity: () => clarityNote(x, sig), trust: () => trustNote(x) };
  return {
    report_id: r.id, points: Math.round(p * 100) / 100,
    items: RATING_ITEMS.map((k) => ({ key: k, label: LABEL[k], score: x[k]?.score ?? 0, note: cut(note[k](), 160) })),
    parent_feeling: (x.parent_feeling || "").trim() || null, suggestion: (x.suggestion || "").trim() || null,
    claim: x.claim_risk ? "flagged" : null, claim_reason: x.claim_risk ? cut(x.claim_reason.trim(), 240) : null,
    rubric: RATING_RUBRIC, model, input_hash: inputHash,
  };
}

/**
 * 입력 지문 — **그 보고서 자신의 칸**(학부모가 보는 값 · 학생 · 수업일)과 기준 판. 보고서를 고쳐 다시 보내면 달라진다.
 * 같은 반 친구 글·직전 글(비교 재료)은 넣지 않는다 — 친구 보고서가 제출과 수거 사이에 늦게 나가면 지문이 흔들려 다시 과금됐다(적대 리뷰 2026-10-26).
 * ⚠️ 평점이 저장된 뒤(done) 고친 보고서는 다시 매기지 않는다(옛 평점이 남는다) — 수거 때까지만 확인한다.
 */
export function ratingInputHash(r: RatingReport): string {
  const own = [r.id, r.d, r.subject, r.makeup, r.student, r.school, r.grade, r.textbook, r.progress, r.homework_today, r.daily_test, r.check_test,
    r.exam_info, r.homework_score, r.attitude, r.notes, r.trend_note, r.video_homework];
  return createHash("sha256").update(`${RATING_RUBRIC}\n${JSON.stringify(own)}`).digest("hex").slice(0, 32);
}

/** 모델 응답(묶음 하나) → 보고서별 체크리스트(값의 형식까지 다듬는다). 빠진 id·모양이 틀린 항목은 실패로(다음 번에 다시). */
export function checklistsOf(data: unknown, ids: readonly string[]): (Checklist | null)[] {
  const results = (data as { results?: unknown })?.results;
  const byId = new Map<string, Checklist>();
  if (Array.isArray(results)) for (const x of results) {
    const o = x as Record<string, unknown>;
    if (obj(o) && typeof o.id === "string" && isChecklist(o)) byId.set(o.id, normalize(o));
  }
  return ids.map((id) => byId.get(id) ?? null);
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function isChecklist(o: Record<string, unknown>): boolean {
  return obj(o.warm) && obj(o.personal) && Array.isArray((o.personal as { own_sentences?: unknown }).own_sentences)
    && obj(o.concern) && obj(o.clarity) && obj(o.trust) && Array.isArray((o.trust as { contradictions?: unknown }).contradictions)
    && Array.isArray((o.trust as { speculations?: unknown }).speculations);
}
// 모양은 맞는데 값의 형식이 틀린 응답('own_sentences: [1]' · 문자열 칸에 숫자)이 점수 계산 중에 던지지 않게.
// 글 칸은 글(과 숫자)만 받는다 — true/false·객체가 오면 "false"·"[object Object]"가 화면에 저장되고 점수도 내려간다(재리뷰 2026-10-26).
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const bool = (v: unknown) => v === true;
function normalize(o: Record<string, unknown>): Checklist {
  const w = o.warm as Record<string, unknown>, p = o.personal as Record<string, unknown>, c = o.concern as Record<string, unknown>;
  const cl = o.clarity as Record<string, unknown>, t = o.trust as Record<string, unknown>;
  return {
    warm: { evidence: str(w.evidence), natural_voice: bool(w.natural_voice), warm_expression: bool(w.warm_expression), parent_lecture: bool(w.parent_lecture), scolding_parent: bool(w.scolding_parent) },
    personal: { own_sentences: strs(p.own_sentences), followup_today: bool(p.followup_today), has_record_values: bool(p.has_record_values), generic_only: bool(p.generic_only) },
    concern: { ment_concern_quote: str(c.ment_concern_quote), mentioned_in_ment: bool(c.mentioned_in_ment), context: bool(c.context), helps: bool(c.helps), home_request: bool(c.home_request),
      home_only_or_anxious: bool(c.home_only_or_anxious), cover_with_praise: bool(c.cover_with_praise), label_blame: bool(c.label_blame), harsh_expression: bool(c.harsh_expression) },
    clarity: { vague_item: str(cl.vague_item), verbose: bool(cl.verbose) },
    trust: { contradictions: strs(t.contradictions), speculations: strs(t.speculations), other_child: bool(t.other_child), score_mismatch: bool(t.score_mismatch), minor_diff: str(t.minor_diff) },
    parent_feeling: str(o.parent_feeling), suggestion: str(o.suggestion),
  };
}
