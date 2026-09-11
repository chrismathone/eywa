"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * 현재 페이지가 플로팅 창(크롬리스 iframe, ?embed=1)에 임베드됐는지 여부.
 * shell layout의 embed 분기가 <EmbedProvider embed>로 감싼다. 임베드면 창 크롬이 제목·뒤로를
 * 제공하므로(Idea A) 인페이지 백 헤더 등 중복 내비를 숨길 수 있다.
 */
const EmbedContext = createContext(false);

export function EmbedProvider({ embed, children }: { embed: boolean; children: ReactNode }) {
  return <EmbedContext.Provider value={embed}>{children}</EmbedContext.Provider>;
}

export function useEmbed() {
  return useContext(EmbedContext);
}

/**
 * href에 embed=1을 안전 병합(기존 쿼리 보존). 라우트 창 iframe `src`·임베드 내부 드릴인이 공유.
 * 🔴 **앱 경로(`/…`)와 상대 쿼리(`?…`)에만** 붙인다(전수검사 리뷰 2026-09-11) — 해시만 있는 링크(`#x`)에 붙이면
 *    `?embed=1#x`가 되어 **지금 쿼리가 통째로 날아가고**(같은 문서 안 스크롤이 문서 이동이 된다), 외부 주소·프로토콜 상대
 *    주소(`//x`)엔 뜻이 없다. 주소가 아닌 값(원스크린 PeriodNav가 넘기는 날짜 문자열)도 그대로 돌려준다.
 *    그래서 호출부는 판정 없이 부르면 된다(PeriodNav·HrefSelect·ParamLink·EcsDatePicker·EmbedLink·EmbedAnchor가 이걸 공유).
 */
export function withEmbed(href: string): string {
  const appPath = (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")) || href.startsWith("?");
  if (!appPath) return href;
  // 🔴 **해시를 먼저 떼어 낸다** — `/dashboard#daily-briefing`처럼 쿼리가 없는 해시 링크를 그냥 이으면
  //    `…#daily-briefing?embed=1`이 되어 embed가 **프래그먼트 안으로 들어가고**, 창 안에서 풀 셸이 뜬다
  //    (2026-09-03 적대적 리뷰가 잡았던 그 증상 — 그땐 운영실을 창에서 빼는 것으로 피했다).
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const base = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const [path, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  return `${path}?${params.toString()}${hash}`;
}
