"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "@/components/icons/aywa-icon-compat";
import { createClient } from "@/lib/supabase/client";
import { PREP_BRIEF_STALL_MS } from "@/features/enrollment/prep-stall";

/**
 * 브리프 생성 진행 UI — 진행바 + 단계 문구 + 자동 새로고침 watcher.
 *
 * LLM 생성은 실제 진행률을 알 수 없어 **시간 기반 근사**로 그린다: 심층 분석 모델 실측
 * 20~60초를 기준으로 90%까지 감속 진행하고, 완료는 watcher가 페이지를 새로고침하며 컴포넌트째
 * 사라진다(가짜 100% 고정 화면이 없다). ConsultationStatusWatcher와 동일한 realtime+5초 폴링.
 */
const EXPECTED_SEC = 75;
/**
 * 이 시간을 넘기면 "멈춘 것 같다"고 알리고 다시 시도할 길을 준다. 백그라운드 작업이 플랫폼 타임아웃·
 * 배포 교체로 죽으면 status가 'generating'에 남아 **진행바가 영원히 돈다** — 사람이 빠져나갈 수
 * 있어야 한다(끝나지 않는 스피너는 고장과 구분이 안 된다).
 */
const STALL_SEC = PREP_BRIEF_STALL_MS / 1000;
// 단계 문구는 시간 근사다 — 실제 작업 단계를 아는 것처럼 '검증하고 있습니다'라 하지 않는다(검수 2026-11-11 · Codex).
const STAGES: [number, string][] = [
  [0, "접수 정보와 학원 데이터를 정리하고 있습니다"],
  [8, "AI가 상담 스크립트를 작성하고 있습니다"],
  [30, "작성한 내용을 마무리하고 있습니다"],
];

export function PrepBriefProgress({ consultationId, jobAt = null }: { consultationId: string; jobAt?: string | null }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);

  // 작업 시작 시각(서버 기록)부터 센다 — 화면을 다시 열어도 경과가 처음부터 시작하지 않게(s2_0068). 없으면 연 때부터.
  useEffect(() => {
    const started = jobAt ? Date.parse(jobAt) : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    const first = window.setTimeout(tick, 0);
    const t = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [jobAt]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`prep-brief:${consultationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "enrollment_consultations",
          filter: `id=eq.${consultationId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    const poll = window.setInterval(() => router.refresh(), 5000);
    return () => {
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [consultationId, router]);

  // 감속 곡선: 기대 시간에 90% 도달, 이후 아주 천천히 97%까지(멈춘 것처럼 안 보이게).
  const ratio = Math.min(1, elapsed / EXPECTED_SEC);
  const pct = elapsed <= EXPECTED_SEC ? Math.round(90 * (1 - Math.pow(1 - ratio, 2))) : Math.min(97, 90 + Math.round((elapsed - EXPECTED_SEC) / 5));
  const stage = STAGES.reduce((acc, [at, label]) => (elapsed >= at ? label : acc), STAGES[0]![1]);
  const stalled = elapsed >= STALL_SEC;

  if (stalled) {
    return (
      <div className="space-y-1">
        <p className="text-foreground inline-flex items-center gap-2 text-sm">
          <AlertCircle className="text-chart-4 size-4" />
          생성이 예상보다 오래 걸립니다
        </p>
        <p className="text-text-dim text-xs">
          잠시 후 새로고침하거나 ‘다시 작성’을 눌러 주세요. 이전 브리프가 있으면 그대로 남아 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-foreground inline-flex items-center gap-2 text-sm">
        <Loader2 className="text-primary size-4 animate-spin" />
        <span>{stage}…</span>
        <span className="num text-text-dim text-xs">{pct}%</span>
      </div>
      <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-text-dim text-xs">
        보통 1분 내외 걸립니다. 페이지를 떠나도 백그라운드에서 계속 진행됩니다.
      </p>
    </div>
  );
}
