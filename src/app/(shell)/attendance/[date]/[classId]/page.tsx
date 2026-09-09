import { notFound } from "next/navigation";
// 🔴 날짜 라벨은 **KST 단일 소스**(date-kst) — 화면마다 `Intl.DateTimeFormat`을 만들면
//    `timeZone`을 빠뜨린 곳이 런타임 시간대(서버=UTC)로 포맷된다.
import { formatKoreanDateLong } from "@/lib/date-kst";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getAttendanceInputRows,
  getClassMeta,
} from "@/features/attendance/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { AttendanceInputForm } from "./input-form";

export const metadata = { title: "출석 입력 — eywa" };

export default async function AttendanceInputPage({
  params,
}: {
  params: Promise<{ date: string; classId: string }>;
}) {
  const user = await requireAccess("attendance");
  const { date, classId } = await params;
  // 강사(scoped)는 KST 오늘 기준 7일 지난 출결을 못 고친다(원장 2026-07-21). 관리자 이상은 제한 없음.
  // ⚠️ 진짜 게이트는 saveAttendance 서버 액션 — 여기선 폼을 미리 잠가 헛수고를 없앨 뿐이다(#77).
  const locked =
    (await accessLevelTenant(user.systemRole, "attendance")) === "scoped" &&
    !isWithinAttendanceEditWindow(date, kstToday())
      ? attendanceLockMessage(date, kstToday())
      : null;
  const [klass, rows, { operations }] = await Promise.all([
    getClassMeta(classId),
    getAttendanceInputRows(classId, date),
    getTenantSettings(),
  ]);
  if (!klass) notFound();
  const subjectMaps = buildSubjectMaps(operations.subjects);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/attendance/${date}`} label={`${formatKoreanDateLong(date)}로`} />

      <header className="border-line space-y-1 border-b pb-5">
        <p className="eyebrow">{formatKoreanDateLong(date)}</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{klass.className}</h1>
        <p className="text-text-dim text-sm">
          {subjectMaps.labelOf(klass.subject)}
          {klass.teacherName ? ` · 담임 ${klass.teacherName}` : ""} · 재원생{" "}
          {/* 보강(수업외) 행은 이 반 수강생이 아니라 '재원생' 수에 넣지 않는다 — 넣으면 명단 규모가 부풀어 보인다. */}
          <span className="num">{rows.filter((r) => !r.isMakeup).length}</span>명
        </p>
      </header>

      {locked ? (
        <p className="text-text-dim bg-bg-soft/60 border-line rounded-2xl border px-4 py-2.5 text-sm break-keep">
          {locked}
        </p>
      ) : null}
      <AttendanceInputForm classId={classId} date={date} rows={rows} locked={!!locked} />
    </div>
  );
}
