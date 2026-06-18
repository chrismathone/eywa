import {
  getStudentAttendanceCalendar,
  getStudentAttendanceStats,
} from "@/features/students/server/queries";

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

const STATUS_COLOR: Record<string, string> = {
  present: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  absent: "bg-chart-4/15 text-chart-4 border-chart-4/30",
  late: "bg-chart-3/15 text-chart-3 border-chart-3/30",
  early_leave: "bg-chart-5/15 text-chart-5 border-chart-5/30",
  excused: "bg-muted text-muted-foreground border-border",
  makeup: "bg-chart-1/15 text-chart-1 border-chart-1/30",
};

export async function AttendanceTab({ studentId }: { studentId: string }) {
  const [stats60, calendar] = await Promise.all([
    getStudentAttendanceStats(studentId, 60),
    getStudentAttendanceCalendar(studentId, 60),
  ]);

  // 날짜별 그룹화
  const byDate = new Map<string, typeof calendar>();
  for (const row of calendar) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  const dates = Array.from(byDate.keys()).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">출결 캘린더 (최근 60일)</h2>
        <p className="text-muted-foreground text-xs">총 {stats60.total}건</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="출석률" value={`${stats60.rate.toFixed(1)}%`} highlight="text-chart-2" />
        <Card label="출석" value={String(stats60.present)} unit="건" />
        <Card label="결석" value={String(stats60.absent)} unit="건" highlight="text-chart-4" />
        <Card label="지각" value={String(stats60.late)} unit="건" highlight="text-chart-3" />
      </div>

      {dates.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">출결 기록이 없습니다</p>
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-md border">
          {dates.map((date) => {
            const rows = byDate.get(date)!;
            return (
              <li key={date} className="flex items-center gap-3 px-4 py-2">
                <span className="num text-muted-foreground w-24 text-xs">{date}</span>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  {rows.map((r, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_COLOR[r.status] ?? ""
                      }`}
                    >
                      <span>{STATUS_LABEL[r.status] ?? r.status}</span>
                      <span className="opacity-60">·</span>
                      <span className="opacity-80">{r.className}</span>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit?: string;
  highlight?: string;
}) {
  return (
    <div className="bg-card border-border rounded-md border p-3">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground mt-1 text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        {unit ? (
          <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}
