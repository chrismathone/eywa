"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/aywa-icons";
import s from "./overview.module.css";

/**
 * 상세 내용은 포털에 띄워 카드와 같은 행의 높이가 변하지 않게 한다.
 * `trigger`를 주면 그 요소가 곧 트리거다(Base UI `render`) — 감싸는 줄·`+` 표식 없이, KPI 카드 몸통처럼
 * 카드 전체가 버튼이 되는 자리에 쓴다. 내용(`label`)은 그대로 자식으로 들어간다.
 */
export function DetailPopup({
  title,
  label,
  children,
  align = "start",
  plain = false,
  trigger,
  ariaLabel,
  wide = false,
}: {
  title: string;
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  plain?: boolean;
  /** 트리거로 쓸 요소(보통 `<button type="button" className=… />`). */
  trigger?: ReactElement;
  /** 트리거의 접근성 이름 — 기본은 `${title} 자세히 보기`. */
  ariaLabel?: string;
  /** 넓은 팝업 — 명단을 2단으로 펼치는 칸(운영실 퇴원 · 원장 2026-11-03 *"스크롤 길게 하지말고 2단으로"*). */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = (
    <DialogTrigger
      className={trigger ? undefined : s.detailButton}
      render={trigger}
      aria-label={ariaLabel ?? `${title} 자세히 보기`}
    >
      {!plain && !trigger && <span aria-hidden="true">+</span>}
      {label}
    </DialogTrigger>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        button
      ) : (
        <div
          className={
            plain ? s.noticeTrigger : align === "end" ? s.dataTrigger : s.details
          }
        >
          {button}
        </div>
      )}
      <DialogContent
        className={`flex max-h-[min(80dvh,720px)] flex-col gap-0 overflow-hidden p-0 ${wide ? s.detailPopupWide : "sm:max-w-xl"} ${s.detailPopup}`}
        showCloseButton={false}
      >
        <div className={s.popupHeader}>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose className={s.popupClose} aria-label="닫기">
            <EyIcon name="close" size={18} />
          </DialogClose>
        </div>
        <div
          className={wide ? `${s.popupBody} ${s.popupBodyWide}` : s.popupBody}
          onClickCapture={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("a[href]")
            )
              setOpen(false);
          }}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
