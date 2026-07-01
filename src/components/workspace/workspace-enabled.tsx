"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 이 셸에 워크스페이스(플로팅 창 캔버스, WorkspaceCanvas)가 존재하는지.
 * - 풀 셸(원장 등 12메뉴) = true — WindowLink/useOpenFormWindow가 클릭 시 플로팅 창을 연다.
 * - 강사·학생 미니멀 셸 = false — 캔버스가 없어 store.open()이 렌더 안 되는 "유령 창"만 만든다.
 *   false면 대신 일반 네비게이션(드릴인)해 상세 페이지를 그 셸 안에 그대로 연다.
 * 기본 true(풀 셸은 랩 불필요 · 안전 폴백). 미니멀 셸만 enabled={false}로 명시 랩한다.
 */
const WorkspaceEnabledCtx = createContext(true);

export function WorkspaceEnabledProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <WorkspaceEnabledCtx.Provider value={enabled}>{children}</WorkspaceEnabledCtx.Provider>;
}

export function useWorkspaceEnabled() {
  return useContext(WorkspaceEnabledCtx);
}
