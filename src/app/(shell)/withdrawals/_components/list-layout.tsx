"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fitWithdrawalRows, WITHDRAWAL_PAGE_SIZE } from "@/features/withdrawals/list-pagination";
import styles from "./list-layout.module.css";

/** 오른쪽 카드의 고유 높이를 기준으로 명단만 페이지 단위로 다시 요청한다. */
export function WithdrawalListLayout({ size, total, children }: {
  size: number;
  total: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();

  useEffect(() => {
    const root = ref.current;
    const aside = root?.querySelector<HTMLElement>("[data-withdrawal-reasons]");
    const header = root?.querySelector<HTMLElement>("[data-withdrawal-header]");
    const footer = root?.querySelector<HTMLElement>("[data-withdrawal-pager]");
    const row = root?.querySelector<HTMLElement>("[data-withdrawal-rows] > li > a");
    if (!root || !aside || !header || !footer || !row) return;
    let timer: ReturnType<typeof setTimeout>;
    let requested = "";
    const measure = () => {
      // CSS가 실제로 두 열인지 읽는다. 한 열일 때는 짧은 기본 페이지를 사용한다.
      const sideBySide = getComputedStyle(root).gridTemplateColumns.split(" ").length > 1;
      const chrome = header.getBoundingClientRect().height + footer.getBoundingClientRect().height;
      const rowHeight = row.getBoundingClientRect().height + 1; // 행 사이 구분선 포함
      const height = aside.getBoundingClientRect().height;
      if (height <= 0 || rowHeight <= 1) return;
      const fit = sideBySide ? fitWithdrawalRows(height, chrome, rowHeight) : WITHDRAWAL_PAGE_SIZE;
      const stableHeight = sideBySide
        ? Math.max(height, chrome + rowHeight)
        : chrome + Math.min(total, fit) * rowHeight;
      root.style.setProperty("--withdrawal-list-height", `${stableHeight}px`);
      if (fit === size) return;
      const params = new URLSearchParams(query);
      params.set("size", String(fit));
      params.delete("page");
      const href = `${pathname}?${params}`;
      if (href === requested) return;
      requested = href;
      router.replace(href, { scroll: false });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 150);
    };
    const observer = new ResizeObserver(schedule);
    // aside는 stretch하지 않으므로 왼쪽 행 수가 오른쪽 측정 높이를 부풀리지 않는다.
    for (const element of [root, aside, header, footer, row]) observer.observe(element);
    measure();
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [size, total, pathname, query, router]);

  return <div ref={ref} className={styles.layout}>{children}</div>;
}
