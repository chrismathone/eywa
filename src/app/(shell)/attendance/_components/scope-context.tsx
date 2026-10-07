"use client";

import { createContext, useContext, useMemo } from "react";

/**
 * 출석부 **강사 전체 보기의 주인** — 어느 반이 그 강사 몫 교시만 세는 표로 그려졌나(page.tsx `teacherClasses`).
 *
 * 🔴 저장이 이걸 들고 가야 한다(원장 제보 2026-09-11 *"새로고침하면 강제로 어떤 숫자로 롤백"*): 칸은 그 강사 몫
 *    교시의 합만 보여 주는데, 스코프 없이 저장하면 서버가 그 합을 그날 모든 교시(자리 JJ·다른 선생님)에 나눠
 *    담아 다시 읽으면 숫자가 줄었다. 서버는 이 id로 **몫을 스스로 다시 판정**한다 — 클라는 "내 몫"을 보내지 않는다(#77).
 * ⚠️ 보강 묶음(0241a)은 강사 전체 보기에서도 **스코프 없이** 그려진다(page.tsx `makeupPoolMatrix`) — 그래서 반 목록으로 가린다.
 * ⚠️ `GridProvider`보다 바깥에 둔다(격자·팝오버가 둘 다 읽는다). 없으면 반별 보기 = 종전 저장 그대로.
 */
export type AttendanceScope = { teacherId: string; classIds: readonly string[] } | null;
export type ResolvedAttendanceScope = { teacherId: string; classIds: ReadonlySet<string> } | null;

const ScopeCtx = createContext<ResolvedAttendanceScope>(null);

export function AttendanceScopeProvider({ scope, children }: { scope: AttendanceScope; children: React.ReactNode }) {
  const teacherId = scope?.teacherId ?? null;
  // 서버가 새로고침마다 새 배열을 내려도 내용이 같으면 같은 값 — 격자 콜백이 헛돌지 않게.
  const key = scope ? scope.classIds.join(",") : "";
  const value = useMemo<ResolvedAttendanceScope>(
    () => (teacherId ? { teacherId, classIds: new Set(key ? key.split(",") : []) } : null),
    [teacherId, key],
  );
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

export function useAttendanceScope(): ResolvedAttendanceScope {
  return useContext(ScopeCtx);
}

/** 단건 저장에 실을 필드 — 이 반이 스코프 표로 그려졌을 때만. */
export function scopeFieldsFor(scope: ResolvedAttendanceScope, classId: string): { scopeTeacherId?: string } {
  return scope && scope.classIds.has(classId) ? { scopeTeacherId: scope.teacherId } : {};
}

/** 범위 저장에 실을 필드 — 범위 안의 스코프 반만 알린다(보강 묶음 칸은 반별 규칙 그대로). */
export function rangeScopeFields(
  scope: ResolvedAttendanceScope,
  classIds: readonly string[],
): { scopeTeacherId?: string; scopeClassIds?: string[] } {
  if (!scope) return {};
  const scoped = [...new Set(classIds)].filter((c) => scope.classIds.has(c));
  return scoped.length > 0 ? { scopeTeacherId: scope.teacherId, scopeClassIds: scoped } : {};
}
