import { listPopups } from "@/features/notices/server/queries";
import { PopupsManager } from "./popups-manager";

/**
 * 팝업 공지 관리 면(owner) — 셸 진입 시 창처럼 뜨는 공지(배너형)를 작성·수정·노출제어.
 * announcements(대시보드 카드)와 별개. 표시 dismiss("7일/다시 보지 않기")는 기기 단위(localStorage).
 * `canWrite` = 팝업 공지 액션과 같은 판정(`canWriteTenant(popup_settings)`) — page.tsx가 계산해 내린다.
 * 없으면 작성 양식과 줄마다의 영문·노출·수정·삭제 단추를 그리지 않는다(원장 2026-11-05).
 */
export async function PopupsFace({ canWrite }: { canWrite: boolean }) {
  const items = await listPopups();
  return <PopupsManager items={items} canWrite={canWrite} />;
}
