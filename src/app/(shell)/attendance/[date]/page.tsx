import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Pencil } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getAttendanceForDate,
  getDailyProcessingStatus,
  type AttendanceRow,
} from "@/features/attendance/server/queries";

export const metadata = { title: "출석부 — eywa" };

const STATUS_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  early_leave: "조퇴",
  excused: "공결",
  makeup: "보강",
};

const STATUS_COLOR: Record<string, string> = {
  present: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  absent: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  late: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  early_leave: "text-chart-5 bg-chart-5/10 border-chart-5/20",
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
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  await requireAccess("attendance");
  const { date } = await params;
  const { saved } = await searchParams;
  const [records, processing] = await Promise.all([
    getAttendanceForDate(date),
    getDailyProcessingStatus(date),
  ]);

  // 처리 현황 집계 — 미처리 반·완료율(오늘 출결 누락 추적).
  const pendingClasses = processing.filter((p) => p.unprocessed > 0);
  const totalExpected = processing.reduce((s, p) => s + p.expected, 0);
  const totalRecorded = processing.reduce((s, p) => s + Math.min(p.recorded, p.expected), 0);
  const overallRate = totalExpected > 0 ? Math.round((totalRecorded / totalExpected) * 100) : 100;

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

      {saved ? (
        <p className="border-chart-2/30 bg-chart-2/5 text-chart-2 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <CheckCircle2 className="size-4" />
          <span className="num">{saved}</span>건 저장됨
        </p>
      ) : null}

      {/* 처리 현황 — 오늘 어느 반이 출결 미입력인지 추적(예정 학생 vs 기록). ijw DailyAttendance 이식. */}
      {processing.length > 0 ? (
        <section className="bg-card border-border space-y-4 rounded-lg border p-5">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow">처리 현황</p>
              <h2 className="text-foreground mt-0.5 text-[15px] font-bold">오늘 출결 입력 추적</h2>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                완료율{" "}
                <span className={`num font-bold ${overallRate >= 100 ? "text-chart-2" : "text-foreground"}`}>
                  {overallRate}%
                </span>
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground">
                미처리 반{" "}
                <span className={`num font-bold ${pendingClasses.length > 0 ? "text-chart-4" : "text-chart-2"}`}>
                  {pendingClasses.length}
                </span>
                /{processing.length}
              </span>
            </div>
          </header>
          <ul className="divide-border divide-y">
            {processing.map((p) => (
              <li key={p.classId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.className}
                    <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                      {p.subject}
                      {p.teacherName ? ` · ${p.teacherName}` : ""}
                    </span>
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="bg-bg-soft h-1.5 w-32 overflow-hidden rounded-full">
                      <span
                        className={`block h-full ${p.unprocessed === 0 ? "bg-chart-2" : "bg-chart-3"}`}
                        style={{ width: `${p.rate}%` }}
                      />
                    </div>
                    <span className="text-text-faint num text-[11px]">
                      {p.recorded}/{p.expected}
                    </span>
                  </div>
                </div>
                {p.unprocessed > 0 ? (
                  <span className="text-chart-4 bg-chart-4/10 border-chart-4/20 shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium">
                    미처리 {p.unprocessed}
                  </span>
                ) : (
                  <span className="text-chart-2 shrink-0 text-[11px]">완료</span>
                )}
                <Link
                  href={`/attendance/${date}/${p.classId}`}
                  className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs"
                >
                  <Pencil className="size-3" />
                  입력
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {records.length === 0 && processing.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="이 날짜의 출석 기록이 없습니다"
          description="다른 날짜를 선택하거나 시드를 확인하세요."
        />
      ) : records.length === 0 ? null : (
        <>
          <div className="bg-card border-border grid grid-cols-2 gap-4 rounded-lg border p-5 sm:grid-cols-4">
            <Summary label="전체" value={total} unit="건" />
            <Summary label="출석" value={present} unit="건" highlight="text-chart-2" suffix={`${rate.toFixed(1)}%`} />
            <Summary label="결석" value={absent} unit="건" highlight="text-chart-4" />
            <Summary label="지각" value={late} unit="건" highlight="text-chart-3" />
          </div>

          {/* 반별로 접어 둔다(기본 접힘) — 117반/하루가 평면으로 쏟아지지 않게. 접힌 채로도
              결석·지각 칩으로 어느 반에 이상이 있는지 한눈에. 네이티브 <details>라 JS 0. */}
          <div className="space-y-3">
            {Array.from(groups.entries()).map(([classId, group]) => {
              const gAbsent = group.rows.filter((r) => r.status === "absent").length;
              const gLate = group.rows.filter((r) => r.status === "late").length;
              return (
                <details key={classId} className="bg-card border-border group overflow-hidden rounded-lg border">
                  <summary className="hover:bg-bg-soft/40 flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <h3 className="text-sm font-semibold">{group.className}</h3>
                      <p className="text-muted-foreground num text-xs">
                        {group.subject} · {group.rows.length}명
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {gAbsent > 0 ? (
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR.absent}`}>
                          결석 {gAbsent}
                        </span>
                      ) : null}
                      {gLate > 0 ? (
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR.late}`}>
                          지각 {gLate}
                        </span>
                      ) : null}
                      {gAbsent === 0 && gLate === 0 ? (
                        <span className="text-chart-2 text-[11px]">전원 출석</span>
                      ) : null}
                      <span className="text-text-faint font-mono text-[10px] transition group-open:rotate-90">▶</span>
                    </div>
                  </summary>
                  <div className="border-border border-t">
                    <div className="border-border flex justify-end border-b px-5 py-2">
                      <Link
                        href={`/attendance/${date}/${classId}`}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
                      >
                        <Pencil className="size-3" />
                        출석 입력
                      </Link>
                    </div>
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
                </details>
              );
            })}
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
