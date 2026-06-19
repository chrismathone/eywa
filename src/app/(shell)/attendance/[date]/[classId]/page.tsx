import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getAttendanceInputRows,
  getClassMeta,
} from "@/features/attendance/server/queries";
import { AttendanceInputForm } from "./input-form";

export const metadata = { title: "출석 입력 — eywa" };

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

export default async function AttendanceInputPage({
  params,
}: {
  params: Promise<{ date: string; classId: string }>;
}) {
  await requireAccess("attendance");
  const { date, classId } = await params;
  const [klass, rows] = await Promise.all([
    getClassMeta(classId),
    getAttendanceInputRows(classId, date),
  ]);
  if (!klass) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/attendance/${date}`} label={`${formatKoreanDate(date)}로`} />

      <header className="border-border space-y-1 border-b pb-5">
        <p className="eyebrow">{formatKoreanDate(date)}</p>
        <h1 className="display text-foreground text-2xl">{klass.className}</h1>
        <p className="text-muted-foreground text-sm">
          {klass.subject}
          {klass.teacherName ? ` · 담임 ${klass.teacherName}` : ""} · 재원생{" "}
          <span className="num">{rows.length}</span>명
        </p>
      </header>

      <AttendanceInputForm classId={classId} date={date} rows={rows} />
    </div>
  );
}
