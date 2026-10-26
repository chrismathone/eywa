// 학부모가 받는 카드 글 + 칸에서 찾은 아쉬운 사실(순수) — 옛 common.mjs `cardText({ v3: true })`·`concernCandidates` 그대로.
import type { RatingReport } from "./types";

const SUBJECT: Record<string, string> = { math: "수학", english: "영어" };
export const clean = (v: unknown): string => (v == null ? "" : String(v).trim());

/** 칸 값에서 찾은 '아쉬운 사실' 후보(concern 해당 여부를 코드가 먼저 판정). */
export function concernCandidates(r: RatingReport): string[] {
  const out: string[] = [];
  const hw = clean(r.homework_score);
  const pct = hw.match(/^(\d+)%$/);
  if (pct && Number(pct[1]) < 80) out.push(`지난 과제 수행률 ${hw}`);
  if (/미제출|일부 미흡/.test(hw)) out.push(`지난 과제 ${hw}`);
  const test = clean(r.daily_test) || clean(r.exam_info);
  const m = test.match(/(\d+)\s*문제 중\s*(\d+)/) || test.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) {
    const [total, right] = test.includes("문제") ? [Number(m[1]), Number(m[2])] : [Number(m[2]), Number(m[1])];
    if (total > 0 && right / total < 0.7) out.push(`테스트 ${test}(정답률 ${Math.round((right / total) * 100)}%)`);
  }
  if (/^(보통|안좋음|나쁨|노력 필요)$/.test(clean(r.attitude))) out.push(`수업 태도 '${clean(r.attitude)}'`);
  return out;
}

/** 모델에게 보이는 카드 — [알림장 칸](학부모가 보는 것) + [참고](학부모에게 안 보임). */
export function cardText(r: RatingReport, shortId: string): string {
  const lines: string[] = [];
  const grade = clean(r.school) || clean(r.grade) ? ` (${[clean(r.school), clean(r.grade)].filter(Boolean).join(" ")})` : "";
  lines.push(`### id: ${shortId}`);
  lines.push(`학생: ${r.student}${grade} · 과목: ${SUBJECT[r.subject ?? ""] ?? r.subject ?? "-"} · 수업일: ${r.d}${r.makeup ? " (보강)" : ""}`);
  lines.push("[알림장 칸]");
  const legacyTest = !clean(r.daily_test) && !clean(r.check_test) ? clean(r.exam_info) : "";
  const fields: [string, unknown][] = [
    ["교재", r.textbook], ["진도", r.progress], ["오늘 과제", r.homework_today],
    ["일일테스트", r.daily_test], ["확인테스트", r.check_test], ["시험점수", legacyTest],
    ["지난 과제 수행률", r.homework_score], ["수업 태도", r.attitude],
  ];
  for (const [k, v] of fields) if (clean(v)) lines.push(`${k}: ${clean(v)}`);
  if (r.video_homework === true) lines.push("영상 숙제: 있음");
  lines.push(`선생님 멘트:\n${clean(r.notes) || "(비어 있음)"}`);
  if (clean(r.trend_note)) lines.push(`학습 추세: ${clean(r.trend_note)}`);
  lines.push("[참고 — 학부모에게 안 보임]");
  const c = concernCandidates(r);
  lines.push(c.length ? `칸에서 찾은 아쉬운 사실: ${c.join(" · ")}` : "칸에서 찾은 아쉬운 사실: 없음(멘트에 아쉬운 일이 직접 적혀 있을 때만 concern을 매긴다)");
  if (r.prev_date) {
    lines.push(`직전 알림장(${r.prev_date}) 멘트: ${clean(r.prev_notes).replace(/\n/g, " / ") || "(비어 있음)"}`);
    lines.push(`직전 대비 유사도: ${r.sim_prev ?? "-"}`);
  } else lines.push("직전 알림장: 없음(이 과목 첫 발송)");
  lines.push(r.sim_class == null ? "같은 반 같은 날 다른 학생 알림장: 없음" : `같은 반 같은 날 최대 유사도: ${r.sim_class} (오늘 같은 반 ${r.class_size_today}명)`);
  if (r.sim_class_text) {
    lines.push(`같은 반에서 가장 비슷한 다른 학생 멘트: ${clean(r.sim_class_text).replace(/\n/g, " / ")}`);
    if ((r.sim_class_same ?? 0) > 0) lines.push(`거의 같은 글(유사도 0.85 이상)을 받은 같은 반 다른 학생: ${r.sim_class_same}명`);
  }
  return lines.join("\n");
}
