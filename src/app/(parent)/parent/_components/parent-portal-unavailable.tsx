import { signOut } from "@/app/(auth)/login/actions";
import {
  PARENT_PORTAL_RETRY_MESSAGE,
  PARENT_PORTAL_UNAVAILABLE_MESSAGE,
  type ParentPortalState,
} from "@/features/shuttle/parent/server/parent-availability";

/**
 * 학부모 포털 종착 화면 — 꺼진 기능의 이름을 말하지 않고 로그아웃만 둔다(`/home`이 학부모를 다시 `/parent`로 보내므로
 * 홈·로그인으로 돌리면 순환한다). 레이아웃과 각 페이지가 같은 부품을 그린다 — 화면을 연 채로 기능이 꺼지면 탭 이동에는
 * 레이아웃이 다시 그려지지 않으므로 페이지가 빈 본문 대신 이 안내를 그린다(검토 2026-11-12).
 * 설정을 확인하지 못한 일시 실패는 '이용할 화면 없음'이 아니라 다시 시도 안내로 말한다.
 */
export function ParentPortalUnavailable({ state }: { state: ParentPortalState }) {
  return (
    <main className="bg-card flex flex-col items-center gap-5 rounded-2xl px-6 py-10 text-center shadow-[var(--shadow-card)]">
      <h1 className="text-lg font-bold break-keep">
        {state === "unknown" ? PARENT_PORTAL_RETRY_MESSAGE : PARENT_PORTAL_UNAVAILABLE_MESSAGE}
      </h1>
      <form action={signOut}>
        <button type="submit" className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-bold">
          로그아웃
        </button>
      </form>
    </main>
  );
}
