"use client";

import appearance from "@/app/(shell)/dashboard/_overview/appearance.module.css";
import overview from "@/app/(shell)/dashboard/_overview/overview.module.css";

/** 이미 안전하게 렌더된 카드의 정적 사본. 끄는 동안 차트·구독을 다시 마운트하지 않는다. */
export function captureCard(root: HTMLElement | null, id: string): string {
  const node = root?.querySelector<HTMLElement>(`[data-live-preview] [data-dashboard-card="${CSS.escape(id)}"]`);
  if (!node) return "";
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = "100%";
  clone.style.height = "100%";
  clone.removeAttribute("id");
  clone.removeAttribute("data-dashboard-card");
  return clone.outerHTML;
}

export function CardDragPreview({ html, width, height }: { html: string; width: number; height: number }) {
  return <div className={appearance.dashboard} style={{ width, height }} aria-hidden inert>
    <div className={overview.root} style={{ height }} dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
