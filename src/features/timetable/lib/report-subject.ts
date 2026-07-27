/**
 * 수업보고서 1건의 **과목 판정**(순수 함수) — 시간표 hover의 진도·교재를 그 시간표 과목으로 가두기 위한 것.
 *
 * 🔴 왜 필요한가(원장 2026-07-27): 영어 시간표에서 학생에 hover하면 **수학 진도·교재**가 떴다
 * (실측 "교재 1-2 개념의 숲 / 진도 1.작도 2.평행선 / 김민주"). hover의 학생 단위 폴백이 과목을 안 가려
 * 학생의 **최신 보고서 아무거나**를 붙였기 때문. 지시 = "수학 시간표에서만 수학 내용이 호버링되게",
 * "이후 영어도 eywa에서 발송되면 영어 내용은 영어 시간표에서만".
 */

/**
 * `subject`·`class_id`가 **둘 다 없는** 레거시 이관분의 과목.
 *
 * ⚠️ 실측 근거(injaewon 2026-07-27): 그런 행이 14,695건인데 작성자가 김윤하·김은정·김민주·이수진·김화영·
 * 이성우 등 **수학 강사뿐**이고, 영어 강사(영문닉 보유자) 작성분은 **0건**이다 → 이관분 = 전부 수학.
 * 이 폴백이 없으면 그 14,695건이 어느 과목에도 안 붙어 **수학 hover가 통째로 빈다**(더 나쁜 회귀).
 * 📌 영어도 eywa에서 발송되기 시작하면 그 행들은 `subject='english'`를 갖고 들어오므로 자동으로 갈린다 —
 *    이 상수를 건드릴 필요 없다.
 */
export const LEGACY_REPORT_SUBJECT = "math";

/** 보고서의 과목 원천(둘 다 optional — 이관분은 전부 비어 있다). */
export type ReportSubjectSource = {
  /** `lesson_reports.subject` — eywa가 발송한 신규분에만 있다. */
  subject?: string | null;
  /** 연결된 반의 과목(`class_id` 경유). 관리자 작성분·이관분은 반이 없어 비어 있다. */
  classSubject?: string | null;
};

/**
 * 판정 순서 = 보고서 자체 `subject` → 반의 `subject` → 레거시 폴백(`math`).
 * 공백만 있는 값은 없는 것으로 본다(임포트 산물에 `''`가 섞여 있다).
 */
export function reportSubject(src: ReportSubjectSource): string {
  const own = src.subject?.trim();
  if (own) return own;
  const viaClass = src.classSubject?.trim();
  if (viaClass) return viaClass;
  return LEGACY_REPORT_SUBJECT;
}

/** 이 보고서를 그 과목 시간표의 hover에 붙여도 되는가. */
export function reportMatchesSubject(src: ReportSubjectSource, timetableSubject: string): boolean {
  return reportSubject(src) === timetableSubject.trim();
}
