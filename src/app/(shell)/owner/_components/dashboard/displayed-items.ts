import type { Item } from "@/features/dashboard/layout/types";

/** 내용에 맞춰 높아진 카드도 사용자가 보고 있는 좌표에서 이동·크기·행 편집을 시작한다. */
export function displayedItems(root: HTMLElement | null, items: readonly Item[]): Item[] {
  return items.map((item) => {
    const cell = root?.querySelector<HTMLElement>(`[data-overview="free-grid"] > [data-dashboard-card="${CSS.escape(item.id)}"]`);
    if (!cell) return item;
    const values = ["--dx", "--dy", "--dw", "--dh"].map((key) => Number(cell.style.getPropertyValue(key)));
    if (values.some((v) => !Number.isFinite(v)) || values.some((v) => v < 1)) return item;
    return { ...item, x: values[0] - 1, y: values[1] - 1, w: values[2], h: values[3] };
  });
}
