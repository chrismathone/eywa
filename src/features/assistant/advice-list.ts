/**
 * 학원 비서 '지난 의견' — 제안 → 결과 → 학습 3단계 첫 조각(2026-11-10 · 순수 모듈 · 서버·화면 공용).
 * 대화를 넘나들며 내 의견을 한곳에서 본다: 위 = 현황(처리 상태별 · 다시 잰 결과별 · 가장 가까운 재측정) · 아래 = 답별로 묶은 의견.
 * 🔴 본인 의견만 — 대화가 사람별 비공개라서(advice-store와 같은 규칙). 지운 대화의 의견은 싣지 않는다(서버가 거른다).
 */
import { kstToday } from "@/lib/date-kst";
import { ADVICE_STATUSES, type AdviceStatus, type AdviceView } from "./advice";
import { VERDICTS, type Verdict } from "./advice-outcome";

/** 목록 한 줄 — 처리 상태·확인 지표(`view`)에 의견 문장과 어느 대화의 답인지. 조회문 원문은 싣지 않는다. */
export type AdviceListItem = {
  view: AdviceView;
  action: string;
  why: string;
  threadId: string;
  threadTitle: string;
  messageId: string;
  /** 의견을 낸 때(답을 저장한 시각 · ISO). */
  createdAt: string;
};

/** 처리할 것 = 처리 전·채택·보류 · 끝낸 것 = 완료·안 함 · 결과 나옴 = 다시 잰 값이 있다(처리 상태와 겹친다). */
export const ADVICE_FILTERS = ["all", "todo", "result", "closed"] as const;
export type AdviceFilter = (typeof ADVICE_FILTERS)[number];
export const ADVICE_FILTER_LABEL: Record<AdviceFilter, string> = { all: "전체", todo: "처리할 것", result: "결과 나옴", closed: "끝낸 것" };

const TODO: ReadonlySet<AdviceStatus> = new Set(["open", "adopted", "on_hold"]);

export function matchesFilter(view: AdviceView, filter: AdviceFilter): boolean {
  if (filter === "todo") return TODO.has(view.status);
  if (filter === "closed") return !TODO.has(view.status);
  if (filter === "result") return view.result !== null;
  return true;
}

export type AdviceSummary = {
  total: number;
  byStatus: Record<AdviceStatus, number>;
  byFilter: Record<AdviceFilter, number>;
  byVerdict: Record<Verdict, number>;
  /** 다시 잴 날을 기다리는 의견 수. */
  waiting: number;
  /** 기다리는 의견 중 가장 가까운 다시 잴 날(오늘 이후) — 날이 지났는데 아직 안 잰 것만 남았으면 null. */
  nextCheckOn: string | null;
};

/** 현황 — 화면 맨 위 한 줄. 숫자는 지금 보이는(가장 새) 처리 상태로 센다. */
export function summarizeAdvice(views: readonly AdviceView[], today: string = kstToday()): AdviceSummary {
  const byStatus = Object.fromEntries(ADVICE_STATUSES.map((s) => [s, 0])) as Record<AdviceStatus, number>;
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  const byFilter = { all: views.length, todo: 0, result: 0, closed: 0 } satisfies Record<AdviceFilter, number>;
  let waiting = 0;
  let nextCheckOn: string | null = null;
  for (const v of views) {
    byStatus[v.status] += 1;
    for (const f of ["todo", "result", "closed"] as const) if (matchesFilter(v, f)) byFilter[f] += 1;
    if (v.result) byVerdict[v.result.verdict] += 1;
    if (v.measureState === "waiting") {
      waiting += 1;
      const d = v.check?.nextCheckOn ?? null;
      if (d && d >= today && (nextCheckOn === null || d < nextCheckOn)) nextCheckOn = d;
    }
  }
  return { total: views.length, byStatus, byFilter, byVerdict, waiting, nextCheckOn };
}

export type AdviceGroup = {
  messageId: string;
  threadId: string;
  threadTitle: string;
  /** 의견을 낸 날(한국 날짜). */
  askedOn: string;
  items: AdviceListItem[];
};

/**
 * 답별로 묶는다 — 새 답이 위 · 답 안에서는 의견 번호 순. `current`는 이 화면에서 저장한 더 새 처리 상태(없으면 받은 값).
 * `keep` = 걸러 보는 중에 처리해서 조건을 벗어났지만 그대로 두는 의견(누르자마자 줄이 사라지지 않게 — 거르기를 바꾸면 풀린다).
 */
export function groupAdvice(
  items: readonly AdviceListItem[],
  filter: AdviceFilter,
  current: (item: AdviceListItem) => AdviceView = (item) => item.view,
  keep: ReadonlySet<string> = new Set(),
): AdviceGroup[] {
  const sorted = [...items].sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1) || a.messageId.localeCompare(b.messageId) || a.view.itemNo - b.view.itemNo);
  const groups: AdviceGroup[] = [];
  for (const item of sorted) {
    if (!matchesFilter(current(item), filter) && !keep.has(item.view.id)) continue;
    const last = groups[groups.length - 1];
    if (last && last.messageId === item.messageId) last.items.push(item);
    else groups.push({ messageId: item.messageId, threadId: item.threadId, threadTitle: item.threadTitle, askedOn: kstToday(new Date(item.createdAt)), items: [item] });
  }
  return groups;
}
