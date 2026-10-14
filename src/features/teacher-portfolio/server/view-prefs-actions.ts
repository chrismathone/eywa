"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";

/**
 * 직원 포트폴리오 **개인 보기 설정** — 항목별 내역의 '점수 기준' 상자를 접어 둘지(`users.ui_prefs.portfolio.ruleCollapsed`).
 * 원장 2026-10-14 *"접고 펼치기해서 컴팩트 가능하게"* · 모든 뷰 세팅은 계정 귀속(CLAUDE.md).
 * 🔴 감사로그 없음 — 내 화면이 어떻게 보이는지뿐이고 점수·집계는 이 값을 읽지 않는다(출석부 보기 설정과 같은 결).
 * 기본값(펼침)은 저장하지 않는다(키를 지운다).
 */
export async function saveRuleBoxCollapsed(collapsed: boolean): Promise<{ ok: boolean; error?: string }> {
  return patchMyUiPrefs("portfolio", { ruleCollapsed: collapsed ? true : undefined });
}
