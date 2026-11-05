import { Suspense, type ReactNode } from "react";
import { ExploreSkeleton } from "./_components/explore-skeleton";

/**
 * 연결 탐색의 뼈대 경계 — `loading.tsx`가 아니라 **레이아웃의 Suspense 하나**다(원장 2026-11-03 *"더블클릭하면 새로고침되는 것같이
 * 잠깐 … 페이지 내에서 부드럽게"*).
 * `loading.tsx`는 그 세그먼트마다 새 경계를 세워서, 종류가 바뀌는 전환(원생 → 수업 → 강사 · 영역 → 반)마다 뼈대가 다시 떴다
 * (같은 종류끼리만 옛 화면이 남았다 — dev 실측). 이 경계는 `[kind]` 위에서 한 번 마운트되므로 `startTransition` 안의 `router.push`가
 * 새 중심을 읽는 동안 **옛 화면(접힌 조각 · 가운데 원)이 그대로** 남고, 문서를 새로 열 때만 뼈대가 스트리밍된다(B7).
 * ⚠️ `explore/` 아래에 `loading.tsx`를 다시 두지 말 것 — 그 순간 전환마다 뼈대가 되살아난다.
 */
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ExploreSkeleton />}>{children}</Suspense>;
}
