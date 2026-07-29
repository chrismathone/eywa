"use client";

/**
 * BL4 — 메뉴 hover 시 창 iframe이 쓸 `?embed=1` document를 브라우저에 prefetch.
 *
 * ⚠️ **효과의 정체 정정(2026-07-29 실측)** — 예전 주석은 "클릭 시 iframe src가 **HTTP 캐시 히트**로
 * 시작한다"고 적었는데 **거짓이다**. 인증 셸 문서는 동적 렌더라 응답이
 * `Cache-Control: private, no-cache, no-store, must-revalidate`(3/3 재현)라서 브라우저가 저장할 수
 * 없다 — 클릭 시 문서는 **다시 요청된다**. 실제로 얻는 건 ① Vercel 함수 warm-up ② 테넌트 설정
 * `unstable_cache` 선점 ③ DNS/TLS·커넥션 예열이다(그래서 여전히 유효하지만, 캐시 히트가 아니다).
 * 창 재오픈의 진짜 즉시화는 BL3 warm iframe(window-store `CACHE_MAX`)이 담당한다.
 *
 * 가드: 자주 쓰는 메뉴 루트만 · 디바운스 120ms · URL당 1회 · 동시 1개 스케줄(마지막 hover 승).
 * ⚠️ 부모 `router.prefetch`는 iframe과 캐시 미공유 → 효과 0(비권장). 여기는 document link prefetch.
 */
import { withEmbed } from "./embed-context";

/** 새 창으로 자주 여는 메뉴 루트(상세 id 경로는 제외 — 호버 낭비 방지). */
const PREFETCH_ROOTS = new Set([
  // /dashboard는 iframe이 아닌 셸 main 데스크톱 작업면이라 document embed prefetch 대상이 아니다.
  "/timetable",
  "/attendance",
  "/students",
  "/classes",
  "/lesson-reports",
  "/consultations",
  "/billing",
  "/onescreen",
  "/exams",
  "/meetings",
  "/owner",
]);

const prefetched = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingUrl: string | null = null;

function pathOnly(href: string): string {
  return href.split("?")[0]?.split("#")[0] ?? href;
}

function isPrefetchRoot(href: string): boolean {
  return PREFETCH_ROOTS.has(pathOnly(href));
}

function injectDocumentPrefetch(url: string): void {
  if (typeof document === "undefined") return;
  if (prefetched.has(url)) return;
  prefetched.add(url);
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "document";
  link.href = url;
  document.head.appendChild(link);
}

/**
 * hover 시작 — 120ms 후 해당 document를 prefetch 큐에 넣는다(연속 hover는 마지막만 남김).
 * @param embed true면 `?embed=1` 병합(데스크톱 플로팅 창 iframe과 동일 URL). 모바·미니셸은 false.
 */
export function scheduleEmbedPrefetch(href: string, opts?: { embed?: boolean }): void {
  if (typeof document === "undefined") return;
  if (!isPrefetchRoot(href)) return;
  const base = pathOnly(href);
  const url = opts?.embed === false ? base : withEmbed(base);
  if (prefetched.has(url)) return;
  pendingUrl = url;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const target = pendingUrl;
    pendingUrl = null;
    if (target) injectDocumentPrefetch(target);
  }, 120);
}

/** hover 취소 — 디바운스 전 이탈 시 스케줄만 취소(이미 삽입된 link는 유지). */
export function cancelScheduledPrefetch(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pendingUrl = null;
}
