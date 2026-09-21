"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { WindowLink, windowIdForHref } from "@/components/workspace/window-link";

const BTN = `${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-primary-soft inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 font-medium whitespace-nowrap transition`;

/** 실제 업무 화면을 창으로 연다. 운영실(배경)은 창 안에서 링크를 걸지 않는다. */
export function OpenScreen({ href, label }: { href: string; label: string }) {
  const inFrame = useInFrame();
  const canWindow = Boolean(windowIdForHref(href));
  if (inFrame && !canWindow) return null;
  return (
    <WindowLink href={href} frameTarget="window" className={BTN} ariaLabel={`${label} 창 열기`}>
      이 화면 열기 <EyIcon name="arrowRight" size={16} className="opacity-60" />
    </WindowLink>
  );
}

export function OpenScreenArrow({ href, label }: { href: string; label: string }) {
  const inFrame = useInFrame();
  const canWindow = Boolean(windowIdForHref(href));
  if (inFrame && !canWindow) return null;
  return (
    <WindowLink
      href={href}
      frameTarget="window"
      className="text-primary hover:bg-primary-soft ml-auto inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-sm font-medium"
      ariaLabel={`${label} 창 열기`}
    >
      ↗
    </WindowLink>
  );
}
