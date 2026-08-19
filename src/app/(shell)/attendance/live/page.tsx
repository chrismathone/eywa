import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { getCarryOverAbsences, getDeskQueue, getLiveBoard } from "@/features/attendance/live/server/queries";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import type { LiveBoard } from "@/features/attendance/live/types";
import { SeatingChart } from "@/features/attendance/live/components/seating-chart";
import { DeskView } from "./_components/desk-view";
import { LiveDatePicker } from "./_components/live-date-picker";
import { LiveRefresher } from "./_components/live-refresher";
import { ShuttleMissedBanner } from "@/features/shuttle/components/shuttle-missed-banner";

export const metadata = { title: "오늘 출결 — eywa" };

/**
 * 오늘 출결 — 좌석표(기본) + 데스크 확인 큐. 강사별 현황 보드는 폐기(좌석표가 시야가 낫다).
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
  // 🔴 데스크 큐는 **full만**(사무실). readonly(뷰어·회계)는 조치를 남길 수 없는데(canWriteTenant 거절)
  //    큐를 열면 전 학생 학부모 연락처만 새로 보이게 된다 — 볼 수 있는 것과 할 수 있는 것을 맞춘다.
  //    ⚠️ 유일한 출결 알림 수신자가 뷰어라 벨은 받는데 큐는 못 여는 상태가 될 수 있다(운영 조건 참조).
  const isDesk = level === "full";
  const today = kstToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") && sp.date! <= today ? sp.date! : today;
  const tab = isDesk && sp.tab === "desk" ? "desk" : "seating";

  const holiday = await holidayNameOf(date);
  const [board, queue, carryOver] = await Promise.all([
    holiday ? null : getLiveBoard(date),
    holiday || !isDesk ? null : getDeskQueue(date),
    holiday || !isDesk || tab !== "desk" ? null : getCarryOverAbsences(date),
  ]);

  const pending = queue ? queue.counts.students + queue.counts.classes : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="출결"
        title="오늘 출결"
        description={
          <LiveDatePicker
            date={date}
            today={today}
            tab={tab}
            hint={board?.scopedToSelf ? "내 수업" : "전체"}
          />
        }
        embedLabel={<LiveDatePicker date={date} today={today} tab={tab} />}
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
          {/* 셔틀 신호(0225a) — 그날 셔틀 미탑승 학생을 출결 위에 띠로 보여준다.
              🔴 신호일 뿐 결석을 만들지 않는다(원장 2026-08-19 "신호만"). 신호가 없으면 안 그려진다.
              🔴 **데스크(full)에게만** — 이 띠는 학원 전체 학생 대상이라 scoped 강사에게 띄우면
                 담당이 아닌 반 학생 이름까지 새로 보인다(바로 아래 '확인 필요' 큐를 full 전용으로
                 둔 것과 같은 이유: 볼 수 있는 것과 할 수 있는 것을 맞춘다). 강사에게 필요해지면
                 담당 반으로 좁힌 뒤에 열 것.
              ⚠️ Suspense로 감싸 **첫 페인트를 막지 않는다**(B7) — 부가 정보가 좌석표를 기다리게 하면 안 된다. */}
          {isDesk && (
            <Suspense fallback={null}>
              <ShuttleMissedBanner date={date} />
            </Suspense>
          )}

          {isDesk && (
            <nav className="border-line flex gap-1 border-b" aria-label="보기 전환">
              <TabLink active={tab === "seating"} href={`/attendance/live?date=${date}`} label="좌석표" />
              <TabLink active={tab === "desk"} href={`/attendance/live?tab=desk&date=${date}`} label="확인 필요" count={pending ? String(pending) : undefined} alert={pending > 0} />
            </nav>
          )}

          {tab === "desk" && queue ? (
            <DeskView queue={queue} date={date} canEdit={board?.canEdit ?? false} carryOver={carryOver} />
          ) : board ? (
            <SeatingChart board={stripContacts(board)} />
          ) : null}

          {/* 화면이 열려 있는 동안만, 20초마다 서버 카운트를 확인해 바뀌었을 때만 다시 그린다(폴링 규약).
              ⚠️ Realtime(postgres_changes)은 이 프로젝트에서 RLS 인가에 막혀 **조용히 무전송**이다
              (등록상담 워처 주석의 실측). 그래서 여기도 폴링이다. */}
          {date === today && <LiveRefresher date={date} />}
        </>
      )}
    </div>
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
        active ? "border-primary text-primary" : "text-text-dim hover:text-foreground border-transparent"
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

/** 보드로 내려보낼 때 연락처를 지운다 — 화면이 안 쓰는 개인정보를 클라 페이로드에 남기지 않는다. */
function stripContacts(board: LiveBoard): LiveBoard {
  return {
    ...board,
    teachers: board.teachers.map((t) => ({
      ...t,
      teacherPhone: null,
      slots: t.slots.map((s) => ({
        ...s,
        students: s.students.map((st) => ({ ...st, parentPhone: null, studentPhone: null })),
      })),
    })),
  };
}
