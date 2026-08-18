import { PageHeader } from "@/components/page-header";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { getMonthEvents } from "@/features/calendar/server/queries";
import { CalendarClient } from "./_components/calendar-client";

export const metadata = { title: "캘린더 — eywa" };

/**
 * 캘린더(학원 공용 일정) — 원장 2026-08-18: *"일단 캘린더 탭으로 우리 프로그램 내에 일정부터 관리."*
 * eywa DB가 일정의 단일 진실(0218a — 구글 상시 동기화 없음). 월 뷰 + 일정 등록·수정·삭제.
 *
 * 접근 = `calendar` 메뉴(사무실 full / 강사·상담·회계·뷰어 readonly) — 열람은 전 직원, 쓰기는
 * 사무실. 쓰기 판정은 화면·액션이 같은 함수(canWriteTenant)를 쓴다([[#77]]).
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM"에 delta개월 — UTC 산술이라 서버 TZ 무관. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const user = await requireAccess("calendar");
  const sp = await searchParams;
  const today = kstToday();
  const thisMonth = today.slice(0, 7);
  const month = sp.m && MONTH_RE.test(sp.m) ? sp.m : thisMonth;

  // 두 판정은 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [{ ready, events }, canWrite] = await Promise.all([
    getMonthEvents(month),
    canWriteTenant(user.systemRole, "calendar"),
  ]);

  const [y, mo] = month.split("-");
  const monthLabel = `${y}년 ${Number(mo)}월`;

  return (
    // 풀폭·풀높이 — 캘린더는 여백보다 면적이 정보다(원장 2026-08-18 "캘린더가 너무 작음").
    // min-h-full: 셸 <main>(overflow-auto)의 가시 높이만큼은 항상 채워 그리드가 아래로 붙게.
    <div className="flex min-h-full w-full flex-col gap-4 p-4 md:px-6 md:py-5">
      <PageHeader
        eyebrow="홈"
        title="캘린더"
        description="학원 공용 일정 — 시험·행사·휴원일을 한 달력에서 관리합니다."
        embedLabel={`캘린더 · ${monthLabel}`}
      />

      {!ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          캘린더 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0218a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <CalendarClient
          month={month}
          monthLabel={monthLabel}
          prevMonth={shiftMonth(month, -1)}
          nextMonth={shiftMonth(month, 1)}
          isCurrentMonth={month === thisMonth}
          today={today}
          events={events}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
