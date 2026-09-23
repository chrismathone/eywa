import { headers } from "next/headers";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { AttendanceAppendix } from "@/app/(print)/payroll/[teacherId]/payslip/attendance-appendix";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { kstMonth } from "@/lib/date-kst";
import { classTeacherRole } from "@/features/attendance/teacher-axis";
import { getHomeroomSinceIndex } from "@/features/classes/server/teacher-as-of-queries";
import { homeroomSinceOf } from "@/features/classes/teacher-as-of";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getMonthlyAttendanceMatrix } from "@/features/attendance/server/queries";
import { parsePeriodMode } from "@/features/attendance/view-prefs";
import { getTenantSettings } from "@/features/owner/server/queries";

export const metadata = { title: "출석부 인쇄 — aywa", robots: { index: false, follow: false } };

/** 반별 인쇄 머리 문구 — 급여 별지 문구("급여 산정에 들어간 값")를 그대로 쓰면 이 종이에선 거짓이다. */
const CLASS_PRINT_CAPTION =
  "칸의 숫자 = 그날 인정된 수업 시수 · 이름 옆 표식으로 신입·퇴원·반이동·종강 표시";

/**
 * 반별 월간 출석부 **A4 인쇄**(감사 N1) — 자리 월간 인쇄(`attendance/seat/[seat]/month/print`)를 본떴다.
 *
 * 🔴 **읽기 전용**이고 서식을 새로 만들지 않는다 — 급여 별지와 같은 `AttendanceAppendix`(출석부 화면과 같은 표시 소스).
 * 🔴 게이트 = 출석부 메뉴 + `getMonthlyAttendanceMatrix`의 강사 스코프(남의 반 id를 주소에 넣으면 그 반은 비어 나온다, #77).
 * 🔑 화면과 같은 표를 찍도록 버튼이 **날짜축**을 주소에 싣는다 — 강사 렌즈·기준일은 주소가 아니라 서버가
 *    화면(`classScopeTeacher`)과 같은 규칙으로 정한다.
 */
export default async function ClassMonthlyPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ month?: string; period?: string }>;
}) {
  await requireAccess("attendance");
  const { classId } = await params;
  const sp = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") ? sp.month! : kstMonth();
  const periodMode = parsePeriodMode(sp.period);
  const me = await effectiveTeacherId();
  const embedded = (await headers()).get("x-embed") === "1";

  // 🔴 렌즈·기준일은 주소를 믿지 않고 **서버가 화면과 같은 규칙으로** 정한다(적대적 리뷰) — 주소에서 lens를 빼면
  //    강사가 남의 교시·전임 담임 기록까지 찍을 수 있었다. 규칙 = 화면 `classScopeTeacher`(이 반을 맡은 강사 본인)
  //    + 담임 폴백 반이면 담임이 된 날부터(`homeroomSinceOf`).
  const [first, settings] = await Promise.all([
    getMonthlyAttendanceMatrix(month, classId, periodMode, me, null),
    getTenantSettings(),
  ]);
  const firstCls = first.selectedClassId ? first.classes.find((c) => c.id === first.selectedClassId) : null;
  const role = me && firstCls ? classTeacherRole({
    homeroomTeacherId: firstCls.teacherId,
    slotTeacherIds: firstCls.slotTeachers.map((t) => t.id),
    teacherId: me,
  }) : null;
  const lens = me && firstCls && (role !== null || !!firstCls.historicalTeachers?.some((t) => t.id === me)) ? me : null;
  const since = lens && role === "homeroom" && firstCls
    ? homeroomSinceOf(await getHomeroomSinceIndex(), firstCls.id, lens)
    : null;
  // 첫 조회(렌즈 = me)를 그대로 쓸 수 있으면 재조회하지 않는다(순수 관리자는 me·lens 둘 다 null).
  const matrix = lens === me && !since ? first : await getMonthlyAttendanceMatrix(month, classId, periodMode, lens, since);
  const cls = matrix.selectedClassId ? matrix.classes.find((c) => c.id === matrix.selectedClassId) : null;

  return (
    <>
      <div className="print:hidden mx-auto max-w-[277mm] px-8 pt-6">
        <PrintActions embedded={embedded} />
      </div>
      {cls && matrix.students.length > 0 ? (
        <AttendanceAppendix
          groups={[{ classId: cls.id, className: cls.className, matrix }]}
          period={month}
          teacherName={cls.className}
          holidays={buildHolidayMap(settings.operations.holidays)}
          caption={lens ? `${CLASS_PRINT_CAPTION} · 이 선생님이 맡은 교시만` : CLASS_PRINT_CAPTION}
        />
      ) : (
        <p className="mx-auto max-w-[277mm] px-8 py-10 text-sm">
          {cls ? "이 달에 출석부에 오른 학생이 없습니다." : "이 반의 출석부를 볼 수 없습니다."}
        </p>
      )}
    </>
  );
}
