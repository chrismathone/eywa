"use client";

import { createContext, useContext } from "react";
import { mixParts, type Counts, type MixKey } from "../../view-admin";

/**
 * 막대 색 — 운영실 대시보드의 색(인재원 로고의 노랑 · 회색 · 차콜)을 그대로 쓴다(원장 2026-11-11 *"색상을 우리 스타일로 변경하자. 기한내 - 주황, 기한외 - 회색, 미처리 - 검정 계열. 대시보드에 썼던 색상 스타일"*).
 * 기한 내 = 노랑(`--yellow`) · 기한 후 완료 = 회색(`--gray`) · 미처리 = 차콜(`--charcoal`) · 남음(때는 됐고 기한 전) = 옅은 바탕(`--pale`).
 * 값은 `dashboard/_instruments/instruments.css`의 토큰과 같다 — 그 토큰은 대시보드 화면 안에서만 살아 있어 여기에 같은 값을 적는다(한쪽을 바꾸면 함께).
 * 표의 칸 · 과목 관리자별 현황 · 학생 단계 종류 카드 · 판정 줄의 막대가 이 한 벌을 쓴다.
 */
export const MIX_COLOR: Record<MixKey, string> = { ontime: "#fdb811", lateDone: "#a3abae", missed: "#363c41", left: "#e7e9e6" };
export const MIX_LABEL: Record<MixKey, string> = { ontime: "기한 내", lateDone: "기한 후 완료", missed: "미처리", left: "남음" };

/**
 * '기한 내만 보기'(화면 오른쪽 위 토글 — 원장 2026-11-11 *"전체 비율말고 기한내 제출한 사람들을 비교하기 좋을듯"*).
 * 켜면 칸의 숫자 = 기한 내 완료율 · 막대 = 기한 내 몫 하나만. 칸 부품이 직접 읽는다(표마다 값을 내려 보내지 않는다).
 */
const OntimeOnlyContext = createContext(false);
export const OntimeOnlyProvider = OntimeOnlyContext.Provider;
export const useOntimeOnly = () => useContext(OntimeOnlyContext);

/**
 * 가로 막대 하나 — 때가 된 업무가 어떻게 끝났나를 **건수 비율 그대로** 나눈다(원장 *"가로 막대로 3등분 … 28%가 기한내, 70%가 기한외, 2%가 미처리면 가로로 28%/70%/2%를 그리는거야"*).
 * 왼쪽부터 기한 내 · 기한 후 완료 · 미처리, 남은 것은 빈 바탕. 가늘게 그린다(*"두껍고 너비가 넓지않으니까 못생겨보임"* — 줄 높이를 다 채우던 막대를 물렸다).
 * `ontimeOnly`면 기한 내 몫만 칠한다. 때가 된 업무가 없으면 빈 바탕만 남는다.
 */
export function MixBar({ cell, ontimeOnly = false, className = "h-1.5" }: { cell: Counts; ontimeOnly?: boolean; className?: string }) {
  const parts = mixParts(cell).filter((p) => (ontimeOnly ? p.key === "ontime" : p.key !== "left"));
  return <span aria-hidden className={`flex w-full shrink-0 overflow-hidden rounded-full ${className}`} style={{ background: MIX_COLOR.left }}>
    {/* 한 건이라도 있으면 실금으로라도 보이게 최소 2px(나머지가 그만큼 줄어든다 — 합은 막대 폭을 넘지 않는다). */}
    {parts.map((p) => <span key={p.key} className="h-full" style={{ width: `${p.share * 100}%`, minWidth: 2, background: MIX_COLOR[p.key] }} />)}
  </span>;
}

/**
 * 표 머리의 풀이 — 칸의 숫자가 무엇인지(완료율 · '기한 내만 보기'면 기한 내 완료율)와 막대 색의 뜻.
 * 막대 색(노랑 · 회색 · 차콜)은 뜻을 스스로 말하지 않고, 칸의 100% 옆에 5등급이 서면(늦게 다 한 선생님) 숫자가 무엇인지 적혀 있어야 한다 — 등급은 늘 기한 내 완료율로 매긴다.
 */
export function MixLegend({ className = "" }: { className?: string }) {
  const ontimeOnly = useOntimeOnly();
  const keys: MixKey[] = ontimeOnly ? ["ontime"] : ["ontime", "lateDone", "missed", "left"];
  return <span className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold whitespace-nowrap ${className}`}>
    <span>숫자 = {ontimeOnly ? "기한 내 완료율" : "완료율"}</span>
    {keys.map((k) => <span key={k} className="flex items-center gap-1"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: MIX_COLOR[k] }} />{MIX_LABEL[k]}</span>)}
  </span>;
}
