/**
 * 등록상담 파이프라인 — 대기 → 예약 → 완료 → AI대기 단계 분포(비례 바 + 단계별 카운트).
 * 카운트 합으로 납작했던 상담 데이터를 퍼널로. AI대기는 gold 강조(명시 트리거 진단 준비됨).
 */
import { DashCard, DashEmpty } from "./dash-card";
import type { ConsultationPipeline } from "@/features/dashboard/server/queries";

const STAGES = [
  { key: "pending", label: "대기", bar: "bg-foreground/30", text: "text-text-dim" },
  { key: "scheduled", label: "예약", bar: "bg-blue", text: "text-blue" },
  { key: "consulted", label: "완료", bar: "bg-primary", text: "text-primary" },
  { key: "aiDone", label: "AI 대기", bar: "bg-gold", text: "text-gold" },
] as const;

export function ConsultationFunnel({ pipeline }: { pipeline: ConsultationPipeline }) {
  const total = pipeline.total;
  return (
    <DashCard
      title="등록상담 파이프라인"
      count={total > 0 ? `${total}건` : undefined}
      href="/enrollment"
      hrefLabel="등록상담 →"
    >
      {total === 0 ? (
        <DashEmpty>진행 중인 등록상담이 없습니다</DashEmpty>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-3 pt-1">
          <div className="flex h-2.5 overflow-hidden rounded-full">
            {STAGES.map((s) => {
              const v = pipeline[s.key];
              if (v === 0) return null;
              return (
                <span key={s.key} className={s.bar} style={{ width: `${(v / total) * 100}%` }} />
              );
            })}
          </div>
          <div className="grid grid-cols-4 gap-1">
            {STAGES.map((s) => (
              <div key={s.key} className="text-center">
                <div className={`num text-[18px] font-extrabold leading-none ${s.text}`}>
                  {pipeline[s.key]}
                </div>
                <div className="text-text-faint mt-1 text-[10px]">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashCard>
  );
}
