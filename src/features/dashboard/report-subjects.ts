/**
 * 운영실 **수업보고서 신호가 셀 과목** — 순수 함수(Vitest).
 *
 * 원장 2026-08-29: *"영어보고서는 운영실에서 제외"*.
 *
 * 🔴 **영어는 안 쓴 게 아니라 다른 데 쓴다.** 영어 강사는 eywa가 아니라 ClassNote에 직접 알림장을
 *    쓴다(실측 2026-08-29: 최근 30일 `lesson_reports` 1,666건이 **전부 수학**, 영어 0건). 그래서
 *    영어를 세면 **매일 140명이 '미작성'** 으로 잡히고, 진짜 미작성인 수학 32명이 그 안에 묻힌다.
 *    8/28 하루 실측 = 영어 수업 학생 140명·보고서 0건 / 수학 95명·63건.
 *
 * 🔑 축은 하드코딩이 아니라 학원설정 **`report.classnoteSubjects`**(현 운영 `['math']`)다 —
 *    "eywa에서 보고서를 쓰고 내보내는 과목" 목록이 이미 거기 있고 원장이 화면에서 고친다.
 *    영어를 eywa로 옮기게 되면 그 목록에 넣는 것만으로 이 신호가 따라온다.
 *
 * ⚠️ 발송 게이트 [`isClassnoteSubjectEnabled`](../onescreen/classnote-guard.ts)를 그대로 쓰지 않는다 —
 *    그쪽은 **fail-closed**(목록이 비면 아무것도 못 보낸다)라 옳지만, 집계에 쓰면 설정이 비는 순간
 *    신호가 **조용히 사라진다**("오늘 미작성 0명"은 거짓 안심이다). 집계는 fail-open이 맞다.
 */

/**
 * 이 과목의 보고서를 운영실이 세는가.
 *
 * 목록이 비어 있으면(미설정·조회 실패) **전부 센다** — 지금까지의 동작이고, 조용한 신호 소멸보다
 * 과하게 세는 쪽이 안전하다.
 */
export function isReportTrackedSubject(
  subject: string | null | undefined,
  configured: readonly string[] | null | undefined,
): boolean {
  const tracked = (configured ?? []).map((s) => String(s ?? "").trim()).filter(Boolean);
  if (tracked.length === 0) return true;
  return !!subject && tracked.includes(subject.trim());
}
