import type { ReactNode } from "react";
import { getMyPageMaximized } from "@/features/page-maximize/server/queries";
import { PageMaximizeRoot } from "./page-maximize-root";

/**
 * 관리자 풀셸을 감싸는 서버 껍데기 — 계정에 저장된 '화면 최대화'를 **서버에서** 읽어 첫 HTML에 싣는다
 * (클라에서 읽으면 사이드바가 잠깐 보였다 사라진다). 셸 레이아웃엔 이 감싸기 한 겹만 둔다(레이아웃에 로직을 늘리지 않게).
 * 조회는 '자주 방문한 메뉴'와 같은 요청 캐시(`readMyUiPrefs`)라 왕복이 늘지 않는다.
 */
export async function PageMaximizeShell({ children }: { children: ReactNode }) {
  return <PageMaximizeRoot initial={await getMyPageMaximized()}>{children}</PageMaximizeRoot>;
}
