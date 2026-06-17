import { getStudentTimeline, type TimelineEvent } from "@/features/students/server/queries";

const KIND_META: Record<
  TimelineEvent["kind"],
  { label: string; color: string }
> = {
  enrollment_start: { label: "수강 시작", color: "bg-chart-2 text-chart-2" },
  enrollment_end: { label: "수강 종료", color: "bg-chart-4 text-chart-4" },
  consultation: { label: "상담", color: "bg-chart-1 text-chart-1" },
  memo: { label: "메모", color: "bg-chart-3 text-chart-3" },
  status_change: { label: "상태 변경", color: "bg-chart-5 text-chart-5" },
  grade: { label: "성적", color: "bg-chart-2 text-chart-2" },
};

const CAP = 50;

export async function TimelineTab({ studentId }: { studentId: string }) {
  const events = await getStudentTimeline(studentId);
  // 최신순 정렬(쿼리에서 desc) → 최근 50건만 렌더(오래된 이벤트는 가치 낮음).
  const visible = events.slice(0, CAP);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">타임라인</h2>
        <p className="text-muted-foreground num text-xs">
          {events.length}건의 이벤트{events.length > CAP ? ` · 최근 ${CAP}건 표시` : ""}
        </p>
      </header>

      {events.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">이벤트가 없습니다</p>
      ) : (
        <ol className="border-border bg-card relative space-y-3 rounded-md border p-4 pl-8">
          {/* 타임라인 세로선 */}
          <span
            aria-hidden
            className="bg-border absolute top-4 bottom-4 left-[18px] w-px"
          />
          {visible.map((e, i) => {
            const meta = KIND_META[e.kind];
            return (
              <li key={i} className="relative">
                <span
                  aria-hidden
                  className={`absolute left-[-22px] top-[6px] inline-block size-2 rounded-full ${meta.color.split(" ")[0]}`}
                />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="num text-muted-foreground w-24 shrink-0 text-xs">{e.date}</span>
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                      meta.color.split(" ")[1]
                    } border-border bg-bg-soft/40`}
                  >
                    {meta.label}
                  </span>
                  <p className="text-foreground text-sm font-medium">{e.title}</p>
                </div>
                {e.description ? (
                  <p className="text-muted-foreground ml-26 mt-1 text-xs leading-relaxed">
                    {e.description}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
