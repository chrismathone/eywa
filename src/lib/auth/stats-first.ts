import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SystemRole } from "@/lib/permissions";
import { getShellView } from "@/lib/auth/view-mode";
import { cameFromSamePage, isBareEntry, STATS_FIRST_ROLES } from "./stats-first-rule";

/**
 * 관리자·원장은 메뉴를 열면 **그 메뉴의 통계 화면이 먼저**(원장 2026-11-13 *"관리자들 원장급 들은 리스트 형식이 아니라 어떤 페이지를
 * 가도 해당 페이지의 통계 부분이 먼저 나오도록"*). 목록 화면 맨 앞(권한 확인 뒤)에서 부른다.
 * - 판정은 `stats-first-rule.ts` 한 곳 — 주소에 아무 값도 없을 때(= 메뉴로 열었을 때)만 보낸다. 필터·탭이 실린 링크(운영실 '상세',
 *   알림, 통계 화면의 '목록으로' = `list=1`)는 그대로 목록이다.
 * - 🔴 같은 목록 안에서 온 요청(필터를 '전체'로 되돌려 주소가 비었을 때 · 저장 뒤 새로고침)은 보내지 않는다 — 판별은 `referer`의
 *   경로(같은 출처의 지금 문서 주소). 없으면(새 탭·직접 입력) 메뉴로 연 것으로 본다.
 * - 강사뷰(겸직)로 보는 중이면 보내지 않는다 — 강사 화면은 종전 그대로.
 */
export async function prefersStatsFirst(role: SystemRole, sp: Record<string, unknown>, listPath: string): Promise<boolean> {
  if (!STATS_FIRST_ROLES.includes(role) || !isBareEntry(sp)) return false;
  if (cameFromSamePage((await headers()).get("referer"), listPath)) return false;
  return (await getShellView()) === "admin";
}

/** 위 판정이 맞으면 통계 화면으로 보낸다 — 창 안이면 `embed=1`을 싣는다([[#133]]). */
export async function redirectStatsFirst(role: SystemRole, sp: Record<string, unknown>, listPath: string): Promise<void> {
  if (!(await prefersStatsFirst(role, sp, listPath))) return;
  const statsPath = `${listPath}/stats`;
  const embed = sp.embed === "1" || (await headers()).get("x-embed") === "1";
  redirect(embed ? `${statsPath}?embed=1` : statsPath);
}
