"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PAGE_SIZE_MAX, PAGE_SIZE_MIN, pageSizeCookieName } from "./page-size";

/**
 * 목록 한 쪽의 행 수를 **창 크기에 맞춘다** — 원장 2026-09-03(학생상담 캡처): *"하단에도 공간 많으니까 행 개수 더 해도 되고,
 * 창 크기에 따라서 스마트하게 유동성 있게 변동 가능하면 그렇게 해."*
 *
 * 서버는 창 높이를 모른다. 그래서 클라가 **목록 아래 남는 높이 ÷ 행 높이 × 단 수**를 재어 그 값이 지금과 다르면
 * `?size=N`으로 같은 화면을 다시 청한다(router.replace — 히스토리에 안 쌓인다). 창을 늘리거나 줄이면(resize, 250ms
 * 디바운스) 다시 잰다. URL에 실리므로 다음 쪽으로 넘어가도 같은 크기다.
 *
 * 측정값은 **기기 쿠키**(`pageSizeCookieName(storageKey)`)에도 남긴다 — 서버가 첫 렌더에 그 값을 읽으면 같은 창을
 * 다시 열 때 "기본 N행 → 재측정 → 다시 청함"의 두 번째 렌더가 없다(창 크기는 워크스페이스가 기억하므로 대개 같다).
 *
 * ⚠️ 스크롤 컨테이너는 window가 아니라 셸의 `<main>`(창·미니셸·풀셸 모두)이라 그 안의 좌표로 잰다. 목록 **아래**에
 *    남겨 둘 높이(쪽 넘김 + 본문 바닥 여백)는 상수가 아니라 실제 문서에서 잰다(셸마다 여백이 다르다).
 * ⚠️ 흔들림 방지 — 지금보다 **작아졌거나(넘침) 2 이상 커졌을 때만** 바꾼다(1행 차이로 왕복하지 않게). 그래도 폭이 단
 *    경계에 걸려 스크롤바 유무가 단 수를 뒤집는 식의 진동이 남을 수 있어, **방금 청한 값에서 곧바로 되돌아가는 것만** 막는다
 *    (A→B 직후 B→A). 🔴 "한 마운트 안에서 이미 청했던 값 전부"를 막으면 안 된다 — 최대화 → 복원 → 최대화처럼 사용자가 같은
 *    크기로 돌아오면 그 값이 영영 거절돼 목록이 창을 안 따라온다(적대적 리뷰 2026-09-04, 실측). 그래서 사용자 resize 때는 차단을 푼다.
 *    상하한은 서버 clamp(`page-size.ts`)와 같은 상수다.
 * ⚠️ 쪽 크기가 바뀌면 1쪽으로 간다(같은 page 번호가 다른 행을 가리키게 되므로).
 * ⚠️ effect 안에서 setState하지 않는다([[#25]]) — 결과는 URL·쿠키로만 나간다.
 * ⚠️ 단 수는 `column-count`가 숫자일 때만 그 값이고, `columns-[44rem]`처럼 폭으로 정한 다단은 `auto`라 못 읽는다 —
 *    그땐 규격의 식으로 센다(`columnCountOf`, 적대적 리뷰 2026-09-03에서 잡힘: 2단 창의 아래 절반이 비어 있었다).
 * 🔴 **단은 채워서 세운다**(원장 2026-09-04 *"큰 창으로 가면 하나의 단에 학생 수가 너무 적다"*): 다단의 기본(balance)은 행을 단마다
 *    고르게 나눠 30행·3단이면 10·10·10이 된다 — 큰 창일수록 단마다 더 성겨 보였다. 그래서 이 컴포넌트가 루트에 CSS 변수 둘을
 *    적는다: `--cols` = min(폭이 허락하는 단 수, ceil(항목 수 ÷ 한 단 행 수)) · `--list-h` = 한 단 높이(2단 이상일 때만).
 *    목록은 `column-count: var(--cols)` + `column-fill: auto` + `height: var(--list-h)`로 **위에서 아래로 단을 채우고**, 제목·테두리
 *    격자는 `repeat(var(--cols, auto-fill), …)`로 같은 단 수를 쓴다(항목이 한 단에 다 들어가면 1단 = 최소 창과 같은 모양).
 *    ⚠️ 단 수 측정은 늘 **폭**에서 한다 — `column-count`를 우리가 적은 뒤 그 값을 읽으면 단이 줄어든 만큼 다음 측정이 또 줄어 1단까지 수렴한다.
 */
