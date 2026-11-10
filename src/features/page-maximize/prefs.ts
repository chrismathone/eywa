import { isRecord } from "@/lib/guards";
/**
 * 화면 최대화(원장 2026-10-01) — 계정 귀속 보기 설정 `users.ui_prefs.shell.maximized`.
 *
 * 원장: *"내부를 최대화 할 수 있도록 전체 페이지에 최대화 버튼 추가. 최대화 버튼을 누르면 왼쪽 탭 및 상단 빈공간
 * 여백 헤더를 숨겨버리고 내부 탭 화면만"* → *"'화면 최대화'로 이름 변경. 후에 '화면 원래대로' 버튼을 눌러야 돌아옴"*.
 *
 * - **전 페이지 공통 한 키**다 — 메뉴마다 따로 두지 않는다(최대화한 채 다른 메뉴로 가도 그대로, 원장 지시).
 * - 기본값(꺼짐)은 저장하지 않는다(`patchMyUiPrefs`가 `undefined`를 키 삭제로 처리).
 * - 🔴 이 파일엔 `"use client"`도 `import "server-only"`도 붙이지 말 것 — 서버(셸 레이아웃)와 테스트가 같이 읽는다([[#61]]·[[#81]]).
 */
export const PAGE_MAXIMIZE_NS = "shell";
export const PAGE_MAXIMIZE_KEY = "maximized";


/** `users.ui_prefs` 원본 → 최대화 여부. 모양이 다르면(없거나 깨졌으면) 꺼짐. */
export function readPageMaximized(uiPrefs: unknown): boolean {
  if (!isRecord(uiPrefs)) return false;
  const ns = uiPrefs[PAGE_MAXIMIZE_NS];
  return isRecord(ns) && ns[PAGE_MAXIMIZE_KEY] === true;
}
