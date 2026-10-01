"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * 이 셸에 워크스페이스(플로팅 창 캔버스, WorkspaceCanvas)가 존재하는지.
 * - 풀 셸(원장 등 12메뉴) = true — WindowLink/useOpenFormWindow가 클릭 시 플로팅 창을 연다.
 * - 강사·학생 미니멀 셸 = false — 캔버스가 없어 store.open()이 렌더 안 되는 "유령 창"만 만든다.
 *   false면 대신 일반 네비게이션(드릴인)해 상세 페이지를 그 셸 안에 그대로 연다.
 * 기본 true(풀 셸은 랩 불필요 · 안전 폴백). 미니멀 셸만 enabled={false}로 명시 랩한다.
 *
 * 🔴 **문서 하나 동안 고정**(처음 받은 값) — 풀셸의 값은 지점 화면 방식(창 모드를 끄면 false)이라, 슈퍼관리자가 방식을 바꾼 뒤 바탕이 다시
 *    그려지면(`router.refresh`·재검증 액션) 도중에 뒤집혀 캔버스가 사라지고 **열려 있던 창(iframe)이 입력·녹음째 말없이 파괴**됐다(적대 재리뷰).
 *    바뀐 방식은 다음에 페이지를 열 때 적용된다 — `ShellModeProvider`와 같은 규칙(decisions/shell.md '화면 방식은 셋').
 */
const WorkspaceEnabledCtx = createContext(true);

export function WorkspaceEnabledProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [frozen] = useState(enabled);
  return <WorkspaceEnabledCtx.Provider value={frozen}>{children}</WorkspaceEnabledCtx.Provider>;
}

export function useWorkspaceEnabled() {
  return useContext(WorkspaceEnabledCtx);
}
