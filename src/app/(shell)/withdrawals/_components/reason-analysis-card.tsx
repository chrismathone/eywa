import { AlertCircle } from "@/components/icons/aywa-icon-compat";
import { EmbedLink } from "@/components/embed-link";

/** 막대 한 줄 — 누르면 명단이 그 값으로 걸러진다(고른 막대는 해제 주소). */
export type ReasonBar = { value: string; label: string; count: number; href: string; active: boolean };

/**
 * **사유 분석 카드**(퇴원관리 명단 옆) — 퇴원 사유 + 수강종료 사유. 막대 숫자 = 눌러 거른 명단 수(`reasonFacetOf`).
 * 대분류 막대를 고르면 그 아래에 **세부 사유** 막대가 선다(원장 2026-10-15 사유 2단계 — `detail=` 필터 · `reason-detail.ts`).
 * 🔑 `data-withdrawal-reasons` = 명단 크기 계산(`WithdrawalListLayout`)이 이 카드 높이를 잰다 — 표식을 지우지 말 것.
 */
export function ReasonAnalysisCard({ noun, base, unspecified, bars, cleanup, details, summary }: {
  noun: string;
  /** 비중의 분모 — 장부 정리를 뺀 줄 수. */
  base: number;
  /** 사유 미기재 건수(머리 문구). */
  unspecified: number;
  bars: ReasonBar[];
  /** 장부 정리(일괄 퇴원 · 실제 사유 아님) — 막대·비중에서 빼고 한 줄로. */
  cleanup: { count: number; href: string; active: boolean } | null;
  /** 고른 대분류의 세부 막대(세부가 있는 대분류를 골랐을 때만). */
  details: { reasonLabel: string; total: number; rows: ReasonBar[] } | null;
  summary: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    // 세로 묶음 — 명단과 같은 높이로 늘어나면 '자동 요약'이 바닥에 붙는다(list-layout.module.css · 원장 2026-11-11 "좌우 높이 맞춰").
    <section data-withdrawal-reasons className="bg-card shadow-card flex flex-col overflow-hidden rounded-2xl">
      <header className="border-line border-b px-5 py-4">
        <p className="micro text-amber">사유 분석</p>
        <h2 className="text-foreground mt-1 text-base font-bold">상위 {noun} 사유</h2>
        <p className="mt-1 text-xs">
          {base}건 기준 · 사유 필터 제외
          {unspecified ? ` · 사유 미기재 ${unspecified}건 포함` : ""}
          {" · 막대를 누르면 명단이 그 사유로 걸러집니다(메모는 명단 줄에)"}
        </p>
      </header>
      <div className="space-y-2 p-5">
        {bars.map((b) => (
          <div key={b.value}>
            <Bar bar={b} max={max} total={base} />
            {b.active && details ? <DetailBars details={details} /> : null}
          </div>
        ))}
        {/* 장부 정리 = 일괄 퇴원(수업 없는 학생을 장부에서 정리한 것) — 실제 사유가 아니라 막대·비중에서 뺀다. 눌러서 명단은 볼 수 있다. */}
        {cleanup ? (
          <EmbedLink
            href={cleanup.href}
            scroll={false}
            aria-current={cleanup.active ? "true" : undefined}
            className="text-text-faint hover:text-foreground block pt-1 text-xs transition"
          >
            장부 정리(일괄 퇴원 · 실제 사유 아님) {cleanup.count}건은 사유 통계에서 뺐습니다 ·{" "}
            <span className="underline underline-offset-2">{cleanup.active ? "필터 해제" : "명단 보기"}</span>
          </EmbedLink>
        ) : null}
      </div>
      {/* 규칙 기반 자동 요약 (LLM 아님) — sparkle(AI 마커) 대신 pulse로 라이브 AI와 구분 */}
      <div className="border-line bg-amber-soft mt-auto border-t px-5 py-4">
        <div className="flex items-start gap-2.5">
          <span className="bg-amber/15 text-amber flex size-7 shrink-0 items-center justify-center rounded-md">
            <AlertCircle size={13} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-amber text-xs font-bold">자동 요약</p>
            <p className="text-foreground mt-0.5 text-xs leading-relaxed">{summary}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Bar({ bar: b, max, total, soft }: { bar: ReasonBar; max: number; total: number; soft?: boolean }) {
  return (
    <EmbedLink
      href={b.href}
      scroll={false}
      aria-current={b.active ? "true" : undefined}
      aria-label={`${b.label} ${b.count}건${b.active ? " · 필터 해제" : " · 명단 거르기"}`}
      className="hover:bg-bg-soft -mx-1 block rounded-md px-1 py-0.5 transition"
    >
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`truncate text-xs ${soft ? "font-semibold" : "font-bold"} ${b.active ? "text-primary" : "text-foreground"}`}>{b.label}</span>
        <span className="text-text-dim num shrink-0 text-xs">
          <span className="text-foreground font-bold">{b.count}</span>건 · {Math.round((b.count / Math.max(total, 1)) * 100)}%
        </span>
      </span>
      <span className={`bg-bg-soft block ${soft ? "h-1.5" : "h-2"} overflow-hidden rounded-full`}>
        <span className={`${b.active ? "bg-primary" : soft ? "bg-amber" : "bg-rose"} block h-full`} style={{ width: `${(b.count / max) * 100}%` }} />
      </span>
    </EmbedLink>
  );
}

/** 고른 대분류의 세부 막대 — 비중의 분모는 그 대분류 건수(세부를 고르지 않은 줄 포함). */
function DetailBars({ details }: { details: NonNullable<Parameters<typeof ReasonAnalysisCard>[0]["details"]> }) {
  const max = Math.max(1, ...details.rows.map((r) => r.count));
  return (
    <div className="bg-bg-soft mt-1.5 mb-2 space-y-1.5 rounded-lg px-3 py-2.5" aria-label={`${details.reasonLabel} 세부 사유`}>
      <p className="text-text-faint text-xs">세부 사유 · {details.reasonLabel} {details.total}건 기준</p>
      {details.rows.map((r) => (
        <Bar key={r.value} bar={r} max={max} total={details.total} soft />
      ))}
    </div>
  );
}
