"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EyIcon } from "@/components/icons/eywa-icons";
import s from "./overview.module.css";

/** 상세 내용은 포털에 띄워 카드와 같은 행의 높이가 변하지 않게 한다. */
export function DetailPopup({
  title,
  label,
  children,
  align = "start",
  plain = false,
}: {
  title: string;
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div
        className={
          plain ? s.noticeTrigger : align === "end" ? s.dataTrigger : s.details
        }
      >
        <DialogTrigger
          className={s.detailButton}
          aria-label={`${title} 자세히 보기`}
        >
          {!plain && <span aria-hidden="true">+</span>}
          {label}
        </DialogTrigger>
      </div>
      <DialogContent
        className={`flex max-h-[min(80dvh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl ${s.detailPopup}`}
        showCloseButton={false}
      >
        <div className={s.popupHeader}>
          <DialogTitle>{title}</DialogTitle>
          <DialogClose className={s.popupClose} aria-label="닫기">
            <EyIcon name="close" size={18} />
          </DialogClose>
        </div>
        <div
          className={s.popupBody}
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
