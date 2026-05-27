import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, ClipboardCheck, MapPin, User } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassAttendanceStats,
  getClassDetail,
  getClassStudents,
  type DayOfWeek,
} from "@/features/classes/server/queries";

export const metadata = { title: "수업 상세 — eywa" };

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  social: "사회",
};

const SUBJECT_COLOR: Record<string, string> = {
  math: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  english: "text-chart-1 bg-chart-1/10 border-chart-1/20",
  korean: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  science: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  social: "text-muted-foreground bg-muted border-border",
};

const DAY_LABEL: Record<DayOfWeek, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("classes");
  const { id } = await params;
  const [klass, students, stats] = await Promise.all([
    getClassDetail(id),
    getClassStudents(id),
    getClassAttendanceStats(id, 30),
  ]);
  if (!klass) notFound();

  const subjectLabel = SUBJECT_LABEL[klass.subject] ?? klass.subject;
  const subjectColor = SUBJECT_COLOR[klass.subject] ?? "text-muted-foreground bg-muted border-border";

  const scheduleByDay = new Map<DayOfWeek, typeof klass.scheduleSlots>();
  for (const s of klass.scheduleSlots) {
    if (!scheduleByDay.has(s.dayOfWeek)) scheduleByDay.set(s.dayOfWeek, []);
    scheduleByDay.get(s.dayOfWeek)!.push(s);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/classes"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        수업목록으로
      </Link>

      <header className="border-border flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">수업 · 반</p>
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="display text-foreground text-3xl">{klass.className}</h1>
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${subjectColor}`}
            >
              {subjectLabel}
            </span>
            {!klass.isActive ? (
              <span className="text-muted-foreground bg-muted border-border inline-flex items-center rounded-md border px-2 py-0.5 text-xs">
                종료
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {klass.teacherName ?? "담임 미정"}
            </span>
            {klass.classroomName ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {klass.classroomName}
              </span>
            ) : null}
            <span>· 재원생 <span className="num">{klass.studentCount}</span>명</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button render={<Link href={`/attendance/${todayIso()}/${klass.id}`} />}>
            <ClipboardCheck className="size-4" />
            오늘 출석 입력
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="시간표" icon={<CalendarClock className="size-3.5" />}>
            {klass.scheduleSlots.length === 0 ? (
              <p className="text-muted-foreground py-2 text-sm">등록된 시간표가 없습니다</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {DAY_ORDER.flatMap((day) => {
                  const slots = scheduleByDay.get(day);
                  if (!slots || slots.length === 0) return [];
                  return slots.map((s, i) => (
                    <li
                      key={`${day}-${i}`}
                      className="border-border bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <span className="text-foreground font-medium">{DAY_LABEL[day]}요일</span>
                      <span className="text-muted-foreground num text-xs">
                        {s.startTime} – {s.endTime}
                      </span>
                    </li>
                  ));
                })}
              </ul>
            )}
          </Card>

          <Card title="최근 30일 출결">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="출석률" value={`${stats.rate.toFixed(1)}%`} highlight="text-chart-2" />
              <Stat label="총 건수" value={String(stats.total)} unit="건" />
              <Stat label="결석" value={String(stats.absent)} unit="건" highlight="text-chart-4" />
              <Stat label="지각" value={String(stats.late)} unit="건" highlight="text-chart-3" />
            </dl>
          </Card>

          {klass.notes ? (
            <Card title="메모">
              <p className="text-foreground text-sm whitespace-pre-wrap leading-relaxed">
                {klass.notes}
              </p>
            </Card>
          ) : null}
        </div>

        <div className="lg:col-span-2">
          <section className="bg-card border-border rounded-lg border">
            <header className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 className="text-sm font-semibold tracking-tight">수강 중인 학생</h2>
              <p className="text-muted-foreground num text-xs">{students.length}명</p>
            </header>
            {students.length === 0 ? (
              <div className="text-muted-foreground px-5 py-8 text-center text-sm">
                활성 재원생이 없습니다
              </div>
            ) : (
              <ul className="divide-border divide-y">
                {students.map((s) => (
                  <li key={s.enrollmentId} className="flex items-center justify-between px-5 py-3">
                    <Link
                      href={`/students/${s.studentId}`}
                      className="hover:underline"
                    >
                      <p className="text-foreground text-sm font-medium">{s.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {s.grade ?? "—"}
                        {s.school ? ` · ${s.school}` : ""}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground num text-xs">
                        {s.enrolledAt} ~ 현재
                      </span>
                      {s.onHold ? (
                        <span className="text-chart-3 bg-chart-3/10 border-chart-3/20 rounded-md border px-2 py-0.5 text-xs font-medium">
                          휴원
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border-border rounded-lg border p-5">
      <h3 className="eyebrow mb-3 inline-flex items-center gap-1.5">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({
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
    <div className="space-y-1">
      <p className="eyebrow">{label}</p>
      <p className={`num text-foreground text-xl font-semibold ${highlight ?? ""}`}>
        {value}
        {unit ? <span className="text-muted-foreground ml-0.5 text-xs font-normal">{unit}</span> : null}
      </p>
    </div>
  );
}
