import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { addDays, formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getDeskQueue, getLiveBoard } from "@/features/attendance/live/server/queries";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import { BoardView } from "./_components/board-view";
import { DeskView } from "./_components/desk-view";
import { LiveRefresher } from "./_components/live-refresher";

export const metadata = { title: "오늘 출결 — eywa" };

/**
 * 오늘 출결 — 당일 강사별 출석부 + 데스크 확인 큐 (원장 지시 2026-08-14).
 *
 * 한 화면에 두 면을 둔 이유는 **흐름이 끊기면 안 되기 때문**이다: 강사가 안 찍은 것 → 데스크가 확인 →
 * 결과가 다시 출결로. 화면을 나누면 데스크는 자기 큐만 보고, 강사가 늦게 찍은 걸 아무도 모른다.
 *
 * 권한은 기존 `attendance` 키를 그대로 쓴다(새 메뉴 신설 금지 — DEFAULTS 누락 락아웃 #92 회피).
 * 강사(scoped)는 자기 수업만 보이고 '확인' 면은 안 뜬다 — 남의 반 학부모 연락처가 보일 이유가 없다.
 */
export default async function AttendanceLivePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; date?: string }>;
}) {
  await requireAccess("attendance");
  const sp = await searchParams;
  const user = await getCurrentUser();
  const level = await accessLevelTenant(user?.systemRole ?? "viewer", "attendance");
  const isDesk = level === "full" || level === "readonly"; // 사무실·회계·뷰어 = 전체 시야
  const today = kstToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") && sp.date! <= today ? sp.date! : today;
  const tab = sp.tab === "desk" && isDesk ? "desk" : "board";

  const holiday = await holidayNameOf(date);
  const [board, queue] = await Promise.all([
    holiday ? null : getLiveBoard(date),
    holiday || !isDesk ? null : getDeskQueue(date),
  ]);

  const pending = queue ? queue.counts.students + queue.counts.classes : 0;
  const recorded = board?.totals.recorded ?? 0;
  const expected = board?.totals.expected ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="출결"
        title="오늘 출결"
        description={`${formatKoreanDate(date)} · ${board?.scopedToSelf ? "내 수업" : "전체"}`}
        embedLabel={formatKoreanDate(date)}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <DayLink date={addDays(date, -1)} tab={tab} label="이전날" />
            {date !== today && <DayLink date={today} tab={tab} label="오늘" />}
            {date < today && <DayLink date={addDays(date, 1)} tab={tab} label="다음날" />}
          </div>
        }
      />

      {holiday ? (
        // 🔴 휴원일엔 아무 것도 계산하지 않는다 — 시간표는 요일 반복이라 슬롯이 살아 있고, 그날 출결은
        //    당연히 비어 있다. 가드가 없으면 명절에 전교생이 '미확인'으로 뜬다.
        <EmptyState
          icon={CalendarDays}
          title={`${holiday} — 휴원일`}
          description="이 날은 수업이 없어 출결을 확인하지 않습니다. 학원설정의 휴일 목록을 따릅니다."
        />
      ) : (
        <>
          {isDesk && (
            <nav className="border-line flex gap-1 border-b" aria-label="보기 전환">
              <TabLink active={tab === "board"} href={`/attendance/live?date=${date}`} label="출결 현황" count={`${recorded}/${expected}`} />
              <TabLink active={tab === "desk"} href={`/attendance/live?tab=desk&date=${date}`} label="확인 필요" count={pending ? String(pending) : undefined} alert={pending > 0} />
            </nav>
          )}

          {tab === "desk" && queue ? (
            <DeskView queue={queue} date={date} />
          ) : (
            <BoardView board={board!} />
          )}

          {/* 화면이 열려 있는 동안만, 20초마다 서버 카운트를 확인해 바뀌었을 때만 다시 그린다(폴링 규약).
              ⚠️ Realtime(postgres_changes)은 이 프로젝트에서 RLS 인가에 막혀 **조용히 무전송**이다
              (등록상담 워처 주석의 실측). 그래서 여기도 폴링이다. */}
          {date === today && <LiveRefresher date={date} />}
        </>
      )}
    </div>
  );
}

function DayLink({ date, tab, label }: { date: string; tab: string; label: string }) {
  const href = tab === "desk" ? `/attendance/live?tab=desk&date=${date}` : `/attendance/live?date=${date}`;
  return (
    <Link
      href={href}
      className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap"
    >
      {label}
    </Link>
  );
}

function TabLink({
  active,
  href,
  label,
  count,
  alert,
}: {
  active: boolean;
  href: string;
  label: string;
  count?: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold whitespace-nowrap ${
        active ? "border-primary text-primary" : "text-text-dim hover:text-text border-transparent"
      }`}
    >
      {label}
      {count && (
        <span
          className={`num ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${
            alert ? "bg-danger text-white" : "bg-bg-soft text-text-dim"
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
