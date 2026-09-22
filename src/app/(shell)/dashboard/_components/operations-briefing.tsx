import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { CONTROL_H, CONTROL_H_LG, CONTROL_LABEL, CONTROL_LABEL_LG } from "@/components/ui/control-scale";
import type {
  AssistantState,
  BriefingItem,
  BriefingLane,
  BriefingPriority,
  OperationsBriefing as OperationsBriefingData,
} from "@/features/dashboard/operations-briefing";
import { BriefingAutoRefresh } from "./briefing-auto-refresh";

const SUMMARY: { lane: BriefingLane; label: string; tone: string }[] = [
  { lane: "urgent", label: "긴급", tone: "bg-danger-soft text-danger ring-danger/20" },
  { lane: "approval", label: "승인", tone: "bg-gold-soft text-foreground ring-gold/25" },
  { lane: "today", label: "오늘", tone: "bg-amber-soft text-foreground ring-amber/25" },
  { lane: "notice", label: "참고", tone: "bg-blue-soft text-foreground ring-blue/20" },
];

const STATE_META: Record<AssistantState, { label: string; dot: string; tone: string }> = {
  critical: {
    label: "즉시 대응 필요",
    dot: "bg-danger",
    tone: "bg-danger-soft/70 text-danger ring-danger/20",
  },
  attention: {
    label: "처리할 일 있음",
    dot: "bg-amber",
    tone: "bg-amber-soft/70 text-foreground ring-amber/25",
  },
  // 정상·안정은 의미색 캐논의 positive = **초록**(브랜드 네이비는 '현재 위치·기본 액션'이지 상태가 아니다).
  steady: {
    label: "운영 안정",
    dot: "bg-green",
    tone: "bg-green-soft/70 text-green ring-green/20",
  },
};

/**
 * 먼저 할 일의 우선순위 톤 — **평면 틴트 하나**(지시서 §9 "그라데이션·글래스 금지", §11 "색은 의미에만").
 * 종전의 대각선 그라데이션·장식 원은 뺐다(원장 2026-09-03 "지시서 그대로").
 */
const PRIORITY_STYLE: Record<BriefingPriority, { shell: string; badge: string }> = {
  critical: { shell: "bg-danger-soft/60", badge: "bg-danger text-white" },
  high: { shell: "bg-gold-soft/60", badge: "bg-gold text-ink" },
  medium: { shell: "bg-amber-soft/60", badge: "bg-amber text-ink" },
  low: { shell: "bg-bg-soft", badge: "bg-blue-soft text-foreground" },
};

const LANE_DOT: Record<BriefingLane, string> = {
  urgent: "bg-danger",
  approval: "bg-gold",
  today: "bg-amber",
  notice: "bg-blue",
};

