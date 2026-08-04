import type { ClassHistoryEntry, ClassHistorySource } from "@/features/classes/history";

/**
 * 반 상세 '이력' — 배치 구간·감사로그·임시 위임을 한 줄기로(원장 2026-08-04).
 *
 * ⚠️ 출처를 **알약으로 밝힌다** — 같은 타임라인에 섞여 있어도 "무엇이 사실이고 무엇이 사람이 한 일인지"가
 *    보여야 한다. 출처를 감추면 나중에 "이 줄은 어디서 나온 거냐"에 답할 수 없다.
 */
const SOURCE_LABEL: Record<ClassHistorySource, string> = {
  schedule: "배치",
  audit: "기록",
  delegation: "위임",
  report: "보고서",
};

const SOURCE_TONE: Record<ClassHistorySource, string> = {
  schedule: "border-line-strong text-text-dim",
  audit: "border-primary/40 text-primary bg-primary/5",
  delegation: "border-amber/50 text-amber bg-amber-soft",
  report: "border-line-strong text-text-faint",
};

export function ClassHistorySection({ entries }: { entries: ClassHistoryEntry[] }) {
  return (
    <section className="bg-card shadow-card rounded-2xl px-4 py-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-foreground text-sm font-bold">이력</h2>
        <p className="text-text-dim text-xs break-keep">
          수업 배치·담당·강의실이 바뀐 기록입니다. 시간표에서 그 주를 열면 당시 배치가 그대로 보입니다.
        </p>
      </header>

      {entries.length === 0 ? (
        // 원인을 정확히 — "기록이 없다"와 "이 반은 안 바뀌었다"는 다르다.
        <p className="text-text-dim mt-3 text-sm break-keep">
          남아 있는 변경 기록이 없습니다. 2026-08-04 이전의 담당·강의실 변경은 기록 자체가 남지 않아
          되살릴 수 없고, 이후의 변경부터 이 자리에 쌓입니다.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {entries.map((e, i) => (
            <li key={`${e.date}-${e.source}-${i}`} className="border-line flex gap-3 border-t pt-2 first:border-t-0 first:pt-0">
              <span className="num text-text-dim w-[92px] shrink-0 text-[12px] whitespace-nowrap">
                {e.date}
                {e.endDate ? (
                  <span className="text-text-faint block text-[11px]">~{e.endDate}</span>
                ) : e.source === "schedule" ? (
                  <span className="text-text-faint block text-[11px]">~ 현재</span>
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-pill border px-1.5 py-px text-[10px] font-bold ${SOURCE_TONE[e.source]}`}
                  >
                    {SOURCE_LABEL[e.source]}
                  </span>
                  <span className="text-foreground text-[13px] font-semibold break-keep">{e.title}</span>
                  {e.actor ? <span className="text-text-faint text-[11px]">· {e.actor}</span> : null}
                </span>
                {e.detail ? (
                  <span className="text-text-dim mt-0.5 block text-[12px] break-keep">{e.detail}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
