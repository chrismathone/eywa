import "server-only";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { readPageMaximized } from "../prefs";

/**
 * 내 '화면 최대화' 저장값 — 셸 레이아웃이 **첫 페인트 전에** 읽어 표식(`data-page-maximize`)을 서버 HTML에 싣는다
 * (클라에서 읽으면 사이드바가 잠깐 보였다 사라진다). `ui_prefs` 행은 '자주 방문한 메뉴'와 같은 요청 캐시를 쓴다(추가 왕복 0).
 */
export async function getMyPageMaximized(): Promise<boolean> {
  return readPageMaximized(await readMyUiPrefs());
}
