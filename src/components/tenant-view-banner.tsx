import { EyIcon } from "@/components/icons/aywa-icons";
import { HideInFrame } from "@/components/workspace/hide-in-frame";
import { TENANT_VIEW_EXIT_PATH } from "@/lib/auth/tenant-view-shared";

/**
 * '읽기 전용 보기' 표시 줄 — 운영 콘솔에서 이 지점의 화면을 열었을 때만 선다(평소엔 그려지지 않는다).
 *
 * 어느 지점을 보고 있는지와 저장이 안 된다는 사실을 화면 맨 위에 늘 두고, 끝내는 문도 여기 하나다.
 * 창(iframe) 안에서는 감춘다 — 바깥 셸의 줄 하나면 된다.
 *
 * 🔴 '보기 끝내기'는 `<Link>`가 아니라 `<a>`다 — 미리 불러오면(prefetch) 그 요청만으로 보기가 끝난다.
 */
export function TenantViewBanner({ tenantName }: { tenantName: string }) {
  return (
    <HideInFrame>
      <div
        role="status"
        className="bg-amber-soft text-amber flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm font-bold desk:px-6 print:hidden"
      >
        <EyIcon name="lock" size={16} strokeWidth={1.8} className="shrink-0" />
        <span className="break-keep">읽기 전용 보기 · {tenantName}</span>
        <span className="text-xs font-medium break-keep">저장·발송은 되지 않습니다</span>
        {/* 🔴 <Link>로 바꾸지 말 것 — 라우트 핸들러(보기 끝내기)라 미리 불러오면 그 요청만으로 보기가 끝난다. */}
        <a href={TENANT_VIEW_EXIT_PATH} className="ml-auto shrink-0 underline underline-offset-2">
          보기 끝내기
        </a>
      </div>
    </HideInFrame>
  );
}
