import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { landingPath } from "@/lib/auth/teacher-home";
import { getPayslipData } from "@/features/payroll/server/payslip-queries";
import { canViewPayslipNow } from "@/features/payroll/server/payslip-gate";
import { kstMonth } from "@/lib/date-kst";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { PayslipDocument } from "./payslip-document";
import { AdjustmentsEditor } from "./adjustments-editor";
import { AttendanceAppendix } from "./attendance-appendix";
import { getMonthlyAttendanceMatrix } from "@/features/attendance/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";

export const metadata = { title: "급여명세서 — aywa" };

/**
 * 급여명세서(프리랜서 강의용역수수료 명세서) A4 — **원장 전용**.
 *
 * 원장이 구글시트로 손수 만들던 명세서를 그대로 옮긴 것이다(문서 1Uh7mbje…, 서식·수식 대조).
 * 금액 근거는 0199a 티어 정산 — 출석부 하단 '정산액'과 **같은 조립 코드**(collectTierRows)를 쓴다.
 *
 * 🔴 게이트는 역할이 아니라 **하드 픽스 명단**(payslip-access.ts)이다 — 명세서엔 주민번호·계좌·급여가
 *    한 장에 다 실려서, 역할·메뉴 권한이 움직여도 조용히 열리면 안 된다(원장 지시 2026-08-13).
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
  if (!(await canViewPayslipNow(user))) redirect(await landingPath(user.systemRole));

  const { teacherId } = await params;
  const sp = await searchParams;
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.period ?? "") ? sp.period! : kstMonth();
  const embedded = (await headers()).get("x-embed") === "1";

  const data = await getPayslipData(teacherId, period);

  /**
   * 별지 = 그 달 출석부(원장 지시). 명세서의 반 목록이 정해진 뒤라야 무엇을 그릴지 알 수 있어 순차다.
   * ⚠️ 반마다 한 번씩 부른다 — 강사 1명분(실측 최대 10반)이라 허용되는 호출 수다(전체 반엔 쓰지 말 것).
   * 🔴 **화면(강사 전체 보기)과 숫자가 다르다** — 화면은 2026-08-18부터 그 강사가 맡은 **교시만** 세는데
   *    (`getMonthlyAttendanceMatrix`의 네 번째 인자), 여기선 넘기지 않아 **반 전체**를 센다. 별지는 돈
   *    문서라 축이 담임 그대로여야 하기 때문이다(정산·급여는 담임 축, 화면만 교시 축으로 좁혔다).
   *    실측 차이: 이현이 2026-05~08 화면 163 vs 별지 709. 지금은 영어 `salary_tier`가 0건이라 티어
   *    정산이 아예 안 돌아 금액에 영향이 없지만, **영어를 시수 급여로 켜는 순간 두 축을 맞춰야 한다**
   *    (골든마스터 게이트로 별건 처리 — 그때 이 주석부터 읽을 것).
   * ⚠️ 날짜축은 달력월로 고정 — 반마다 세션 기간이 달라 첫 반 축으로 나머지를 그리면 칸이 어긋난다.
   */
  const [appendix, settings] = await Promise.all([
    Promise.all(
      data.teacher.classes.map(async (c) => ({
        classId: c.id,
        className: c.className,
        matrix: await getMonthlyAttendanceMatrix(period, c.id, "month"),
      })),
    ),
    getTenantSettings(),
  ]);
  // 공휴일 = 학원설정 단일 소스(출석부 화면과 같은 값이라야 음영이 어긋나지 않는다).
  const holidays = buildHolidayMap(settings.operations.holidays);

  return (
    <>
      <div className="print-portrait payslip-doc mx-auto max-w-[210mm] bg-white px-12 py-10 text-black print:p-0">
        <PrintActions embedded={embedded} />
        <AdjustmentsEditor
          teacherId={teacherId}
          period={period}
          adjustments={data.adjustments}
          canIssue={data.settlement !== null && data.amounts.netPay >= 0}
        />
        <PayslipDocument data={data} />
      </div>
      {/* 🔴 별지는 세로 문서 **밖**에 둔다 — 안에 두면 `max-w-[210mm]`에 갇혀 가로 용지(297mm)의
          3분의 1을 버린다(31일 격자가 그만큼 좁아진다). 자체 컨테이너로 가로 전폭을 쓴다. */}
      <AttendanceAppendix
        groups={appendix}
        period={period}
        teacherName={data.teacher.name}
        holidays={holidays}
      />
    </>
  );
}
