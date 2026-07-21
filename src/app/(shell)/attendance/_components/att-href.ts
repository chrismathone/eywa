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
  if (p.mode === "teacher") sp.set("mode", "teacher");
  return `/attendance?${sp.toString()}`;
}
