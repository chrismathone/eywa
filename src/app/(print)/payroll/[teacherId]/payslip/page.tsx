import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPayslipData } from "@/features/payroll/server/payslip-queries";
import { canManagePayslipNow, canViewPayslipNow } from "@/features/payroll/server/payslip-gate";
import { kstMonth } from "@/lib/date-kst";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { PayslipDocument } from "./payslip-document";
import { AdjustmentsEditor } from "./adjustments-editor";
import { AttendanceAppendix } from "./attendance-appendix";
import { salaryRowOutOfScope, salaryScopeLabel } from "@/features/attendance/salary-rates";
import { getMonthlyAttendanceMatrix } from "@/features/attendance/server/queries";
import { loadTeacherSheet } from "@/features/attendance/server/teacher-sheet";
import { TeacherSheetError } from "@/features/attendance/teacher-sheet-error";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";

export const metadata = { title: "급여명세서 — 에이와" };

/**
 * 급여명세서(프리랜서 강의용역수수료 명세서) A4 — **원장 전용**.
 *
 * 원장이 구글시트로 손수 만들던 명세서를 그대로 옮긴 것이다(문서 1Uh7mbje…, 서식·수식 대조).
 * 금액 근거 — 프리랜서는 **그 강사 출석부의 실급여 합계**(원장 2026-10-06 "출석부 그대로"), 그 밖은 0199a 티어 정산
 * (출석부 하단 '정산액'과 같은 조립 코드 collectTierRows). 갈림은 `getPayslipData`가 정한다(`tuitionBasis`).
 *
 * 🔴 게이트는 **원장 역할 + 학원 설정에서 지정한 사람**(payslip-access.ts)이다 — 명세서엔 주민번호·계좌·급여가
 *    한 장에 다 실려서, 원장이 아닌 사람은 역할·메뉴 권한이 움직여도 조용히 열리면 안 된다(원장 지시 2026-08-13 · 원장 역할 통과는 2026-10-06).
 *    getPayslipData가 서버에서 한 번 더 막지만, 화면 단계에서 먼저 되돌려 에러 페이지 대신 홈으로 보낸다.
 */
