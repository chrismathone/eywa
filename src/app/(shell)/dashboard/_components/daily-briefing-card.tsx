import { EyIcon } from "@/components/icons/eywa-icons";
import type { DailyBriefingRow } from "@/features/dashboard/server/briefing";
import { buildFallbackNarrative } from "@/features/dashboard/briefing-digest";
import { DailyBriefingRegen } from "./daily-briefing-regen";

/**
 * 일일 AI 브리핑 카드 — **저장분 렌더만**(페이지 로드로 AI 호출 없음, CLAUDE.md AI 정책).
 * 노출은 page.tsx의 canManageStaff(master/admin/manager) 게이트 뒤 — payload가 master 관점
 * 전신호(#77)라 counselor/accountant scoped에는 렌더하지 않는다. model_version은 표시하지 않는다.
 */
function kstTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DailyBriefingCard({ briefing }: { briefing: DailyBriefingRow | null }) {
  const analyzing = briefing?.processing_status === "analyzing";
  const failed = briefing?.processing_status === "failed";
  const completed = briefing?.processing_status === "completed";
  const payload = briefing?.payload ?? null;
  // narrative 없음 + payload 있음 = "AI 서술만 실패/스킵" — 결정론 요약으로 대체(정직성).
  const narrative = completed ? (briefing?.narrative ?? (payload ? buildFallbackNarrative(payload) : null)) : null;
  const narrativeDegraded = completed && !briefing?.narrative && Boolean(briefing?.processing_error);

  return (
    <section
      className="bg-card border-line shadow-card overflow-hidden rounded-2xl border"
      aria-labelledby="daily-briefing-title"
    >
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-xl"
            aria-hidden="true"
          >
            <EyIcon name="sparkle" size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-primary font-mono text-[10px] font-bold tracking-[0.13em] uppercase">
                Daily briefing
              </p>
              {briefing?.generated_at ? (
                <span className="text-text-dim text-[11px]">{kstTimeLabel(briefing.generated_at)} 생성</span>
              ) : null}
            </div>
            <h2 id="daily-briefing-title" className="text-foreground mt-1 text-[15px] font-extrabold tracking-tight">
              오늘의 브리핑
            </h2>
            {analyzing ? (
              <p className="text-text-dim mt-1 text-[12.5px] leading-relaxed">
                브리핑을 생성하는 중입니다… 완료되면 화면이 자동으로 갱신됩니다.
              </p>
            ) : failed ? (
              <p className="text-danger mt-1 text-[12.5px] leading-relaxed" title={briefing?.processing_error ?? undefined}>
                브리핑 생성에 실패했습니다. 다시 생성해 주세요.
              </p>
            ) : narrative ? (
              <p className="text-foreground mt-1 max-w-3xl text-[13px] leading-relaxed">{narrative}</p>
            ) : (
              <p className="text-text-dim mt-1 text-[12.5px] leading-relaxed">
                오늘 브리핑이 아직 없습니다. 매일 아침 자동으로 생성되며, 지금 바로 만들 수도 있습니다.
              </p>
            )}
            {narrativeDegraded ? (
              <p className="text-text-dim mt-1 text-[11px]" title={briefing?.processing_error ?? undefined}>
                AI 서술 생성에 실패해 요약문으로 대신 표시했습니다.
              </p>
            ) : null}
            {completed && payload && payload.sourceIssueLabels.length > 0 ? (
              <p className="text-text-dim mt-1 text-[11px]">
                확인 불가(조회 실패): {payload.sourceIssueLabels.join("·")}
              </p>
            ) : null}
          </div>
        </div>
        <DailyBriefingRegen analyzing={analyzing} />
      </div>
    </section>
  );
}
