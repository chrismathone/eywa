"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { buildSubjectMaps, type SubjectMaps } from "./subjects";
import { jobTitlesForDepartment } from "@/features/staff/department-job-titles";
import type { SubjectSetting } from "./settings-types";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";

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
  jobTitles: string[];
  jobTitlesByDepartment: Record<string, string[]>;
  disabledModules: readonly ModuleId[];
  licenses: Partial<Record<LicenseKey, boolean>>;
};

const Ctx = createContext<OperationsCtx | null>(null);

export function OperationsProvider({
  subjects,
  gradeLevels,
  jobTitles = [],
  jobTitlesByDepartment = {},
  disabledModules = NO_MODULES,
  licenses = NO_LICENSES,
  children,
}: {
  subjects: SubjectSetting[];
  gradeLevels: string[];
  jobTitles?: string[];
  jobTitlesByDepartment?: Record<string, string[]>;
  /** 꺼진 기능(모듈) — `useModuleOn`이 읽는다. 꺼진 기능의 버튼·칸·문구를 클라 화면에서 감출 때(2026-09-30 "꺼지면 흔적 없이"). */
  disabledModules?: readonly ModuleId[];
  /** 지점 라이선스(슈퍼관리자) — `useLicenseOn`이 읽는다. 꺼진 라이선스의 버튼·탭을 감출 때. */
  licenses?: Partial<Record<LicenseKey, boolean>>;
  children: ReactNode;
}) {
  const value = useMemo<OperationsCtx>(
    () => ({ subjects: buildSubjectMaps(subjects), gradeLevels, jobTitles, jobTitlesByDepartment, disabledModules, licenses }),
    [subjects, gradeLevels, jobTitles, jobTitlesByDepartment, disabledModules, licenses],
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

/**
 * 그 근무부서의 직급 선택지(operations.jobTitlesByDepartment → 없으면 공통 jobTitles).
 * 부서를 바꾸면 직급 드롭다운이 따라 바뀐다 — 목록은 학원설정이 단일 소스.
 */
export function useJobTitles(department: string): string[] {
  const ctx = useContext(Ctx);
  return jobTitlesForDepartment(department, ctx?.jobTitlesByDepartment, ctx?.jobTitles ?? []);
}

/**
 * 부서 → 직급 목록 함수. 부서를 **바꾸는 순간**(onChange 안에서) 새 부서의 직급을 계산해야 할 때 쓴다
 * — effect에서 setState 하는 패턴은 금지라([[#25]]) 핸들러에서 바로 계산해 넣는다.
 */
export function useJobTitleResolver(): (department: string) => string[] {
  const ctx = useContext(Ctx);
  return useCallback(
    (department: string) => jobTitlesForDepartment(department, ctx?.jobTitlesByDepartment, ctx?.jobTitles ?? []),
    [ctx],
  );
}

/**
 * 이 학원에 그 기능(모듈)이 켜져 있나 — 클라 컴포넌트가 prop 배선 없이 읽는다(서버는 `isModuleEnabled(getTenantSettings…)`).
 * 프로바이더 밖이면 **켜짐**(종전 그대로 — 침산과 같은 쪽). 게이트가 아니라 표시용이다: 서버 액션은 따로 모듈을 본다.
 */
export function useModuleOn(id: ModuleId): boolean {
  return isModuleEnabled(useContext(Ctx)?.disabledModules, id);
}

/**
 * 이 지점에 그 라이선스가 켜져 있나 — 표시용(서버 경로는 따로 막는다). 모르면(프로바이더 밖·값 없음) **켜짐**.
 */
export function useLicenseOn(feature: LicenseKey): boolean {
  return useContext(Ctx)?.licenses[feature] !== false;
}

/** 라이선스 키(클라 공용 — `server-only` 모듈의 타입을 끌어오지 않으려고 여기 둔다. rule.ts `LicensedFeature`와 같은 값). */
type LicenseKey = "ai_analysis" | "google_sheets" | "meeting_recording" | "window_mode";
const NO_LICENSES: Partial<Record<LicenseKey, boolean>> = {};
const NO_MODULES: readonly ModuleId[] = [];
const EMPTY_SUBJECTS = buildSubjectMaps([]);
