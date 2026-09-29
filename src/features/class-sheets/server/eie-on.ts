import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";

/**
 * EiE 프로그램 구분(모듈)이 이 학원에 켜져 있나 — 꺼진 학원은 반에 `english_track='eie'`가 남아 있어도
 * EiE 전용 화면(월간 계획서 MP·EiE 교시 방식)을 세우지 않는다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
 * 설정은 테넌트 캐시 + 요청 캐시라 추가 왕복 없음.
 */
export async function eieModuleOn(): Promise<boolean> {
  return isModuleEnabled((await getTenantSettings()).modules.disabled, "eie");
}
