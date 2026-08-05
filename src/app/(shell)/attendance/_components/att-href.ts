/**
 * /attendance 링크 빌더 — page.tsx와 바로 열기 패널이 함께 쓴다.
 *
 * ⚠️ 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것(#81).
 * 클라 모듈의 상수를 서버가 import하면 런타임에 undefined인데 타입체크는 통과하는 침묵 버그가 나고,
 * server-only를 붙이면 순수 함수로서의 Vitest 실행이 막힌다. 평범한 모듈로 둔다.
 */

export type RangeKey = "month" | "2w";

/**
 * 보기 모드 — `class`(반 하나) 기본, `teacher`(그 강사의 모든 반을 반별 그룹으로 한 표에, 급여 계산용).
 * ⚠️ teacher 모드는 강사 선택이 있어야 성립한다(없으면 호출부가 반별로 되돌린다).
 */
export type ViewMode = "class" | "teacher";

/**
 * 기본 보기 결정 — **강사는 자기 전체 시트로 바로**, 관리자는 반 선택 허브.
 *
 * 🔴 URL에 적힌 뜻이 언제나 이긴다. `mode=class`를 무시하면 강사가 '반별'을 눌러도 기본값이 다시
 *    전체로 되돌려 **탈출구가 죽는다**(그래서 attHref는 class도 명시적으로 적는다).
 * ⚠️ `class=`가 박힌 링크(원스크린·바로 열기·수업 상세)는 그 반만 여는 게 맞다 — 기본값을 얹지 않는다.
 */
export function resolveViewMode(p: {
  modeParam?: string;
  classParam?: string;
  /** 강사 또는 겸직 강사뷰(= effectiveTeacherId가 있음). */
  isTeacher: boolean;
}): ViewMode {
  if (p.modeParam === "teacher") return "teacher";
  if (p.modeParam === "class") return "class";
  return p.isTeacher && !p.classParam ? "teacher" : "class";
}

export function attHref(p: {
  classId: string | null;
  month: string;
  range: RangeKey;
  teacherId?: string | null;
  subjectId?: string | null;
  mode?: ViewMode;
}): string {
  const sp = new URLSearchParams();
  if (p.subjectId) sp.set("subject", p.subjectId);
  if (p.teacherId) sp.set("teacher", p.teacherId);
  if (p.classId) sp.set("class", p.classId);
  sp.set("month", p.month);
  if (p.range === "2w") sp.set("range", "2w");
  // 🔴 `class`도 **적어야** 한다. 강사의 기본 보기가 '전체'라, mode를 안 적으면 '반별' 링크가
  //    기본값에 먹혀 그대로 전체로 되돌아온다(= 반별로 갈 방법이 사라진다).
  if (p.mode) sp.set("mode", p.mode);
  return `/attendance?${sp.toString()}`;
}
