"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  fitWithdrawalRows,
  WITHDRAWAL_PAGE_MIN,
  WITHDRAWAL_PAGE_SIZE,
} from "@/features/withdrawals/list-pagination";
import styles from "./list-layout.module.css";

/**
 * 명단 행 수를 **창 높이**에 맞춘다 — 목록 아래 남는 높이 ÷ 행 높이.
 *
 * 🔴 **기준이 옆 카드가 아니다**(원장 2026-09-16 캡처: *"퇴원 관리 페이지 하단 여백이 너무 많이 남으니까
 *    페이지네이션 리스트를 더 확장해도 되지 않나? 자동으로 확장되는건가?"*). 종전엔 오른쪽 '사유 분석'
 *    카드 높이를 자로 썼다 — 그 카드는 내용이 짧으면 280px에서 멈추므로, 창을 아무리 키워도 4행에서 멎고
 *    아래 절반이 빈 채로 남았다. 자는 **창(스크롤러)**이어야 한다(학생상담 [`AutoPageSize`] 규약과 같은 결).
 * ⚠️ 스크롤 컨테이너는 window가 아니라 셸의 `<main>`(창·미니셸·풀셸 모두)이라 그 안의 좌표로 잰다.
 *    목록 **아래**에 남겨 둘 높이(쪽 넘김 + 바닥 여백)는 상수가 아니라 실제 문서에서 잰다.
 * 🔴 `scrollHeight`로 재지 말 것 — 내용이 짧을 때 빈 공간까지 '아래'로 잡혀 행 수가 최소로 떨어지고
 *    창을 키워도 안 늘어난다([`AutoPageSize`]가 같은 함정을 주석으로 못박아 뒀다).
 * ⚠️ 한 열로 접히는 폭(<1024)에선 종전 그대로 고정 8행이다 — 거기선 목록 **아래에 '사유 분석' 카드가
 *    오므로**, 창에 맞춰 늘리면 그 카드를 화면 밖으로 밀어낸다.
 */
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
    const rows = root?.querySelector<HTMLElement>("[data-withdrawal-rows]");
    const row = rows?.querySelector<HTMLElement>("li > a");
    if (!root || !aside || !header || !footer || !rows || !row) return;
    let timer: ReturnType<typeof setTimeout>;
    let requested = "";
    const measure = () => {
      // CSS가 실제로 두 열인지 읽는다. 한 열일 때는 짧은 기본 페이지를 사용한다(위 주석).
      const sideBySide = getComputedStyle(root).gridTemplateColumns.split(" ").length > 1;
      const chrome = header.getBoundingClientRect().height + footer.getBoundingClientRect().height;
      const rowHeight = row.getBoundingClientRect().height + 1; // 행 사이 구분선 포함
      if (rowHeight <= 1) return;
      // 목록(행 영역) 위·아래로 실제로 있는 것을 빼고 남는 창 높이.
      const scroller = (root.closest("main") as HTMLElement | null) ?? document.documentElement;
      const rowsRect = rows.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const topInScroller = rowsRect.top - scrollerRect.top + scroller.scrollTop;
      const padBottom = Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      /**
       * 🔴 목록 **아래에 남겨 둘 높이**는 쪽 넘김 바와 바닥 여백 **둘뿐**이다 — 페이지 루트 바닥에서
       *    거꾸로 재지 말 것([`AutoPageSize`]는 그렇게 재지만 여기선 틀린다).
       *    이 카드는 `--withdrawal-list-height`(= 옆 카드 높이) 때문에 **늘어나 있고** 행 영역이
       *    `flex: 1`로 그 여분을 먹는다. 그러면 "행이 이미 차지한 높이"에 늘어난 만큼이 섞여 들어가
       *    남는 자리를 과대평가하고, 실제로는 화면을 넘치는 행 수를 청하게 된다(3행쯤 초과 → 스크롤바).
       * ⚠️ 이 식은 **행 격자가 페이지의 마지막 블록**이라는 전제다. 아래에 블록이 더 생기면 그 높이도
       *    함께 빼야 한다(오른쪽 '사유 분석'은 다른 열이라 대상이 아니다 — 그 열이 더 길면 그만큼만 스크롤된다).
       */
      const below = footer.getBoundingClientRect().height + padBottom;
      const avail = scroller.clientHeight - topInScroller - below - 4; // 4px = 반올림 여유
      // chrome은 위 좌표에 이미 빠져 있다(행 영역에서 쟀다) → 두 번 빼지 않게 0으로 넘긴다.
      // 하한(WITHDRAWAL_PAGE_MIN)은 최소 창에서 1행 목록이 되는 것을 막는다(상수 주석 참조).
      const fit = sideBySide
        ? Math.max(WITHDRAWAL_PAGE_MIN, fitWithdrawalRows(avail, 0, rowHeight))
        : WITHDRAWAL_PAGE_SIZE;
      // 카드가 옆 카드보다 짧아 보이지 않게 최소 높이만 남긴다(행이 더 많으면 자연히 더 길어진다).
      const asideHeight = aside.getBoundingClientRect().height;
      const stableHeight = sideBySide
        ? Math.max(asideHeight, chrome + rowHeight)
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
    // 🔴 창(iframe)이 커져도 내용 높이는 그대로일 수 있어 ResizeObserver가 안 깨어난다 — 창 자체를 함께 듣는다.
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [size, total, pathname, query, router]);

  return <div ref={ref} className={styles.layout}>{children}</div>;
}
