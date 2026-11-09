"use client";
import { createContext, useContext, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";
import { NavigationScope, useOntologyNavigation } from "./ontology-navigation";
import { useStudentContributionScope } from "./student-contribution-scope";

export type DetailView = "summary" | "evidence";
type Tabs = { view: DetailView; show: (view: DetailView, reveal?: boolean) => void };
const Context = createContext<Tabs | null>(null);
export const useDetailTabs = () => useContext(Context);
const readView = (query: string): DetailView => new URLSearchParams(query).get("view") === "evidence" ? "evidence" : "summary";
const TABS: [DetailView, string][] = [["summary", "추이·요약"], ["evidence", "계산 근거"]];
type Props = { evidenceNote: string; summary: ReactNode; evidence: ReactNode };

/**
 * 두 탭은 같은 학생·같은 달의 한 번 읽은 자료를 나눠 보여 준다. 탭을 바꿔도 서버에 다시 묻지 않고(주소만 바꾼다),
 * 숨긴 탭은 마운트를 유지해 차트의 기간·선택 상태가 그대로 남는다. 월 이동은 주소의 view를 함께 싣는다.
 * 🔴 달을 불러오는 동안은 탭을 바꾸지 않는다 — 주소를 바꾸는 순간 라우터가 진행 중인 달 이동을 버린다.
 */
export function StudentDetailTabs(props: Props) {
  return <NavigationScope><DetailTabs {...props} /></NavigationScope>;
}

function DetailTabs({ evidenceNote, summary, evidence }: Props) {
  const scope = useStudentContributionScope();
  const query = useSearchParams().toString(), { pending } = useOntologyNavigation();
  const [view, setView] = useState(() => readView(query)), [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) { setSeenQuery(query); setView(readView(query)); }
  const show = (next: DetailView, reveal = false) => {
    if (pending) return;
    if (next !== view) {
      setView(next);
      const params = new URLSearchParams(window.location.search);
      if (next === "evidence") params.set("view", "evidence"); else params.delete("view");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
    if (!reveal) return;
    const tab = document.getElementById(`contribution-tab-${next}`);
    tab?.scrollIntoView({ block: "start" }); tab?.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (pending) return;
    const next = event.key === "Home" ? "summary" : event.key === "End" ? "evidence" : view === "summary" ? "evidence" : "summary";
    show(next); document.getElementById(`contribution-tab-${next}`)?.focus();
  };
  return <Context.Provider value={{ view, show }}>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" aria-busy={pending}>
      <div role="tablist" aria-label="로열티 보기" className={TOOLBAR_SEG_BOX}>{TABS.map(([key, label]) => <button key={key} type="button" role="tab" id={`contribution-tab-${key}`}
        aria-selected={view === key} aria-controls={`contribution-panel-${key}`} aria-disabled={pending && view !== key} tabIndex={view === key ? 0 : -1} onKeyDown={onKeyDown} onClick={() => show(key)}
        className={`${TOOLBAR_SEG_ITEM} scroll-mt-4 ${view === key ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF} ${pending && view !== key ? "cursor-progress opacity-50" : ""}`}>{label}</button>)}</div>
      <p role={pending && !scope ? "status" : undefined} className="text-xs">{pending && !scope ? "선택한 달을 불러오는 중입니다. 끝나면 탭을 바꿀 수 있습니다." : view === "summary" ? "차트에서 달을 고르면 계산 근거도 같은 달로 바뀝니다." : evidenceNote}</p>
    </div>
    {TABS.map(([key]) => <div key={key} role="tabpanel" id={`contribution-panel-${key}`} aria-labelledby={`contribution-tab-${key}`} hidden={view !== key} className="space-y-5">
      {key === "summary" ? summary : evidence}</div>)}
  </Context.Provider>;
}
