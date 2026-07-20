import { EyIcon } from "@/components/icons/eywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
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
  steady: {
    label: "운영 안정",
    dot: "bg-primary",
    tone: "bg-primary-soft/70 text-primary ring-primary/20",
  },
};

const PRIORITY_STYLE: Record<BriefingPriority, { shell: string; badge: string }> = {
  critical: {
    shell: "border-danger/25 bg-[linear-gradient(145deg,var(--card),var(--danger-soft))]",
    badge: "bg-danger text-white",
  },
  high: {
    shell: "border-gold/35 bg-[linear-gradient(145deg,var(--card),var(--gold-soft))]",
    badge: "bg-gold text-ink",
  },
  medium: {
    shell: "border-amber/30 bg-[linear-gradient(145deg,var(--card),var(--amber-soft))]",
    badge: "bg-amber text-ink",
  },
  low: {
    shell: "border-line bg-card",
    badge: "bg-blue-soft text-foreground",
  },
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

function QueueItem({ item, index }: { item: BriefingItem; index: number }) {
  return (
    <li>
      <WindowLink
        href={item.href}
        title={item.label}
        ariaLabel={itemAriaLabel(item)}
        className="border-line bg-card hover:border-primary/25 hover:bg-primary-soft/25 focus-visible:ring-primary/35 group flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2.5 transition focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-text-faint num w-4 shrink-0 text-[10px] font-bold" aria-hidden="true">
          {String(index + 2).padStart(2, "0")}
        </span>
        <span className={`${LANE_DOT[item.lane]} size-2 shrink-0 rounded-full`} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-foreground text-[12.5px] font-bold">{item.label}</span>
            {item.countLabel ? (
              <span className="text-text-dim num text-[10.5px] font-bold">{item.countLabel}</span>
            ) : null}
          </span>
          {item.detail ? (
            <span className="text-text-dim mt-0.5 block truncate text-[11.5px]">{item.detail}</span>
          ) : null}
        </span>
        <EyIcon
          name="arrowRight"
          size={13}
          className="text-text-faint group-hover:text-primary shrink-0 transition-colors"
        />
      </WindowLink>
    </li>
  );
}

/**
 * 조회한 운영 데이터를 우선순위가 고정된 실행 큐로 보여준다.
 * 서버 컴포넌트는 판단 근거만 직렬화하고, 실제 변경은 각 원본 화면에서 사용자가 확정한다.
 */
export function OperationsBriefing({ briefing }: { briefing: OperationsBriefingData }) {
  const checkedAt = new Date().toISOString();
  const state = STATE_META[briefing.assistantState];
  const activeSummary = SUMMARY.filter((item) => briefing.counts[item.lane] > 0);
  const focusStyle = briefing.focus ? PRIORITY_STYLE[briefing.focus.priority] : null;

  return (
    <section
      className="bg-card border-line shadow-card overflow-hidden rounded-2xl border"
      aria-labelledby="operations-briefing-title"
    >
      <header className="border-line flex flex-col gap-3 border-b px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-xl"
            aria-hidden="true"
          >
            <EyIcon name="sparkle" size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-primary text-[11px] font-bold">
                AI 운영 브리핑
              </p>
              <span className={`${state.tone} inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10.5px] font-bold ring-1 ring-inset`}>
                <span className={`${state.dot} size-1.5 rounded-full`} aria-hidden="true" />
                {state.label}
              </span>
            </div>
            <h2 id="operations-briefing-title" className="text-foreground mt-1 text-[17px] font-bold tracking-tight">
              Eywa의 운영 브리핑
            </h2>
            <p className="text-text-dim mt-1 text-[12.5px] leading-relaxed">{briefing.summary}</p>
          </div>
        </div>

        {activeSummary.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-1.5 lg:justify-end" aria-label="운영 신호 종류별 개수">
            {activeSummary.map((item) => (
              <span
                key={item.lane}
                className={`${item.tone} inline-flex items-baseline gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-bold ring-1 ring-inset`}
              >
                {item.label}
                <span className="num text-[12px] font-bold">{briefing.counts[item.lane]}</span>
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <div className="p-3 sm:p-4">
        {briefing.focus && focusStyle ? (
          <div className={`grid items-stretch gap-3 ${briefing.queue.length > 0 ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(19rem,0.9fr)]" : "grid-cols-1"}`}>
            <article className={`${focusStyle.shell} relative flex overflow-hidden rounded-2xl border p-4 sm:p-5`}>
              <div className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full border border-current opacity-[0.04]" aria-hidden="true" />
              <div className="relative flex min-h-full w-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-text-dim text-[11px] font-bold">
                    먼저 할 일
                  </p>
                  <span className={`${focusStyle.badge} rounded-full px-2.5 py-1 text-[10.5px] font-bold`}>
                    {briefing.focus.lane === "urgent"
                      ? "긴급"
                      : briefing.focus.lane === "approval"
                        ? "승인 필요"
                        : "오늘 처리"}
                  </span>
                </div>
                <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-foreground text-[20px] font-bold leading-tight tracking-tight sm:text-[22px]">
                    {briefing.focus.label}
                  </h3>
                  {briefing.focus.countLabel ? (
                    <span className="text-foreground num text-[13px] font-bold">
                      {briefing.focus.countLabel}
                    </span>
                  ) : null}
                </div>
                <p className="text-text-dim mt-2 min-h-10 text-[12.5px] leading-relaxed">
                  {briefing.focus.detail ?? "원본 화면에서 내용을 확인하고 다음 조치를 결정해 주세요."}
                </p>
                <div className="mt-auto pt-5">
                  <WindowLink
                    href={briefing.focus.href}
                    title={briefing.focus.label}
                    ariaLabel={itemAriaLabel(briefing.focus)}
                    className="bg-ink hover:bg-foreground focus-visible:ring-primary/40 inline-flex min-h-11 w-fit items-center gap-2 rounded-xl px-4 py-2.5 text-[12.5px] font-bold text-white transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {briefing.focus.actionLabel}
                    <EyIcon name="arrowRight" size={14} />
                  </WindowLink>
                </div>
              </div>
            </article>

            {briefing.queue.length > 0 ? (
              <section className="border-line bg-bg-soft/45 rounded-2xl border p-3" aria-labelledby="assistant-queue-title">
                <header className="flex items-center justify-between gap-2 px-1 pb-2.5">
                  <div>
                    <h3 id="assistant-queue-title" className="text-foreground text-[13px] font-bold">이어서 처리</h3>
                    <p className="text-text-dim mt-0.5 text-[11px]">긴급 → 승인 → 오늘 순서입니다.</p>
                  </div>
                  <span className="text-text-dim num rounded-md bg-white/70 px-2 py-1 text-[10.5px] font-bold">
                    {briefing.queue.length}개
                  </span>
                </header>
                <ol className="space-y-1.5">
                  {briefing.queue.map((item, index) => (
                    <QueueItem key={item.key} item={item} index={index} />
                  ))}
                </ol>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="border-primary/20 bg-primary-soft/35 flex items-start gap-3 rounded-2xl border p-4 sm:p-5">
            <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
              <EyIcon name="check" size={17} strokeWidth={1.8} />
            </span>
            <div>
              <h3 className="text-foreground text-[14px] font-bold">지금 바로 처리할 운영 신호가 없습니다</h3>
              <p className="text-text-dim mt-1 text-[12px] leading-relaxed">
                긴급·승인·오늘 처리 항목은 정리됐습니다. 아래 참고 신호가 있다면 운영 맥락으로 확인하세요.
              </p>
            </div>
          </div>
        )}

        {briefing.watchList.length > 0 ? (
          <section className="border-line mt-3 border-t px-1 pt-3" aria-labelledby="assistant-watch-title">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 id="assistant-watch-title" className="text-foreground text-[12px] font-bold">지켜볼 신호</h3>
              <span className="text-text-dim text-[11px]">즉시 실행보다 상황 파악이 먼저인 항목입니다.</span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {briefing.watchList.map((item) => (
                <li key={item.key}>
                  <WindowLink
                    href={item.href}
                    title={item.label}
                    ariaLabel={itemAriaLabel(item)}
                    className="border-line bg-blue-soft/35 hover:border-blue/30 focus-visible:ring-primary/35 inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-[11.5px] font-bold transition focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span className="bg-blue size-1.5 rounded-full" aria-hidden="true" />
                    {item.label}
                    {item.countLabel ? <span className="text-text-dim num text-[10.5px]">{item.countLabel}</span> : null}
                  </WindowLink>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="border-line bg-bg-soft/45 text-text-dim flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[11px] sm:px-5">
        <BriefingAutoRefresh checkedAt={checkedAt} />
        <span>실제 변경은 원본 화면에서 확인한 뒤 실행됩니다.</span>
      </footer>
    </section>
  );
}
