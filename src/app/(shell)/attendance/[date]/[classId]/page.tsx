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
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { writeLockedNote } from "@/lib/write-lock";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "@/features/attendance/edit-window";
import { getAutoUnitsForClassDay } from "@/features/attendance/server/auto-units";
import { AttendanceInputForm } from "./input-form";

export const metadata = { title: "출석 입력 — 에이와" };

export default async function AttendanceInputPage({
  params,
}: {
  params: Promise<{ date: string; classId: string }>;
}) {
  const user = await requireAccess("attendance");
  const { date, classId } = await params;
  // 🔴 읽기 권한(회계·뷰어 등) — 주소로 바로 들어와도 양식을 잠그고 저장·보강 추가를 그리지 않는다(원장 2026-11-05).
  //    판정은 saveAttendance 게이트와 **같은 함수**(canWriteTenant). 예전엔 강사 7일 잠금만 있어 다 쓰고 저장해야 거절됐다.
  const readOnly = !(await canWriteTenant(user.systemRole, "attendance"));
  // 강사(scoped)는 KST 오늘 기준 7일 지난 출결을 못 고친다(원장 2026-07-21). 관리자 이상은 제한 없음.
  // ⚠️ 진짜 게이트는 saveAttendance 서버 액션 — 여기선 폼을 미리 잠가 헛수고를 없앨 뿐이다(#77).
  const locked = readOnly
    ? writeLockedNote("attendance")
    : (await accessLevelTenant(user.systemRole, "attendance")) === "scoped" &&
        !isWithinAttendanceEditWindow(date, kstToday())
      ? attendanceLockMessage(date, kstToday())
      : null;
  // 수학 자동 시수(수업 길이, 원장 2026-09-11) — 빈 시수 칸으로 **새로** 저장하면 서버가 넣는 값이라
  // 폼이 그 칸의 기본값으로 보여 준다(보이는 기본값 = 저장될 값). 독립 조회라 병렬(B4).
  const [klass, rows, { operations }, autoUnits] = await Promise.all([
    getClassMeta(classId),
    getAttendanceInputRows(classId, date),
    getTenantSettings(),
    getAutoUnitsForClassDay(classId, date),
  ]);
  if (!klass) notFound();
  const subjectMaps = buildSubjectMaps(operations.subjects);

  return (
    <div className="w-full min-w-0 space-y-6">
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
      <AttendanceInputForm classId={classId} date={date} rows={rows} locked={!!locked} readOnly={readOnly} autoUnits={autoUnits} />
    </div>
  );
}
