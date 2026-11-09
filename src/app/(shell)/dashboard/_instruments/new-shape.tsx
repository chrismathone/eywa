"use client";

import { WindowLink } from "@/components/workspace/window-link";
import type { PanelId } from "@/features/dashboard/overview/layout";
import { useBoard } from "./parts";

/**
 * 시안(dev 전용): 새 대시보드(aywa-next 배포 `375d27df4`)의 모양 — 카드·숫자는 계기판 그대로 두고 배치만 옮긴다.
 * 핵심 업무 3칸 · 보기 전환(한눈에 보기 / 오늘 운영 / 경영 현황) · 현황 필터.
 */
export type BoardMode = "glance" | "today" | "manage";
export type GraphKind = "all" | "trend" | "mix";

/** 한눈에 보기 — 추이(과목 탭 · 비교가 있는 카드)와 구성(지금 비율 · 계기판)으로 나눈다. */
export const TREND_PANELS: PanelId[] = ["changes", "billing6", "enrolledTrend", "courseTrend", "earlyExits"];
export const MIX_PANELS: PanelId[] = ["studentsComp", "attendance", "billingMonth", "newcomerStages"];

const MODES: { key: BoardMode; label: string; note: string }[] = [
  { key: "glance", label: "한눈에 보기", note: "추이와 구성비를 비교하고, 오늘 필요한 업무로 이어가세요." },
  { key: "today", label: "오늘 운영", note: "확인할 일과 업무 요청을 열고, 기록과 후속 조치를 이어갑니다." },
  { key: "manage", label: "경영 현황", note: "재원·수강·수납 추이와 설정한 전체 현황을 확인합니다." },
];

export function ViewSwitch({ mode, onMode }: { mode: BoardMode; onMode: (m: BoardMode) => void }) {
  return (
    <div className="ns-toolbar" data-noopen>
      <div className="seg-toggle ns-switch" role="group" aria-label="대시보드 보기">
        {MODES.map((m) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => onMode(m.key)}>{m.label}</button>)}
      </div>
      <p>{MODES.find((m) => m.key === mode)?.note}</p>
    </div>
  );
}

export function GraphFilter({ graph, onGraph }: { graph: GraphKind; onGraph: (g: GraphKind) => void }) {
  const { snapshot } = useBoard();
  return (
    <div className="ns-filter" data-noopen>
      <div><strong>현황 필터</strong><span>현재 선택된 과목 · 권한 범위</span></div>
      <div className="seg-toggle" role="group" aria-label="그래프 보기">
        {([["all", "전체 그래프"], ["trend", "추이 · 비교"], ["mix", "비중 · 구성"]] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={graph === key} onClick={() => onGraph(key)}>{label}</button>
        ))}
      </div>
      <p>과목은 카드마다 고릅니다(전체 · 수학 · 인재원 영어 · EiE · 비교) · 기록이 있는 기간만 · 이번 달은 오늘까지 · {snapshot.today} 기준</p>
    </div>
  );
}

/** 맨 위 핵심 업무 3칸 — 새 대시보드의 자리 그대로. 권한이 없어 열 수 없는 칸(href null)만 '이식 예정' 모양으로 둔다(누르지 않는다). */
export function CoreWork() {
  const { snapshot } = useBoard();
  const items: { title: string; text: string; href: string | null }[] = [
    { title: "신입생 90일 집중관리", text: "입학 약속 · 첫 수업 · 7/30/60/90일 액션과 결과", href: snapshot.allowed.includes("newcomers") ? "/newcomers" : null },
    // 경영 분석·업무 작성센터 = aywa-next 화면을 옮긴 시안(예시 값 · 저장 안 함). 경영 분석은 원장·관리자만 열린다(페이지가 다시 막는다).
    { title: "경영 분석", text: "매출 · 영업이익 · 인건비 · 채용 · 지식그래프", href: "/dashboard/management" },
    { title: "업무 작성센터", text: "강사 기록 · 업무 서식 · 작성부터 결과 확인까지", href: "/work-records" },
  ];
  return (
    <nav className="ns-core" aria-label="핵심 업무" data-noopen>
      {items.map((i) => i.href ? (
        <WindowLink key={i.title} href={i.href} className="ns-core-item"><strong>{i.title} <span aria-hidden>↗</span></strong><span>{i.text}</span></WindowLink>
      ) : (
        <div key={i.title} className="ns-core-item is-pending" title="새 대시보드 배포에만 있는 화면 — main 이식 예정"><strong>{i.title} <em>이식 예정</em></strong><span>{i.text}</span></div>
      ))}
    </nav>
  );
}