export function AutoPageSize({
  size,
  rowPx,
  storageKey,
  param = "size",
  className,
  children,
}: {
  /** 서버가 지금 쓴 쪽 크기. */
  size: number;
  /** 행 하나의 높이(px, 구분선 포함). */
  rowPx: number;
  /** 쿠키 키(화면 식별자, 예 "consultations") — 서버는 `pageSizeCookieName(storageKey)`로 읽는다. */
  storageKey: string;
  param?: string;
  /** 루트 div 클래스 — 제목·테두리 격자를 안에 함께 둘 때 `relative` 등. */
  className?: string;
  /** 목록(`<ul>`)엔 `data-autopage-list`를 단다(없으면 첫 자식) — 단 수·항목 수를 거기서 읽는다. */
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  /** 방금 청한 이동(from → to) — 서버가 to를 준 직후 다시 from을 재면 진동이니 그 한 번만 막는다. 사용자 resize가 오면 푼다. */
  const lastRequest = useRef<{ from: number; to: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: number | undefined;
    const measure = () => {
      const list =
        (el.querySelector("[data-autopage-list]") as HTMLElement | null) ?? (el.firstElementChild as HTMLElement | null);
      if (!list) return;
      const scroller = (el.closest("main") as HTMLElement | null) ?? document.documentElement;
      // 🔴 위치는 루트가 아니라 **목록**에서 잰다 — 루트엔 제목 행(36px)이 함께 들어 있어 루트 top으로 재면 그만큼 행을 더 세어
      //    2단 이상에서 본문이 20~30px 넘쳤다(실측 2026-09-04). 목록 바닥 = 루트 바닥(목록이 마지막 자식).
      const elRect = list.getBoundingClientRect();
      const topInScroller = elRect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      // 목록 아래에 실제로 있는 것(쪽 넘김·바닥 여백)의 높이 = 스크롤러 직계 자식(페이지 루트)의 바닥 − 목록 바닥 + 스크롤러
      // 바닥 패딩. 🔴 scrollHeight로 재면 안 된다 — 내용이 짧을 때 빈 공간까지 '아래'로 잡혀 행 수가 최소값으로 떨어지고
      // 창을 키워도 안 늘어난다(실브라우저 측정 2026-09-03에서 났다).
      let root: HTMLElement = el;
      while (root.parentElement && root.parentElement !== scroller) root = root.parentElement;
      const padBottom = Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      const below = Math.max(0, root.getBoundingClientRect().bottom - elRect.bottom) + padBottom;
      const avail = scroller.clientHeight - topInScroller - below - 4; // 4px = 반올림 여유
      const rows = Math.max(1, Math.floor(avail / rowPx));
      const cols = columnCountOf(list);
      const fit = Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, rows * cols));
      writeCookie(pageSizeCookieName(storageKey), fit);
      // 단 채우기(위 주석) — 지금 실린 항목으로 채울 수 있는 단만 세우고, 2단 이상이면 한 단 높이를 고정해 column-fill:auto가 듣게 한다
      // (+2px = 반올림 여유; 모자라면 마지막 행이 넘침 단으로 새어 나간다). DOM 스타일만 만진다(상태 아님, [[#25]]).
      const items = list.children.length;
      const effCols = Math.min(cols, Math.max(1, Math.ceil(items / rows)));
      el.style.setProperty("--cols", String(effCols));
      if (effCols > 1) el.style.setProperty("--list-h", `${rows * rowPx + 2}px`);
      else el.style.removeProperty("--list-h");
      if (fit === size || (fit > size && fit - size < 2)) return;
      const last = lastRequest.current;
      if (last && last.to === size && last.from === fit) return; // A→B 직후의 B→A = 진동
      lastRequest.current = { from: size, to: fit };
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set(param, String(fit));
      params.delete("page");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };
    measure();
    const onResize = () => {
      lastRequest.current = null; // 사람이 창을 바꿨다 — 되돌아가는 값도 정당하다.
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 250);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(timer);
    };
  }, [size, rowPx, storageKey, param, pathname, searchParams, router]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * 폭이 허락하는 단 수. `columns-[44rem]`처럼 **폭으로** 단을 정하면 CSS 다단 규격 그대로 `max(1, floor((폭 + 간격) ÷ (단 폭 + 간격)))`
 * 로 센다(브라우저가 쓰는 식). 🔴 `column-count`는 이 컴포넌트가 `--cols`로 **줄여 적는 값**이라 먼저 읽으면 안 된다(줄인 값을 다시
 * 읽어 또 줄이는 수렴) — 단 폭이 없는 목록(고정 단 수)에서만 그 값을 쓴다.
 */
function columnCountOf(list: HTMLElement): number {
  const cs = getComputedStyle(list);
  const width = Number.parseFloat(cs.columnWidth);
  const gap = Number.parseFloat(cs.columnGap) || 0;
  // 🔴 폭은 소수까지(getBoundingClientRect) — clientWidth는 정수라 44rem 경계 0.5px 아래에서 브라우저보다 한 단 더 세어 행을 두 배로 청한다(DPR 1.25·스크롤바 거터에서 실제로 난다).
  if (Number.isFinite(width) && width > 0) return Math.max(1, Math.floor((list.getBoundingClientRect().width + gap) / (width + gap)));
  const explicit = Number.parseInt(cs.columnCount, 10);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : 1;
}

function writeCookie(name: string, value: number) {
  try {
    document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // 쿠키를 못 쓰는 환경(미리보기 등) — 측정만 못 남길 뿐 화면은 그대로다.
  }
}
