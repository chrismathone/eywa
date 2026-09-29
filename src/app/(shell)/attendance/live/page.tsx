import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/aywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { getCarryOverAbsences, getDeskQueue, getLiveBoard } from "@/features/attendance/live/server/queries";
import { loadLiveViewPrefs } from "@/features/attendance/live/server/prefs-actions";
import { getRangeRecap, getSavedRecapBrief } from "@/features/attendance/recap/server/queries";
import { recapDatesFor, recapRangeDates } from "@/features/attendance/recap/range";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import type { LiveBoard } from "@/features/attendance/live/types";
import { SeatingChart } from "@/features/attendance/live/components/seating-chart";
import { DeskView } from "./_components/desk-view";
import { RecapView } from "./_components/recap-view";
import { LiveDatePicker } from "./_components/live-date-picker";
import { LiveRefresher } from "./_components/live-refresher";
import { AbsenceIntakeButton } from "../_components/absence-intake-button";

export const metadata = { title: "오늘 출결 — 에이와" };

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
  searchParams: Promise<{ tab?: string; date?: string; from?: string }>;
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
  const tab = isDesk && (sp.tab === "desk" || sp.tab === "recap") ? sp.tab : "seating";
  // '어제 출결' 탭이 데려갈 기간 — 평소엔 어제 하루, **월요일은 금·토·일**(원장 2026-08-19).
  // 범위는 URL `from`~`date`로 실린다. 날짜 선택기로 직접 고르면 `from`이 없어 그날 하루가 된다.
  const span = recapDatesFor(today);
  const recapHref = `/attendance/live?tab=recap&from=${span[0]}&date=${span[span.length - 1]}`;
  // 요약이 실제로 덮을 날짜들 — `from`이 없거나 이상하면 하루로 접힌다(range.ts가 상한도 건다).
  const recapFrom = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") && sp.from! <= date ? sp.from! : date;
  const recapDates = tab === "recap" ? recapRangeDates(recapFrom, date) : [];

  const holiday = await holidayNameOf(date);
  const [board, queue, carryOver, recap, recapAi, prefs] = await Promise.all([
    holiday ? null : getLiveBoard(date),
    holiday || !isDesk ? null : getDeskQueue(date),
    holiday || !isDesk || tab !== "desk" ? null : getCarryOverAbsences(date),
    // 요약은 좌석표와 **같은 적재**(getLiveBoard, React cache)를 공유한다 — 왕복이 늘지 않는다.
    // 🔴 휴원일이어도 **요약은 막지 않는다** — 범위(금·토·일)에 수업이 있던 날이 섞여 있고, 그날 블록이
    //    스스로 "휴원일"이라고 말한다. 좌석표·큐만 휴원일에 계산을 멈춘다.
    tab !== "recap" ? null : getRangeRecap(recapDates),
    // 저장된 AI 정리(있으면). ⚠️ 표(0226a) 적용 전이면 null로 떨어지고 카드만 접힌다(#95).
    tab !== "recap" ? null : getSavedRecapBrief(recapDates[0] ?? date, date),
    // 과목 필터(계정 귀속, 2026-08-20) — 세 탭이 같은 값을 초기값으로 받는다. 저장된 과목이 지금 학원설정에
    // 없으면 화면이 '전체'로 되돌린다(`resolveSubjectFilter`) — 여기서는 모양만 읽는다.
    loadLiveViewPrefs(),
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
        // 결석 통보 접수(2026-08-19) — 데스크 화면의 상단 고정 자리. 게이트는 큐와 같은 사무실(full)이고
        // 서버 액션이 같은 판정을 다시 한다(#77). 휴원일 화면에서도 남는다(내일 결석 접수는 오늘 받는다).
        actions={isDesk ? <AbsenceIntakeButton today={today} /> : null}
      />

      {holiday && tab !== "recap" ? (
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
              <TabLink active={tab === "seating"} href={`/attendance/live?date=${date}`} label="좌석표" />
              <TabLink active={tab === "desk"} href={`/attendance/live?tab=desk&date=${date}`} label="확인 필요" count={pending ? String(pending) : undefined} alert={pending > 0} />
              {/* 어제 출결 = **지난 수업일을 결산하는 면**이라 오늘이 아니라 어제(월요일이면 금·토·일)로 데려간다. */}
              <TabLink active={tab === "recap"} href={recapHref} label="어제 출결" />
            </nav>
          )}

          {tab === "recap" ? (
            recap ? (
              <RecapView
                recap={recap}
                isToday={date === today}
                ai={recapAi}
                initialSubject={prefs.subject}
              />
            ) : (
              // 게이트가 탭과 같아 여기 오기 어렵지만, **빈 화면으로 끝내지는 않는다** — 아무것도
              // 안 그리면 "고장인지 없는 건지"를 구분할 수 없다.
              <EmptyState
                icon={CalendarDays}
                title="요약을 불러오지 못했습니다"
                description="잠시 후 다시 열어 주세요. 계속되면 관리자에게 문의해 주세요."
              />
            )
          ) : tab === "desk" && queue ? (
            <DeskView
              queue={queue}
              date={date}
              canEdit={board?.canEdit ?? false}
              carryOver={carryOver}
              initialSubject={prefs.subject}
            />
          ) : board ? (
            <SeatingChart board={stripContacts(board)} initialSubject={prefs.subject} />
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
          className={`num ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
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
