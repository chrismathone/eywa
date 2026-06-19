"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { buildSubjectMaps, type SubjectMaps } from "./subjects";
import type { SubjectSetting } from "./settings-types";

/**
 * 운영체계(operations) enum의 **클라이언트 단일 소스**.
 * (shell) 레이아웃이 getTenantSettings()로 읽은 operations.subjects/gradeLevels를 직렬화 가능한 형태로
 * 주입하면, 'use client' 컴포넌트가 부모 prop 배선 없이 useSubjectMaps()/useGradeLevels()로 읽는다.
 * 서버 컴포넌트는 이 컨텍스트를 쓰지 말고 getTenantSettings()+buildSubjectMaps()를 직접 호출할 것.
 *
 * ⚠️ 과목 라벨·색·옵션을 코드에 하드코딩하지 말 것(SUBJECT_META/SUBJECT_LABEL/SUBJECT_COLOR 등 금지) —
 *    설정에 없는 과목이 새거나(예: '예술') 설정 변경이 화면에 반영되지 않는 "설정 무시" 버그의 원인.
 */
type OperationsCtx = {
  subjects: SubjectMaps;
  gradeLevels: string[];
};

const Ctx = createContext<OperationsCtx | null>(null);

export function OperationsProvider({
  subjects,
  gradeLevels,
  children,
}: {
  subjects: SubjectSetting[];
  gradeLevels: string[];
  children: ReactNode;
}) {
  const value = useMemo<OperationsCtx>(
    () => ({ subjects: buildSubjectMaps(subjects), gradeLevels }),
    [subjects, gradeLevels],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 과목 라벨·색·옵션 맵(buildSubjectMaps). 프로바이더 밖이면 빈 설정 폴백(레거시 라벨만). */
export function useSubjectMaps(): SubjectMaps {
  const ctx = useContext(Ctx);
  return ctx?.subjects ?? EMPTY_SUBJECTS;
}

/** 학년 체계(operations.gradeLevels). 프로바이더 밖이면 빈 배열. */
export function useGradeLevels(): string[] {
  return useContext(Ctx)?.gradeLevels ?? [];
}

const EMPTY_SUBJECTS = buildSubjectMaps([]);
