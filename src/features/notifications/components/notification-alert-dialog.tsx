"use client";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { NOTIFICATION_ICON, type NotificationItem } from "@/features/notifications/types";
import type { NotifyPermission } from "@/features/notifications/desktop-notify";

/**
 * 중요 알림 **화면 중앙 팝업** — 우상단 벨만으로는 강사가 지나쳐서(원장 2026-07-15) 확실히 보이게 가운데로.
 * 대상은 `important.ts`의 중요 유형만(수업 중 방해 최소화 — 모든 알림을 띄우지 않는다).
 * 한 알림당 1회만 뜬다(벨이 alerted id를 localStorage로 관리) → 닫아도 벨에는 안 읽음으로 남는다.
 */
export function NotificationAlertDialog({
  item,
  extraCount,
  perm,
  onEnableDesktop,
  onClose,
  onOpenItem,
}: {
  item: NotificationItem | null; // null이면 닫힘
  extraCount: number; // 이 건 말고 함께 도착한 중요 알림 수(0이면 미표시)
  perm: NotifyPermission; // 컴퓨터 알림 권한 — 미허용이면 이 팝업에서 바로 켤 수 있게 안내
  onEnableDesktop: () => void;
  onClose: () => void;
  onOpenItem: (n: NotificationItem) => void;
}) {
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="bg-primary-soft text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
              <EyIcon name={(item && NOTIFICATION_ICON[item.type]) ?? "bell"} size={17} />
            </span>
            <span className="break-keep">{item?.title ?? ""}</span>
          </DialogTitle>
          {item?.body ? (
            <DialogDescription className="text-foreground pt-1 text-sm leading-relaxed break-keep">
              {item.body}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {extraCount > 0 ? (
          <p className="text-text-dim text-xs">외 {extraCount}건의 새 알림이 더 있습니다(벨에서 확인).</p>
        ) : null}

        {/* 컴퓨터 알림 안내 — 이 팝업은 aywa 화면을 볼 때만 보인다. 권한을 켜야 **다른 창을 보고 있어도**
            윈도우 알림으로 뜬다. 실제 알림이 온 지금이 켜기를 안내할 가장 좋은 순간(원장 2026-07-15). */}
        {perm === "default" ? (
          <div className="border-primary/30 bg-primary-soft/40 rounded-md border px-3 py-2.5">
            <p className="text-foreground text-xs leading-relaxed break-keep">
              <b>컴퓨터 알림을 켜면</b> aywa를 보고 있지 않아도 이런 알림을 윈도우 알림으로 바로 받습니다.
            </p>
            <Button size="sm" className="mt-2 w-full" onClick={onEnableDesktop}>
              <EyIcon name="bell" size={13} /> 컴퓨터 알림 켜기
            </Button>
            <p className="text-text-faint mt-1.5 text-xs leading-snug break-keep">
              브라우저가 &lsquo;알림 허용&rsquo;을 물어보면 <b>허용</b>을 눌러주세요.
            </p>
          </div>
        ) : perm === "denied" ? (
          <p className="text-text-faint border-line rounded-md border px-3 py-2 text-xs leading-snug break-keep">
            컴퓨터 알림이 차단돼 있어 aywa 화면을 볼 때만 알림이 보입니다 — 주소창의 자물쇠 &gt; 알림에서
            &lsquo;허용&rsquo;으로 바꾸면 윈도우 알림으로도 받습니다.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            나중에
          </Button>
          {item?.link ? (
            <Button
              onClick={() => {
                onOpenItem(item);
                onClose();
              }}
            >
              바로 가기
            </Button>
          ) : (
            <Button onClick={onClose}>확인</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
