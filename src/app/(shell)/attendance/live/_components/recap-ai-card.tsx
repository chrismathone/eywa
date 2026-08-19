"use client";

/**
 * 어제 출결 요약의 **AI 정리** 카드 — 선택 기능(원장 2026-08-19 *"필요하면 deepseek api 사용해서 정리할것"*).
 *
 * 🔴 페이지를 여는 것만으로는 절대 생성하지 않는다(CLAUDE.md AI 정책) — 버튼을 누를 때만 호출하고,
 *    마지막 결과는 다시 누르기 전까지 그대로 남는다.
 * 🔴 이 카드가 비어 있어도 아래 집계는 온전하다 — **숫자·명단의 진실은 결정론 다이제스트**이고
 *    여기 문장은 그것을 읽는 순서로 다시 배열한 것뿐이다. 그래서 실패 문구도 "아래 집계를 쓰라"고 말한다.
 * 생성은 `after()` 백그라운드라 완료를 폴링으로 받는다(일일 브리핑 '다시 생성'과 같은 규약).
 */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sparkles } from "@/components/icons/eywa-icon-compat";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { generateRecapSummary } from "@/features/attendance/recap/server/actions";
import type { RecapBrief } from "@/features/attendance/recap/prompt";

export type RecapAiState = {
  status: string; // idle | analyzing | completed | failed
  brief: RecapBrief | null;
  error: string | null;
  model: string | null;
} | null;

export function RecapAiCard({ date, state }: { date: string; state: RecapAiState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const analyzing = state?.status === "analyzing";
  const modelLabel = modelDisplayLabel(state?.model);

  useEffect(() => {
    if (!analyzing) return;
    // 상한 3분(36틱) — 정상 생성보다 훨씬 길게 두되, after()가 죽어 analyzing으로 굳은 날
    // 하루 종일 5초마다 RSC를 재실행하지 않는다(브리핑 워처와 같은 상한).
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 36) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [analyzing, router]);

  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-purple-soft text-purple flex size-7 shrink-0 items-center justify-center rounded-lg">
          <Sparkles size={15} />
        </span>
        <h2 className="text-sm font-bold">AI 정리</h2>
        {modelLabel && state?.brief ? (
          <span className="text-text-faint text-[11px]">{modelLabel}</span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          // analyzing이어도 누를 수 있어야 서버의 '5분 고착 우회'에 도달한다(잠그면 죽은 코드).
          // 진행 중 클릭은 서버가 "이미 진행 중"으로 안전하게 거절한다.
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await generateRecapSummary(date);
              if (result?.error) setError(result.error);
              router.refresh();
            });
          }}
        >
          {pending ? "요청 중…" : analyzing ? "다시 시도" : state?.brief ? "다시 정리" : "AI로 정리"}
        </Button>
      </div>

      <div className="mt-3">
        {analyzing ? (
          <p className="text-text-dim text-[13px]">정리 중입니다… 완료되면 이 카드가 자동으로 갱신됩니다.</p>
        ) : state?.brief ? (
          <div className="space-y-2">
            <p className="text-[15px] leading-snug font-bold">{state.brief.headline}</p>
            <ul className="text-text-dim list-disc space-y-1 pl-4 text-[13px] leading-relaxed">
              {state.brief.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-text-faint text-[13px]">
            아래 집계가 이 화면의 사실입니다. 문장으로 정리해 두려면 「AI로 정리」를 누르세요.
          </p>
        )}
        {/* 후검증 탈락·생성 실패는 숨기지 않는다 — 다만 아래 집계는 멀쩡하다는 사실을 함께 말한다. */}
        {state?.status === "failed" && state.error ? (
          <p className="text-amber-strong mt-2 text-[12px]">{state.error}</p>
        ) : null}
        {error ? <p className="text-danger mt-2 text-[12px]">{error}</p> : null}
      </div>
    </section>
  );
}