function itemAriaLabel(item: BriefingItem): string {
  const detail = item.detail?.replace(/[.!?]\s*$/, "");
  return [item.label, item.countLabel, detail ? `상세: ${detail}` : null, item.actionLabel]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/**
 * 이어서 처리할 한 줄 — 행 사이 헤어라인만, 행마다 카드로 싸지 않는다(§11). 행 전체가 링크(§10).
 * 1차 라벨은 16px(목록 1차 라벨 하한, §2), 상세는 14px 보조.
 */
function QueueItem({ item, index }: { item: BriefingItem; index: number }) {
  return (
    <li>
      <WindowLink
        href={item.href}
        title={item.label}
        ariaLabel={itemAriaLabel(item)}
        className="hover:bg-bg-soft focus-visible:ring-primary/35 group flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-text-faint num w-5 shrink-0 text-xs font-bold" aria-hidden="true">
          {String(index + 2).padStart(2, "0")}
        </span>
        <span className={`${LANE_DOT[item.lane]} size-2 shrink-0 rounded-full`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-foreground text-sm font-bold">{item.label}</span>
            {item.countLabel ? (
              <span className="text-text-dim num text-sm font-bold">{item.countLabel}</span>
            ) : null}
          </span>
          {item.detail ? (
            <span className="text-text-dim mt-0.5 block truncate text-xs">{item.detail}</span>
          ) : null}
        </span>
        <EyIcon
          name="arrowRight"
          size={14}
          className="text-text-faint group-hover:text-primary shrink-0 transition-colors"
        />
      </WindowLink>
    </li>
  );
}

/**
 * 조회한 운영 데이터를 우선순위가 고정된 실행 큐로 보여준다.
 * 서버 컴포넌트는 판단 근거만 직렬화하고, 실제 변경은 각 원본 화면에서 사용자가 확정한다.
 *
 * 2026-09-03(디자인 v5): 운영실 1차 화면의 세 앵커 중 하나. 아이콘 칩·그라데이션·장식 원·"카드 안의 카드"
 * (먼저 할 일 박스 안 박스 · 이어서 처리 박스 · 행마다 테두리)·설명 문장 3개를 뺐다(지시서 §4·§9·§11).
 * 남은 것은 상태 배지 + 먼저 할 일(평면 틴트 + Primary 하나) + 헤어라인 목록 + 지켜볼 신호.
 */
export function OperationsBriefing({ briefing }: { briefing: OperationsBriefingData }) {
  const checkedAt = new Date().toISOString();
  const state = STATE_META[briefing.assistantState];
  const activeSummary = SUMMARY.filter((item) => briefing.counts[item.lane] > 0);
  const focusStyle = briefing.focus ? PRIORITY_STYLE[briefing.focus.priority] : null;

  return (
    <section
      data-help="dash-briefing"
      className="bg-card shadow-card overflow-hidden rounded-2xl"
      aria-labelledby="operations-briefing-title"
    >
      <header className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {/* 제목은 하나(§4 중복 라벨 금지 — 옛 eyebrow "오늘 브리핑"은 뺐다) + 상태 배지. 요약 문장(briefing.summary)도 뺐다 —
              오른쪽 칩(긴급 N·오늘 N)과 아래 '먼저 할 일'이 같은 말을 이미 한다(§4 설명 문장, 리뷰 2026-09-03). */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="operations-briefing-title" className="text-foreground text-lg font-bold tracking-tight">
              Aywa의 운영 브리핑
            </h2>
            <span className={`${state.tone} inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold ring-1 ring-inset`}>
              <span className={`${state.dot} size-1.5 rounded-full`} aria-hidden="true" />
              {state.label}
            </span>
          </div>
        </div>

        {activeSummary.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-1.5 lg:justify-end" aria-label="운영 신호 종류별 개수">
            {activeSummary.map((item) => (
              <span
                key={item.lane}
                className={`${item.tone} inline-flex items-baseline gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset`}
              >
                {item.label}
                <span className="num text-xs font-bold">{briefing.counts[item.lane]}</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="px-4 pb-4 sm:px-5">
        {briefing.focus && focusStyle ? (
          <div className={`grid items-start gap-4 ${briefing.queue.length > 0 ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)]" : "grid-cols-1"}`}>
            <article className={`${focusStyle.shell} flex flex-col rounded-xl p-4 sm:p-5`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-text-dim text-sm font-bold">먼저 할 일</p>
                <span className={`${focusStyle.badge} rounded-full px-2.5 py-1 text-xs font-bold`}>
                  {briefing.focus.lane === "urgent"
                    ? "긴급"
                    : briefing.focus.lane === "approval"
                      ? "승인 필요"
                      : "오늘 처리"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-foreground text-xl font-bold leading-tight tracking-tight">
                  {briefing.focus.label}
                </h3>
                {briefing.focus.countLabel ? (
                  <span className="text-foreground num text-base font-bold">
                    {briefing.focus.countLabel}
                  </span>
                ) : null}
              </div>
              {briefing.focus.detail ? (
                <p className="text-text-dim mt-1.5 text-sm leading-relaxed">{briefing.focus.detail}</p>
              ) : null}
              <div className="mt-4">
                {/* 이 창의 Primary 하나(§10) — 치수는 control-scale의 큰 컨트롤(라벨 22 · 높이 26). */}
                <WindowLink
                  href={briefing.focus.href}
                  title={briefing.focus.label}
                  ariaLabel={itemAriaLabel(briefing.focus)}
                  className={`${CONTROL_H_LG} ${CONTROL_LABEL_LG} bg-ink hover:bg-foreground focus-visible:ring-primary/40 inline-flex w-fit items-center gap-2 rounded-lg px-4 font-bold whitespace-nowrap text-white transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none`}
                >
                  {briefing.focus.actionLabel}
                  {/* 아이콘은 라벨(22px)의 ±10% 안 — 20px. */}
                  <EyIcon name="arrowRight" size={20} />
                </WindowLink>
              </div>
            </article>

            {briefing.queue.length > 0 ? (
              <section aria-labelledby="assistant-queue-title">
                <header className="flex items-baseline justify-between gap-2 px-2 pb-1">
                  <h3 id="assistant-queue-title" className="text-foreground text-sm font-bold">이어서 처리</h3>
                  <span className="text-text-dim num text-sm font-bold">{briefing.queue.length}개</span>
                </header>
                <ol className="divide-line divide-y">
                  {briefing.queue.map((item, index) => (
                    <QueueItem key={item.key} item={item} index={index} />
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="bg-green-soft/40 flex items-center gap-3 rounded-xl p-4 sm:p-5">
            <EyIcon name="check" size={20} strokeWidth={1.8} className="text-green shrink-0" />
            <h3 className="text-foreground text-base font-bold">지금 바로 처리할 운영 신호가 없습니다</h3>
          </div>
        )}

        {briefing.watchList.length > 0 ? (
          <section className="border-line mt-4 border-t px-1 pt-3" aria-labelledby="assistant-watch-title">
            <h3 id="assistant-watch-title" className="text-foreground text-sm font-bold">지켜볼 신호</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {briefing.watchList.map((item) => (
                <li key={item.key}>
                  <WindowLink
                    href={item.href}
                    title={item.label}
                    ariaLabel={itemAriaLabel(item)}
                    // 치수는 control-scale(높이 = 라벨 + 4) — 세로 패딩으로 높이를 만들지 않는다.
                    className={`${CONTROL_H} ${CONTROL_LABEL} border-line bg-blue-soft/35 hover:border-blue/30 focus-visible:ring-primary/35 inline-flex items-center gap-2 rounded-lg border px-3 font-bold whitespace-nowrap transition focus-visible:ring-2 focus-visible:outline-none`}
                  >
                    <span className="bg-blue size-1.5 rounded-full" aria-hidden="true" />
                    {item.label}
                    {item.countLabel ? <span className="text-text-dim num">{item.countLabel}</span> : null}
                  </WindowLink>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="border-line text-text-dim flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs sm:px-5">
        <BriefingAutoRefresh checkedAt={checkedAt} />
      </footer>
    </section>
  );
}
