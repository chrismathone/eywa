"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";
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
  // 화면 언어 — provider는 **강사 미니셸에만** 걸리므로 관리자 풀셸에서는 한국어로 떨어진다.
  const t = useSheetT();
  const visible = useNotifyBannerVisible();
  if (!visible) return null;

  return (
    <div className="border-primary/30 bg-primary-soft/50 flex shrink-0 items-center gap-2.5 border-b px-5 py-2 lg:px-7">
      <EyIcon name="bell" size={14} className="text-primary shrink-0" />
      {/* 🔴 굵은 조각과 설명 사이에 **공백을 명시**한다(`{" "}`) — 그전엔 JSX가 줄바꿈을 공백으로
          접어 주길 기대했는데 `<b>…</b>` 바로 뒤라 접히지 않아 "켜주세요.학부모가"로 붙어 있었다
          (원장 2026-09-03 제보). 뜻은 그대로고 공백 하나만 교정. */}
      <p className="text-foreground min-w-0 flex-1 text-xs leading-snug break-keep">
        <b>{t("banner.notify.title")}</b> {t("banner.notify.body")}
      </p>
      <Button size="sm" onClick={() => void enableDesktopNotify()} className="shrink-0">
        {t("banner.notify.enable")}
      </Button>
      <button
        type="button"
        onClick={dismissNotifyBanner}
        className="text-text-dim hover:text-foreground shrink-0 text-xs transition"
      >
        {t("banner.notify.later")}
      </button>
    </div>
  );
}
