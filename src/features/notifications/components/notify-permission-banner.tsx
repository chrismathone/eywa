"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import {
  dismissNotifyBanner,
  enableDesktopNotify,
  useNotifyBannerVisible,
} from "../notify-permission-store";

/**
 * 컴퓨터(OS) 알림 **선제 안내 배너** — 권한 미설정(default) 강사에게만 노출.
 *
 * 왜 필요: 브라우저는 사용자가 **허용**을 눌러야만 창 밖 알림을 띄운다. 안내가 없으면 강사는 권한이
 * 꺼진 줄도 모른 채 "왜 알림이 안 와?" 상태로 학부모 글을 놓친다(원장 2026-07-15: "이 부분 안내가 꼭 필요").
 * 중앙 팝업 안 안내는 **이미 알림이 온 뒤**라 첫 건은 못 살린다 → 그 전에 켜게 하는 게 이 배너의 역할.
 *
 * 노출 판정은 전부 스토어(useSyncExternalStore) — 허용/차단되거나 '나중에'를 누르면 스스로 사라진다.
 */
export function NotifyPermissionBanner() {
  const visible = useNotifyBannerVisible();
  if (!visible) return null;

  return (
    <div className="border-primary/30 bg-primary-soft/50 flex shrink-0 items-center gap-2.5 border-b px-5 py-2 lg:px-7">
      <EyIcon name="bell" size={14} className="text-primary shrink-0" />
      <p className="text-foreground min-w-0 flex-1 text-xs leading-snug break-keep">
        <b>컴퓨터 알림을 켜주세요.</b> 학부모가 클래스노트에 새 글을 올리면 eywa 화면을 보고 있지 않아도 바로
        알려드립니다. (브라우저가 물어보면 &lsquo;허용&rsquo;)
      </p>
      <Button size="sm" onClick={() => void enableDesktopNotify()} className="shrink-0">
        켜기
      </Button>
      <button
        type="button"
        onClick={dismissNotifyBanner}
        className="text-text-dim hover:text-foreground shrink-0 text-xs transition"
      >
        나중에
      </button>
    </div>
  );
}