export default async function PayslipPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // ⚠️ 착지는 `landingPath` 단일 소스로 — roleHome은 과목 축이 없어 영어 전담 강사를 빈 원스크린에 떨어뜨린다
  //    (teacher-home-wiring.test.ts가 착지 지점 목록을 잠근다 — 새 지점은 거기에도 추가).
  if (!(await canViewPayslipNow(user))) notFound();

  const { teacherId } = await params;
  const sp = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "") ? sp.period! : kstMonth();
  const embedded = (await headers()).get("x-embed") === "1";

  const data = await getPayslipData(teacherId, period);

  /**
   * 별지 = 그 달 출석부(원장 지시). 명세서의 반 목록이 정해진 뒤라야 무엇을 그릴지 알 수 있어 순차다.
   * ⚠️ 반마다 한 번씩 부른다 — 강사 1명분(실측 최대 10반)이라 허용되는 호출 수다(전체 반엔 쓰지 말 것).
   * 🔴 아래 설명은 **티어 정산 갈래**(프리랜서가 아닌 강사)의 별지다 — 프리랜서는 2026-10-06부터 출석부 조립을 그대로 붙인다(아래 코드).
   * 🔴 **화면(강사 전체 보기)과 숫자가 다르다** — 화면은 2026-08-18부터 그 강사가 맡은 **교시만** 세는데
   *    (`getMonthlyAttendanceMatrix`의 네 번째 인자), 여기선 넘기지 않아 **반 전체**를 센다. 별지는 돈
   *    문서라 축이 담임 그대로여야 하기 때문이다(정산·급여는 담임 축, 화면만 교시 축으로 좁혔다).
   *    실측 차이: 이현이 2026-05~08 화면 163 vs 별지 709. 지금은 영어 `salary_tier`가 0건이라 티어
   *    정산이 아예 안 돌아 금액에 영향이 없지만, **영어를 시수 급여로 켜는 순간 두 축을 맞춰야 한다**
   *    (골든마스터 게이트로 별건 처리 — 그때 이 주석부터 읽을 것).
   * ⚠️ 날짜축은 달력월로 고정 — 반마다 세션 기간이 달라 첫 반 축으로 나머지를 그리면 칸이 어긋난다.
   */
  /**
   * 🔴 **프리랜서(출석부 기준, 원장 2026-10-06)** 의 별지는 **그 강사 출석부 그대로**다 — 수업료가 그 출석부의 실급여 합계이므로
   *    종이의 칸·시수도 같은 표(그 강사 교시만 · 그 달에 가르친 반 · 보강 묶음)여야 한다. 조립은 명세서 데이터와 한 벌이라
   *    (`loadTeacherSheet` — 요청당 1회) 여기서 다시 조회하지 않는다. 그 밖(티어 정산)은 종전대로 담임 반 전체다.
   * 🔴 출석부를 쓸 수 없는 상태(`TeacherSheetError`)면 별지를 비우고 **그 사실을 화면에 적는다**(`appendixMissing`).
   *    아직 발행 전이면 본문이 '산정 불가'와 사유를 이미 보이지만, **발행본**은 본문이 동결 금액 그대로라(스냅샷 — 출석부를
   *    다시 조립하지 않는다) 안내가 없으면 별지만 빠진 종이가 말없이 인쇄된다(재리뷰 2026-10-06). 그 밖의 오류는 그대로 던진다.
   */
  const [appendixResult, settings, canManage] = await Promise.all([
    data.tuitionBasis === "sheet"
      ? loadTeacherSheet(user.tenantId, teacherId, period).then(
          (sheet) => ({ groups: sheet.groups.map((g) => ({ classId: g.classId, className: g.className, isSpecial: g.isSpecial, matrix: g.matrix })), missing: false }),
          (e: unknown) => {
            if (e instanceof TeacherSheetError) return { groups: [], missing: true };
            throw e;
          },
        )
      : Promise.all(
          data.teacher.classes.map(async (c) => ({
            classId: c.id,
            className: c.className,
            matrix: await getMonthlyAttendanceMatrix(period, c.id, "month"),
          })),
        ).then((groups) => ({ groups, missing: false })),
    getTenantSettings(),
    canManagePayslipNow(),
  ]);
  // 대상 학년을 좁힌 선생님 — 별지도 수업료와 같은 학년 학생만 싣는다(학년을 모르는 학생은 남긴다 — 본문이 '빠진 줄'로 알린다).
  const sheetLevels = data.sheetLevels?.length ? data.sheetLevels : null;
  const salaryScope = { levels: sheetLevels ?? undefined, includeSpecial: data.sheetIncludeSpecial };
  const appendix = sheetLevels
    ? appendixResult.groups.map((g) => ({
        ...g,
        matrix: { ...g.matrix, students: g.matrix.students.filter((s) => !salaryRowOutOfScope(salaryScope, s.grade, g)) },
      }))
    : appendixResult.groups;
  // 본문이 금액을 보이는데(발행본) 별지만 못 붙인 경우에만 따로 알린다 — 산정 불가면 본문의 사유가 같은 말을 한다.
  const appendixMissing = appendixResult.missing && data.settlement !== null;
  // 공휴일 = 학원설정 단일 소스(출석부 화면과 같은 값이라야 음영이 어긋나지 않는다).
  const holidays = buildHolidayMap(settings.operations.holidays);

  return (
    <>
      <div className="print-portrait mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
        <PrintActions embedded={embedded} />
        {canManage ? <AdjustmentsEditor
          teacherId={teacherId}
          period={period}
          adjustments={data.adjustments}
          canIssue={data.settlement !== null && data.amounts.netPay >= 0}
        /> : null}
        <PayslipDocument data={data} />
        {appendixMissing ? (
          <p className="border-line bg-bg-soft mt-6 rounded-lg border px-4 py-3 text-sm break-keep print:hidden">
            지금은 출석부 별지를 불러오지 못해 별지 없이 표시합니다. 명세서 금액은 그대로입니다. 강사뷰 상태라면 관리자뷰로
            돌아간 뒤, 아니면 잠시 후 다시 열어 주세요.
          </p>
        ) : null}
      </div>
      {/* 🔴 별지는 세로 문서 **밖**에 둔다 — 안에 두면 `max-w-[210mm]`에 갇혀 가로 용지(297mm)의
          3분의 1을 버린다(31일 격자가 그만큼 좁아진다). 자체 컨테이너로 가로 전폭을 쓴다. */}
      <AttendanceAppendix
        groups={appendix}
        period={period}
        teacherName={data.teacher.name}
        holidays={holidays}
        scopeNote={salaryScopeLabel(salaryScope)}
      />
    </>
  );
}
