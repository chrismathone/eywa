import type { ReactNode } from "react";
import { SheetLangProvider } from "@/features/class-sheets/lang-context";
import { getEcsLang } from "@/features/class-sheets/server/lang";

/**
 * ECS 전용 레이아웃 — 하는 일은 **화면 언어를 트리에 흘려보내는 것 하나**뿐이다
 * (원장 2026-09-03 *"강사뷰 화면을 영어/한글 전환할 수 있도록 원어민 전용뷰 세팅 (영어강사 기준)"*).
 *
 * 🔑 여기 두는 이유: `/ecs`(랜딩·오늘·305) · `/ecs/[classId]`(주간) · `/ecs/[classId]/month`(월간)가
 *    **한 번에** 덮인다. 화면마다 provider를 두면 새 면을 만들 때 빠뜨려서 그 화면만 한글로 남는다.
 * 🔴 **`/mcs`(수학 시트)는 이 레이아웃 밖이다** — 공용 조각(`SheetClassPicker`)이 MCS에서도 쓰이지만
 *    provider가 없어 기본값(한국어)으로 떨어진다. 의도한 범위다(원장 지시 기준 = 영어 강사).
 *
 * ⚠️ **첫 페인트를 붙잡지 않는다**: `getEcsLang`은 `getCurrentUser()`(요청 캐시 — 어차피 아래
 *    `requireAccess`가 부른다) + `ui_prefs` 단일 행 select 1회다. 여기에 무거운 조회를 더하지 말 것 —
 *    이 레이아웃은 ECS의 **모든** 라우트보다 먼저 돌고, 늦어지면 `loading.tsx` 스켈레톤조차 늦게 뜬다(B7).
 * ⚠️ 권한 게이트를 여기로 올리지 말 것 — 페이지마다 `requireAccess("ecs")`/`requireEcsClassAccess`가
 *    이미 있고, 게이트가 두 곳이면 한쪽만 고쳐지는 날이 온다(#77의 반대 방향 사고).
 */
export default async function EcsLayout({ children }: { children: ReactNode }) {
  const lang = await getEcsLang();
  return <SheetLangProvider lang={lang}>{children}</SheetLangProvider>;
}
