/**
 * /attendance 링크 빌더 — page.tsx와 바로 열기 패널이 함께 쓴다.
 *
 * ⚠️ 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것(#81).
 * 클라 모듈의 상수를 서버가 import하면 런타임에 undefined인데 타입체크는 통과하는 침묵 버그가 나고,
 * server-only를 붙이면 순수 함수로서의 Vitest 실행이 막힌다. 평범한 모듈로 둔다.
 */

/**
 * 보기 모드 — `class`(반 하나) 기본, `teacher`(그 강사의 모든 반을 반별 그룹으로 한 표에, 급여 계산용).
 * ⚠️ teacher 모드는 강사 선택이 있어야 성립한다(없으면 호출부가 반별로 되돌린다).
 */
export type ViewMode = "class" | "teacher";

/**
 * 기본 보기 결정 — **모두 강사 전체가 기본**, 반을 골랐을 때만 반별.
 *
 * 🔴 **반이 정해졌으면 누구든 그 반이다**(원장 버그 제보 2026-08-10: 옛 관리자 분기가 `mode`만 봐서,
 *    강사 전체 보기 URL에 `mode=teacher`가 남은 채 반 드롭다운으로 반을 골라도 강사 전체에 갇혔다).
 *    ⚠️ 호출부는 raw param이 아니라 **검증된 반**(effectiveClassId)을 넘겨야 한다 — 강사를 바꾸면 이전
 *    강사의 반이 URL에 남는데(FilterSelect는 다른 param을 보존), 그 죽은 값으로 반별에 갇히면 안 된다.
 * 🔴 관리자 기본 = **강사 전체**(원장 지시 2026-08-10: "디폴트를 강사전체. 김윤하 선생님 고르면 바로
 *    강사 전체 출석부로"). 명시적 '반별'(mode=class)만 반별. 강사 미선택이면 호출부가 요약 허브로 되돌린다.
 * 🔴 강사에겐 여전히 `mode`가 없다(2026-08-06: "반별 → 드롭다운 리스트로") — 반 드롭다운 하나가 반 선택을
 *    맡고, '전체 반'은 자기 전체 시트다.
 */
export function resolveViewMode(p: {
  modeParam?: string;
  /** ⚠️ 검증된 반(effectiveClassId) — raw URL param을 넣지 말 것(위 🔴). */
  classParam?: string;
  /** 강사 또는 겸직 강사뷰(= effectiveTeacherId가 있음). */
  isTeacher: boolean;
}): ViewMode {
  if (p.classParam) return "class";
  if (p.isTeacher) return "teacher";
  return p.modeParam === "class" ? "class" : "teacher";
}

/**
 * ⚠️ 범위(한 달/2주)는 **폐기됐다**(원장 지시 2026-08-06: "범위 2주 제거 — 오직 그달의 출석부 전체").
 * 출석부는 언제나 그 달 전체(31칸 고정)다. `range` 파라미터를 되살리지 말 것.
 */
export function attHref(p: {
  classId: string | null;
  month: string;
  teacherId?: string | null;
  subjectId?: string | null;
  mode?: ViewMode;
  /**
   * **학생 검색 씨앗**(2026-08-20) — 이 링크로 열면 시트 검색이 그 말로 채워진 채 열린다
   * (허브에서 학생을 찾아 그 학생 줄만 남은 출석부로 바로 들어가는 동선).
   *
   * 🔴 **저장이 아니라 씨앗이다** — `ui_prefs`에 남지 않고, 화면에서 검색어를 바꾸는 순간 URL에서
   *    떨어진다(search-context.tsx). 그냥 `/attendance`를 열면 검색은 비어 있다.
   * ⚠️ 빈 문자열·공백은 아예 안 적는다(빈 `q=`가 남으면 "검색 중"으로 오해된다).
   * 🔴 **서버가 렌더해 두는 링크(월 이동·'반별/강사 전체' 토글)엔 씨앗을 싣지 말 것.** 그 href는 첫
   *    렌더에 굳는데 화면의 검색어는 그 뒤에도 바뀌므로, 실으면 **옛 검색어로 되돌아간다**(검색이 풀리는
   *    것보다 나쁘다). 검색어를 이어 가는 건 클릭 시점의 주소를 읽는 `FilterSelect`(과목·강사·반) 몫이다.
   */
  q?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (p.subjectId) sp.set("subject", p.subjectId);
  if (p.teacherId) sp.set("teacher", p.teacherId);
  if (p.classId) sp.set("class", p.classId);
  sp.set("month", p.month);
  // 🔴 `class`도 **적어야** 한다. 강사의 기본 보기가 '전체'라, mode를 안 적으면 '반별' 링크가
  //    기본값에 먹혀 그대로 전체로 되돌아온다(= 반별로 갈 방법이 사라진다).
  if (p.mode) sp.set("mode", p.mode);
  if (p.q?.trim()) sp.set("q", p.q.trim());
  return `/attendance?${sp.toString()}`;
}
