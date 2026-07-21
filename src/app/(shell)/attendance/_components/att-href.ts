/**
 * /attendance 링크 빌더 — page.tsx와 바로 열기 패널이 함께 쓴다.
 *
 * ⚠️ 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것(#81).
 * 클라 모듈의 상수를 서버가 import하면 런타임에 undefined인데 타입체크는 통과하는 침묵 버그가 나고,
 * server-only를 붙이면 순수 함수로서의 Vitest 실행이 막힌다. 평범한 모듈로 둔다.
 */

export type RangeKey = "month" | "2w";

export function attHref(p: {
  classId: string | null;
  month: string;
  range: RangeKey;
  teacherId?: string | null;
  subjectId?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (p.subjectId) sp.set("subject", p.subjectId);
  if (p.teacherId) sp.set("teacher", p.teacherId);
  if (p.classId) sp.set("class", p.classId);
  sp.set("month", p.month);
  if (p.range === "2w") sp.set("range", "2w");
  return `/attendance?${sp.toString()}`;
}
