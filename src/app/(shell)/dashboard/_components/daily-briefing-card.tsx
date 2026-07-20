import { EyIcon } from "@/components/icons/eywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import type { DailyBriefingRow } from "@/features/dashboard/server/briefing";
import { buildFallbackTeamReport, type TeamReport } from "@/features/dashboard/briefing-team-report";
import { DailyBriefingRegen } from "./daily-briefing-regen";

/**
 * 일일 브리핑 카드 v2 — "학원 매니저 팀" 보고. **저장분 렌더만**(페이지 로드 AI 호출 없음).
 * 노출은 page.tsx의 canManageStaff(master/admin/manager) 게이트 뒤(#77). model_version 미노출.
 * 스포트라이트(위험 학생 이름·사유·권장 조치)는 payload 결정론 값을 직접 렌더 — LLM 보고가 어긋나도
 * 이 칩이 진실이다. LLM 실패·검증 탈락 시 buildFallbackTeamReport(결정론)로 같은 구조를 유지.
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

const AREA_TONE: Record<string, string> = {
  수업: "bg-blue-soft text-foreground ring-blue/20",
  학생: "bg-amber-soft text-foreground ring-amber/25",
  상담: "bg-primary-soft text-primary ring-primary/20",
  수납: "bg-gold-soft text-foreground ring-gold/25",
  운영: "bg-bg-soft text-text-dim ring-line",
};

export function DailyBriefingCard({ briefing }: { briefing: DailyBriefingRow | null }) {
  const analyzing = briefing?.processing_status === "analyzing";
  const failed = briefing?.processing_status === "failed";
  const completed = briefing?.processing_status === "completed";
  const payload = briefing?.payload ?? null;
  // 우선순위: 검증 통과한 팀 보고 → (구 행) v1 narrative → 결정론 폴백. 폴백/구행 표시는 degraded 배지로 정직하게.
  const report: TeamReport | null = completed
    ? (briefing?.team_report ?? (payload ? buildFallbackTeamReport(payload) : null))
    : null;
  const legacyNarrative = completed && !briefing?.team_report && briefing?.narrative ? briefing.narrative : null;
  const degraded = completed && !briefing?.team_report && Boolean(briefing?.processing_error);

  return (
    <section
      className="bg-card border-line/60 shadow-card overflow-hidden rounded-2xl border"
      aria-labelledby="daily-briefing-title"
    >
      <div className="flex flex-col gap-3 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          <span
            className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-2xl"
            aria-hidden="true"
          >
            <EyIcon name="sparkle" size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-primary text-[12px] font-bold">
                오늘 브리핑
              </p>
              {briefing?.generated_at ? (
                <span className="text-text-faint text-[12px]">{kstTimeLabel(briefing.generated_at)} 보고</span>
              ) : null}
            </div>
            <h2 id="daily-briefing-title" className="text-foreground mt-1.5 text-[17px] font-bold leading-snug tracking-tight">
              {completed && report ? report.headline : "매니저 팀 아침 보고"}
            </h2>

            {analyzing ? (
              <p className="text-text-dim mt-2 text-[13.5px] leading-relaxed">
                매니저 팀이 보고를 준비하는 중입니다… 완료되면 화면이 자동으로 갱신됩니다.
              </p>
            ) : failed ? (
              <p className="text-danger mt-2 text-[13.5px] leading-relaxed" title={briefing?.processing_error ?? undefined}>
                보고 생성에 실패했습니다. 다시 생성해 주세요.
              </p>
            ) : legacyNarrative ? (
              <p className="text-foreground mt-2 text-[13.5px] leading-relaxed">{legacyNarrative}</p>
            ) : completed && report ? (
              <ul className="mt-3.5 space-y-2.5">
                {report.managers.map((manager) => (
                  <li key={manager.area} className="flex items-start gap-3">
                    <span
                      className={`${AREA_TONE[manager.area] ?? AREA_TONE["운영"]} mt-px inline-flex w-12 shrink-0 justify-center rounded-full py-1 text-[11px] font-bold ring-1 ring-inset`}
                    >
                      {manager.area}
                    </span>
                    <p className="text-foreground min-w-0 text-[13.5px] leading-relaxed">{manager.report}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-dim mt-2 text-[13.5px] leading-relaxed">
                오늘 보고가 아직 없습니다. 매일 아침 자동으로 생성되며, 지금 바로 만들 수도 있습니다.
              </p>
            )}

            {degraded ? (
              <p className="text-text-dim mt-2 text-[12px]" title={briefing?.processing_error ?? undefined}>
                AI 보고 생성에 실패해 요약으로 대신 표시했습니다.
              </p>
            ) : null}

            {completed && payload && payload.spotlights.length > 0 ? (
              <div className="border-line/70 mt-4 border-t pt-3.5">
                <p className="text-foreground text-[13px] font-bold">
                  살펴볼 학생{" "}
                  <span className="text-text-faint font-medium">{payload.spotlights.length}</span>
                </p>
                <ul className="mt-1.5 grid gap-x-2 gap-y-0.5 lg:grid-cols-2">
                  {payload.spotlights.map((s, i) => (
                    // 이름만으론 동명이인 key 충돌 — payload가 studentId를 안 담는 동안 index로 유일화.
                    <li key={`${s.name}-${i}`}>
                      <WindowLink
                        href="/retention"
                        title="이탈 방어"
                        ariaLabel={`${s.name} — ${s.reasons.join(", ")}`}
                        className="group hover:bg-bg-soft -mx-2 flex items-center gap-2.5 rounded-xl px-2 py-2 transition"
                      >
                        <span className="text-foreground shrink-0 text-[13.5px] font-bold">{s.name}</span>
                        <span className="text-text-dim min-w-0 flex-1 truncate text-[12.5px]">
                          {s.reasons.slice(0, 2).join(" · ")}
                        </span>
                        {s.action ? (
                          <span className="bg-primary-soft text-primary hidden shrink-0 items-center rounded-pill px-2.5 py-1 text-[11px] font-bold sm:inline-flex">
                            {s.action}
                          </span>
                        ) : null}
                      </WindowLink>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {completed && payload && payload.sourceIssueLabels.length > 0 ? (
              <p className="text-text-faint mt-2 text-[12px]">
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
