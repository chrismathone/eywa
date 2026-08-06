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
 * 기본 보기 결정 — **강사는 자기 전체 시트로 바로**, 관리자는 반 선택 허브.
 *
 * 🔴 **강사에겐 `mode`가 없다**(원장 지시 2026-08-06: "반별 → 드롭다운 리스트로"). 반 선택은 툴바의
 *    반 드롭다운 **하나**가 맡는다 — 반을 고르면 그 반, '전체 반'이면 자기 전체 시트. 예전엔 '반별' 버튼이
 *    반 미선택 상태(=사진 허브)로 보냈는데, 자기 반 대여섯 개를 아는 강사에게 큰 사진 허브는 한 단계 낭비였다.
 *    ⚠️ 그래서 여기서 `modeParam`을 보면 안 된다 — URL에 `mode=teacher`가 남아 있을 때 드롭다운으로 반을
 *    골라도 그 반이 안 열린다(반 선택이 먹히지 않는 버그).
 * ⚠️ 관리자는 종전대로 — `mode`가 뜻을 정하고, 반 미선택은 허브다(반 108개를 한 번에 열지 않는 렉 방지).
 */
export function resolveViewMode(p: {
  modeParam?: string;
  classParam?: string;
  /** 강사 또는 겸직 강사뷰(= effectiveTeacherId가 있음). */
  isTeacher: boolean;
}): ViewMode {
  if (p.isTeacher) return p.classParam ? "class" : "teacher";
  if (p.modeParam === "teacher") return "teacher";
  return "class";
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
}): string {
  const sp = new URLSearchParams();
  if (p.subjectId) sp.set("subject", p.subjectId);
  if (p.teacherId) sp.set("teacher", p.teacherId);
  if (p.classId) sp.set("class", p.classId);
  sp.set("month", p.month);
  // 🔴 `class`도 **적어야** 한다. 강사의 기본 보기가 '전체'라, mode를 안 적으면 '반별' 링크가
  //    기본값에 먹혀 그대로 전체로 되돌아온다(= 반별로 갈 방법이 사라진다).
  if (p.mode) sp.set("mode", p.mode);
  return `/attendance?${sp.toString()}`;
}
