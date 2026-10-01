import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenDraft } from "./_server/access";

/**
 * 역할별 운영실 시안 게이트 — **loading.tsx(Suspense) 앞**에서 막는다(`dashboard/layout.tsx`와 같은 이유, gotchas #137).
 * 페이지 안에서만 막으면 스트림이 흐르기 시작한 뒤라 응답 코드가 200이 되고, 실제 데이터를 읽는 이 화면은
 * 그 전에 문서 요청 자체가 404여야 한다. 페이지도 읽기 전에 같은 함수를 한 번 더 부른다(이중 게이트 — 지우지 말 것).
 */
export default async function DashboardRoleDraftsLayout({ children }: { children: ReactNode }) {
  if (!(await canOpenDraft())) notFound();
  return children;
}
