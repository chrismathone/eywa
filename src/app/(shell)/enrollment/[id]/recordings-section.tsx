import { Loader2, Mic } from "@/components/icons/eywa-icon-compat";
import { TranscriptSection } from "@/components/transcript-section";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";
import type { ConsultationRecordingRow } from "@/features/enrollment/server/queries";

/**
 * 등록상담 녹음 행 목록 — 녹음이 여러 행으로 쌓인다(여러 상담사가 각자 추가, 0068a).
 * 행마다: 녹음 n · 일시 · 길이 · 크기 · 올린이 · 상태칩 + 전사(기본 접힘, TranscriptSection 재사용).
 * ⚠️ speakerRoles(화자→역할 AI 추론)는 녹음마다 화자 라벨이 독립이라 **완료된 녹음이 1개일 때만**
 * 적용(웹훅 multi 판정과 동일 기준 — 다중에 같은 맵을 적용하면 엉뚱한 역할 라벨이 붙는다).
 */

const REC_BADGE: Record<string, { label: string; class: string; spin?: boolean }> = {
  uploaded: { label: "전사 대기", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  transcribing: { label: "전사 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  analyzing: { label: "분석 중", class: "text-chart-3 bg-chart-3/10 border-chart-3/20", spin: true },
  completed: { label: "전사 완료", class: "text-primary bg-primary/10 border-primary/20" },
  failed: { label: "실패", class: "text-danger bg-danger/10 border-danger/20" },
  idle: { label: "대기", class: "text-text-dim bg-bg-soft border-line" },
};

const KST_DT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function fmtBytes(n: number | null): string | null {
  if (!n || n <= 0) return null;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function fmtDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

export function RecordingsSection({
  recordings,
  speakerRoles,
}: {
  recordings: ConsultationRecordingRow[];
  /** 상담 레벨 화자→역할 맵 — 호출부가 녹음 1개일 때만 넘긴다(다중이면 null). */
  speakerRoles: Record<string, string> | null;
}) {
  if (recordings.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Mic className="text-text-dim size-3.5" />
        <h2 className="text-foreground text-[13px] font-bold">
          상담 녹음 <span className="num text-text-faint font-normal">{recordings.length}개</span>
        </h2>
      </div>
      {recordings.map((r, i) => {
        const badge = REC_BADGE[r.status] ?? REC_BADGE.idle!;
        const meta = [
          KST_DT.format(new Date(r.createdAt)),
          fmtDuration(r.durationSec),
          fmtBytes(r.sizeBytes),
          r.recordedByName,
        ].filter(Boolean);
        return (
          <div key={r.id} className="border-line bg-card overflow-hidden rounded-md border">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="text-foreground text-[12px] font-bold whitespace-nowrap">
                녹음 {i + 1}
              </span>
              <span className="text-text-dim text-[11px]">{meta.join(" · ")}</span>
              <span
                className={`ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${badge.class}`}
              >
                {badge.spin ? <Loader2 className="size-3 animate-spin" /> : null}
                {badge.label}
              </span>
            </div>
            {r.status === "failed" && r.error ? (
              <p className="text-danger border-line border-t px-4 py-2 text-[12px]">{sanitizeErrorText(r.error)}</p>
            ) : null}
            {r.transcription || (r.speakerLabels?.length ?? 0) > 0 ? (
              <div className="border-line border-t">
                {/* frameless — 이 카드가 이미 테두리 박스라 자체 테두리를 빼 이중 박스 방지. */}
                <TranscriptSection
                  utterances={r.speakerLabels}
                  speakerRoles={speakerRoles}
                  plainText={r.transcription}
                  frameless
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
