"use client";

import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";
import { number } from "./charts";
import s from "./overview.module.css";

/** The whole track is a touch target, including narrow and zero-count segments. */
export function SubjectBarPopover({ label, items, children }: {
  label: string;
  items?: readonly { label: string; color: string; value: number }[];
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
            {items.map((item) => <div key={item.label}>
              <dt><i aria-hidden="true" style={{ background: item.color }} />{item.label}</dt>
              <dd>{number(item.value)}<small>명</small></dd>
            </div>)}
          </dl>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
