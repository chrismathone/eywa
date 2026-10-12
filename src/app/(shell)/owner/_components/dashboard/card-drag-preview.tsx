"use client";

import appearance from "@/app/(shell)/dashboard/_overview/appearance.module.css";
import overview from "@/app/(shell)/dashboard/_overview/overview.module.css";

/** 이미 안전하게 렌더된 카드의 정적 사본. 끄는 동안 차트·구독을 다시 마운트하지 않는다. */
export function captureCard(root: HTMLElement | null, id: string): string {
  const node = root?.querySelector<HTMLElement>(`[data-live-preview] [data-dashboard-card="${CSS.escape(id)}"]`);
  if (!node) return "";
  const clone = node.cloneNode(true) as HTMLElement;
  // 포털에서는 격자·컨테이너 조상이 사라진다. 원본에서 계산된 크기를 고정해 반응형 CSS가
  // 복제 카드의 제목·차트 폭을 다시 축소하지 않게 한다(특히 inline-size 컨테이너의 flex 축소).
  const originals = [node, ...node.querySelectorAll<HTMLElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
  originals.forEach((el, index) => {
    const copy = copies[index];
    if (!(el instanceof HTMLElement) || !(copy instanceof HTMLElement)) return;
    const style = getComputedStyle(el);
    for (const key of ["display", "box-sizing", "width", "height", "min-width", "max-width", "min-height", "max-height", "padding", "margin", "gap", "flex-direction", "justify-content", "align-items", "font-size", "line-height", "white-space", "grid-template-columns", "grid-template-rows"]) {
      copy.style.setProperty(key, style.getPropertyValue(key));
    }
    copy.style.flexShrink = "0";
    copy.removeAttribute("id");
  });
  clone.style.width = "100%";
  clone.style.height = "100%";
  clone.style.overflow = "hidden";
  clone.removeAttribute("data-dashboard-card");
  return clone.outerHTML;
}

export function CardDragPreview({ html, width, height }: { html: string; width: number; height: number }) {
  return <div className={appearance.dashboard} data-card-drag-preview style={{ width, height, flex: "0 0 auto", overflow: "hidden", borderRadius: 12 }} aria-hidden inert>
    <div className={overview.root} style={{ width, height }} dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
