import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { getAttendanceForDate, type AttendanceRow } from "@/features/attendance/server/queries";

export const metadata = { title: "출석부 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "공결",
  makeup: "보강",
};

const STATUS_COLOR: Record<string, string> = {
  present: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  absent: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  late: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  excused: "text-muted-foreground bg-muted border-border",
  makeup: "text-chart-1 bg-chart-1/10 border-chart-1/20",
};

function formatKoreanDate(iso: string) {
  const [y, m, d] = iso.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export default async function AttendanceByDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const records = await getAttendanceForDate(date);

  const groups = new Map<string, { className: string; subject: string; rows: AttendanceRow[] }>();
  for (const r of records) {
    if (!groups.has(r.classId)) {
      groups.set(r.classId, { className: r.className, subject: r.subject, rows: [] });
    }
    groups.get(r.classId)!.rows.push(r);
  }

  const total = records.length;
  const present = records.filter((r) => r.status === "present").length;
  const absent = records.filter((r) => r.status === "absent").length;
  const late = records.filter((r) => r.status === "late").length;
  const rate = total > 0 ? (present / total) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="출석부"
        description={`${formatKoreanDate(date)} · 반별 출결 입력`}
      />

      {records.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="이 날짜의 출석 기록이 없습니다"
          description="다른 날짜를 선택하거나 시드를 확인하세요."
        />
      ) : (
        <>
          <div className="bg-card border-border grid grid-cols-2 gap-4 rounded-lg border p-5 sm:grid-cols-4">
            <Summary label="전체" value={total} unit="건" />
            <Summary label="출석" value={present} unit="건" highlight="text-chart-2" suffix={`${rate.toFixed(1)}%`} />
            <Summary label="결석" value={absent} unit="건" highlight="text-chart-4" />
            <Summary label="지각" value={late} unit="건" highlight="text-chart-3" />
          </div>

          <div className="space-y-4">
            {Array.from(groups.entries()).map(([classId, group]) => (
              <div key={classId} className="bg-card border-border overflow-hidden rounded-lg border">
                <header className="border-border flex items-center justify-between border-b px-5 py-3">
                  <div>
                    <h3 className="text-sm font-semibold">{group.className}</h3>
                    <p className="text-muted-foreground num text-xs">
                      {group.subject} · {group.rows.length}명
                    </p>
                  </div>
                </header>
                <ul className="divide-border divide-y">
                  {group.rows.map((row) => (
                    <li key={row.id} className="flex items-center justify-between px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{row.studentName}</span>
                        {row.studentGrade ? (
                          <span className="text-muted-foreground text-xs">{row.studentGrade}</span>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                          STATUS_COLOR[row.status] ?? "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  unit,
  highlight,
  suffix,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span>
        {suffix ? <span className="text-muted-foreground ml-2 text-xs font-normal">{suffix}</span> : null}
      </p>
    </div>
  );
}
