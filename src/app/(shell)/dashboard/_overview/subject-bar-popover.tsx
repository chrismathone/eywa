"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { number } from "./charts";
import s from "./overview.module.css";

/**
 * The whole track is a touch target, including narrow and zero-count segments.
 * 항목에 `href`가 있으면 그 줄을 누르면 그 조건의 목록이 창으로 열린다(재원생 구성 — 원장 2026-09-28
 * *"이 안에서 누르면 이동하는걸로"*). 없으면 종전처럼 숫자만.
 */
export function SubjectBarPopover({ label, items, children }: {
  label: string;
  items?: readonly { label: string; color: string; value: number; href?: string | null }[];
  children: ReactNode;
}) {
  // Old snapshots may have totals without a subject breakdown.
  if (!items) return children;

  return <Popover.Root>
    <Popover.Trigger className={s.subjectBarButton} aria-label={`${label} 수강 구성 보기`}>
      {children}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="top" sideOffset={6} collisionPadding={12} className={s.subjectPopoverPositioner}>
        <Popover.Popup className={s.subjectPopover}>
          <div className={s.subjectPopoverHeader}>
            <Popover.Title>{label} 수강 구성</Popover.Title>
            <Popover.Close className={s.popupClose} aria-label="수강 구성 닫기">
              <EyIcon name="close" size={16} />
            </Popover.Close>
          </div>
          <dl className={s.subjectPopoverCounts}>
            {items.map((item) => item.href
              ? <div key={item.label} className={s.subjectPopoverLinkRow}>
                  <dt>
                    <WindowLink href={item.href} className={s.subjectPopoverLink} ariaLabel={`${label} ${item.label} ${number(item.value)}명 원생목록 열기`}>
                      <i aria-hidden="true" style={{ background: item.color }} />{item.label}
                    </WindowLink>
                  </dt>
                  <dd>
                    <WindowLink href={item.href} className={s.subjectPopoverLink} ariaLabel={`${label} ${item.label} 원생목록 열기`}>
                      {number(item.value)}<small>명</small>
                    </WindowLink>
                  </dd>
                </div>
              : <div key={item.label}>
                  <dt><i aria-hidden="true" style={{ background: item.color }} />{item.label}</dt>
                  <dd>{number(item.value)}<small>명</small></dd>
                </div>)}
          </dl>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
