import { SalaryRatesButton } from "@/app/(shell)/attendance/_components/salary-rates-button";
import { attendanceSalaryAdminOrNull, loadAttendanceSalaryRates } from "@/features/attendance/server/salary-rates";
import { loadClassAxisRows } from "@/features/attendance/server/teacher-axis-queries";
import { ATTENDANCE_RATE_LEVELS, MIXED_NEEDS_LEVELS, mixedWithoutLevels } from "@/features/attendance/salary-rates";
import { workDaysLabel } from "@/features/staff/employment";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { kstMonth, monthRange } from "@/lib/date-kst";

/** 같은 개인별 비율표를 연다. 직원 상세에 별도 급여 규칙이나 저장소를 만들지 않는다. */
export async function PersonalSalaryScope({ teacherId, teacherName, period }: {
  teacherId: string; teacherName: string; period: string;
}) {
  const admin = await attendanceSalaryAdminOrNull(false);
  if (!admin) return null;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : kstMonth();
  const { from, to } = monthRange(month);
  const config = await (async () => {
    try {
      const [loaded, canEdit] = await Promise.all([
        loadAttendanceSalaryRates(admin.tenantId, teacherId),
        canManageTenant(admin.systemRole, "attendance_salary_settings"),
      ]);
      if (!loaded) return null;
      const classes = canEdit ? (await loadClassAxisRows(from, to))
        .filter((c) => c.taughtBy.includes(teacherId)).map((c) => ({ id: c.id, name: c.className })) : [];
      return { rates: loaded.rates, canEdit, classes, mixed: loaded.mixed };
    } catch {
      return { unavailable: true as const };
    }
  })();
  if (!config) return null;
  if ("unavailable" in config) return <p role="status" className="border-line bg-card rounded-lg border p-4 text-sm">개인별 급여 설정을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>;
  const { rates, canEdit, classes, mixed } = config;
  return (
      <section aria-labelledby="personal-salary-heading" className="border-line bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="personal-salary-heading" className="text-base font-bold">개인별 급여 설정</h2>
            <p className="text-text-dim mt-1 text-sm">달과 관계없이 이 선생님에게만 적용합니다. 출석부와 급여명세서가 같은 설정을 사용합니다.</p>
          </div>
          {canEdit ? <SalaryRatesButton teacherId={teacherId} teacherName={teacherName} month={month} rates={rates} classes={classes} mixed={mixed} /> : null}
        </div>
        {/* 혼합 계약(근로 + 용역, 원장 2026-10-16) — 대상 학년이 용역 몫, 근로 요일이 근로 몫이다(`employment.ts`). */}
        {mixed ? (
          <p className="text-text-dim mt-2 text-sm break-keep">혼합 계약(근로 + 용역) — 급여 대상 학년이 용역(프리랜서) 몫이고, 근로 요일은 강사평가 근태를 세는 요일입니다.</p>
        ) : null}
        {mixedWithoutLevels({ rates, mixed }) ? <p role="alert" className="text-danger mt-2 text-sm break-keep">{MIXED_NEEDS_LEVELS}</p> : null}
        <dl className={`mt-3 grid grid-cols-1 gap-3 text-sm ${mixed ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          <div><dt className="text-text-dim">{mixed ? "급여 대상 학년(용역)" : "급여 대상 학년"}</dt><dd className="mt-1 font-semibold">{(rates.levels ?? ATTENDANCE_RATE_LEVELS).join(" · ")}</dd></div>
          {mixed ? <div><dt className="text-text-dim">근로 요일</dt><dd className="mt-1 font-semibold">{rates.workDays?.length ? workDaysLabel(rates.workDays) : "정하지 않음(모든 요일)"}</dd></div> : null}
          <div><dt className="text-text-dim">특강 대상</dt><dd className="mt-1 font-semibold">{rates.includeSpecial ? "학년 제한 없이 포함" : "급여 대상 학년만 포함"}</dd></div>
          <div><dt className="text-text-dim">반별 예외 비율</dt><dd className="mt-1 font-semibold">{Object.keys(rates.classes).length ? `${Object.keys(rates.classes).length}개 반` : "없음"}</dd></div>
        </dl>
      </section>
  );
}
