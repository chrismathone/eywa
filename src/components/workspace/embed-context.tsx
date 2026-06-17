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

/** href에 embed=1을 안전 병합(기존 쿼리 보존). 라우트 창 iframe `src`·임베드 내부 드릴인이 공유. */
export function withEmbed(href: string): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  return `${path}?${params.toString()}`;
}
