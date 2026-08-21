import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getLiveBoard } from "@/features/attendance/live/server/queries";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import { quickClasses } from "@/features/attendance/quick/board";
import { QuickBoard } from "@/features/attendance/quick/components/quick-board";

export const metadata = { title: "출결 모드 — eywa" };

/**
 * 출결 모드 — **강사 본인 반만, 터치 몇 번으로** 오늘 출결을 끝내는 화면(원장 2026-08-20).
 *
 * 🔴 **오늘 고정**이다. 지난 날짜 보정은 월별 출석부의 일이라 날짜 파라미터를 받지 않는다 — 여기서
 *    과거를 열 수 있게 하면 7일 잠금·데스크 유예 같은 '오늘'을 전제한 규칙이 화면과 어긋난다.
 * 🔴 적재는 `getLiveBoard(오늘, selfOnly)` **그대로**다(새 쿼리 금지, B2/B3). selfOnly는 권한이 아니라
 *    화면의 성격이 정한다 — 관리자 계열이 열어도 자기 반만 본다(남의 반에 '일괄 출결'이 붙으면 안 된다).
 * ⚠️ 권한 키는 기존 `attendance` — 새 메뉴 키를 만들면 `auth_menu_access` DEFAULTS 누락으로 전 역할이
 *    잠긴다([[#92]]).
 * ⚠️ 학생 연락처는 클라 페이로드에서 지운다 — 이 화면이 쓰지 않는 개인정보를 내려보내지 않는다.
 */
export default async function AttendanceQuickPage() {
  await requireAccess("attendance");
  const today = kstToday();
  // 휴원일 판정과 보드 적재는 서로 독립이라 병렬(B4).
  const [board, holiday] = await Promise.all([getLiveBoard(today, true), holidayNameOf(today)]);

  if (holiday) {
    return (
      <div className="space-y-4">
        <Header date={today} />
        <EmptyState
          icon={CalendarDays}
          title={`${holiday} — 휴원일`}
          description="이 날은 수업이 없어 출결을 입력하지 않습니다. 학원설정의 휴일 목록을 따릅니다."
        />
      </div>
    );
  }

  const classes = quickClasses(board).map((c) => ({
    ...c,
    students: c.students.map((s) => ({ ...s, parentPhone: null, studentPhone: null })),
  }));

  return (
    <div className="space-y-4">
      <Header date={today} />
      <QuickBoard date={today} classes={classes} canEdit={board.canEdit} />
    </div>
  );
}

function Header({ date }: { date: string }) {
  return (
    <PageHeader
      eyebrow="출결"
      title="출결 모드"
      description={`${formatKoreanDate(date)} · 내 수업`}
      embedLabel={`출결 모드 · ${formatKoreanDate(date)}`}
    />
  );
}
