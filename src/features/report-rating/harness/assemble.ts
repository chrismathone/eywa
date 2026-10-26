// 평점 재료 조립(순수) — 옛 추출기(extract.cjs)와 같은 계산: 직전 발송 보고서(같은 학생·과목) · 같은 반 같은 날 다른 학생 멘트 유사도.
// 모집단 = 발송된 보고서(정상·회수 · 발송 큐 · 테스트 학생 제외). 대상만 넣으면 비교 재료가 빠지니 **그 날짜·그 학생의 발송분을 함께** 넣는다.
import type { RatingReport } from "./types";

export type SentReport = Omit<RatingReport, "prev_date" | "prev_notes" | "sim_prev" | "sim_class" | "class_size_today" | "sim_class_text" | "sim_class_same" | "classmate_names"> & {
  student_id: string;
  /** 반 단위 = coalesce(class_id, makeup_class_id, classnote_class_id) */
  unit_class: string | null;
  /** 같은 날 두 장이면 먼저 쓴 것이 앞 — 작성 시각(ISO) */
  created_at: string;
};

// 옛 추출기의 유사도 그대로(이름에서 접미 알파벳을 뗀 글자를 지우고 · 공백 제거 · 두 글자 다이스).
// 이름은 정규식 특수문자를 이스케이프한다(옛 추출기는 안 했다 — 괄호가 든 이름 하나면 지점 전체 정기 처리가 멈춘다, 적대 리뷰 2026-10-26).
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s: string | null, name: string) => (s || "").replace(new RegExp(name ? escapeRe(name.replace(/[A-Z]$/, "")) : "^$", "g"), "").replace(/\s+/g, "");
const bigrams = (s: string) => { const m = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; };
const dice = (a: string, b: string) => {
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
};
const ord = (a: SentReport, b: SentReport) => (a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0)
  || String(a.subject).localeCompare(String(b.subject)) || a.d.localeCompare(b.d) || Date.parse(a.created_at) - Date.parse(b.created_at);

/** 모집단 → 평점 재료가 붙은 보고서(입력 차례와 무관하게 id로 찾는다). */
export function assembleRatingReports(population: readonly SentReport[]): Map<string, RatingReport> {
  const rows = [...population].sort(ord).map((r) => ({ ...r }) as RatingReport & SentReport);
  let prev: (RatingReport & SentReport) | null = null;
  for (const r of rows) {
    if (prev && prev.student_id === r.student_id && prev.subject === r.subject) {
      r.prev_date = prev.d; r.prev_notes = prev.notes;
      r.sim_prev = +dice(norm(r.notes, r.student), norm(prev.notes, prev.student)).toFixed(2);
    } else r.sim_prev = null;
    prev = r;
  }
  const byUnit = new Map<string, (RatingReport & SentReport)[]>();
  for (const r of rows) { const k = `${r.unit_class}|${r.d}`; if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k)!.push(r); }
  for (const list of byUnit.values()) for (const r of list) {
    let best = 0, bestText: string | null = null, same = 0;
    for (const o of list) if (o !== r) {
      const s = dice(norm(r.notes, r.student), norm(o.notes, o.student));
      if (s >= 0.85) same++;
      if (s > best) { best = s; bestText = o.notes; }
    }
    r.sim_class = list.length > 1 ? +best.toFixed(2) : null;
    r.class_size_today = list.length;
    r.sim_class_text = best >= 0.5 ? bestText : null;
    r.sim_class_same = same;
    r.classmate_names = list.filter((o) => o !== r).map((o) => o.student);
  }
  return new Map(rows.map((r) => [r.id, r]));
}
