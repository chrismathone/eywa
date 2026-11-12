import { redirect } from "next/navigation";

import { formatKoreanDate, kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { parentPortalAvailable } from "@/features/shuttle/parent/server/parent-availability";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { loadParentRideLegsFor } from "@/features/shuttle/parent/server/parent-ride-data";
import { AbsentButton } from "@/features/shuttle/parent/components/absent-button";
import { KstClock } from "@/features/shuttle/components/kst-clock";
import { ParentRideCard } from "@/features/shuttle/parent/components/parent-ride-card";
import { RegularRideDialog } from "@/features/shuttle/parent/components/regular-ride-dialog";
import { legRode, weekDates } from "@/features/shuttle/parent/parent-rides";
import { dayLabel, type DayCode } from "@/features/shuttle/types";
import { loadAcademyHolidays, restDayName } from "@/features/shuttle/parent/server/rest-days";
import { ParentMonthView } from "./_components/month-view";

const TITLE = "등하원 시간 변경·확인";
export async function generateMetadata() {
  const viewer = await getParentViewer();
  return { title: viewer && (await parentPortalAvailable(viewer)) ? TITLE : "학부모" };
}

const PATH = "/parent/rides";

/**
 * 학부모 탭 2 '등하원 시간 변경·확인' — 연결된 아이의 셔틀 등하원.
 *
 * 🔑 보기 전환(제목 옆): **요일별**(기본, 아래 기능 전부) / **월별**(`?view=month` — 2026-10-01부터 평일 달력.
 *    `month=YYYY-MM` · `kid=` · `dates=`(고른 날짜들의 상세), `_components/month-view.tsx`).
 * 🔑 판정·문장은 관리자 뷰와 같은 `parentLegView`다 — 관리자가 확인한 문장이 곧 학부모가 보는 문장이다.
 * 🔑 요일 칩(월~금): 오늘은 실제 기록·변경·운행 상태까지, 다른 요일은 **그 날짜의 일정**(정기 배정 + 그날 변경)과
 *    노선 — 요일마다 타는 회차·정류장이 다를 수 있어서다. 주말은 운영하지 않는다.
 * 🔑 [등하원 수정] → [등원/하원 수정하기] 모달에서 학부모가 고르고 저장하면 **바로 DB에 반영**된다(2026-09-29,
 *    `parent-ride-actions.ts`). 지난 날짜는 보기만.
 * 🔴 직원 메모·다른 아이 정보·차량 기사 연락처는 싣지 않는다(카드의 `staff`를 켜지 않는다).
 * ⚠️ 시즌은 지금 '학기중' 고정이다 — 방학 편성으로 바뀌는 날을 앱이 아직 모른다(관리자 뷰는 고를 수 있다).
 */
export default async function ParentRidesPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; view?: string; edit?: string; month?: string; kid?: string; date?: string; dates?: string; fixed?: string }>;
}) {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  if (!(await parentPortalAvailable(viewer))) return null;
  const { day, view, edit, month, kid, date, dates, fixed } = await searchParams;
  const wantEdit = edit === "1";

  // 월별(사용자 2026-10-01) — 평일 달력 · 지난 날은 기록 · 앞으로는 바뀐 날만 · 날짜를 누르면 그날 상세(month-view.tsx).
  if (view === "month") {
    return (
      <>
        <TitleRow view="month" />
        <ParentMonthView viewer={viewer} today={kstToday()} month={month} kid={kid} dates={dates ?? date} fixed={fixed} />
      </>
    );
  }

  const today = kstToday();
  const week = weekDates(today); // 월~금 — 주말에 열면 다음 주
  // 주말엔 '오늘' 칩이 없다 → 기본은 첫 칩(월요일).
  const todayCode = week.find((w) => w.ymd === today)?.day ?? null;
  const picked = week.find((w) => w.day === day) ?? week.find((w) => w.day === todayCode) ?? week[0]!;
  const live = picked.ymd === today;
  // 🔴 지난 요일은 **기록 보기 전용**이다(사용자 2026-10-02) — 수정 모드 자체가 안 켜진다(주소에 edit=1을 붙여도).
  //    그래서 지난 요일 칩에선 [고정시간 변경]도 안 뜬다(9/30의 "지난 요일 칩에도 선다"를 이 화면에서 뒤집음) —
  //    고정시간은 오늘·앞으로의 요일 칩에서, 날짜별 수정은 월별에서 한다.
  const pastDay = picked.ymd < today;
  const editing = wantEdit && !pastDay;
  // 🔑 지난 요일도 **그날의 실제 기록**(몇 시에 탔는지 · 미탑승 · 도착)을 그대로 보여 준다(사용자 2026-10-02).
  //    앞으로의 요일은 아직 일어나지 않았으니 일정만.
  const withRecords = picked.ymd <= today;

  // 수정 모드일 때만 학원의 모든 호차 노선도 읽는다('수정하기' 모달 재료). 변경 내역은 직원 전용이라 읽지 않는다.
  const [{ legs, fleet, regular }, academyHolidays] = await Promise.all([
    loadParentRideLegsFor(viewer, viewer.children.map((c) => c.id), picked.ymd, "term", withRecords, editing),
    loadAcademyHolidays(viewer.tenantId),
  ]);
  // 다른 요일도 **그 날짜**의 일정이다 — 학부모가 미리 바꾼 변경이 반영돼 있다(2026-09-29).
  const dayText = live ? `오늘 · ${formatKoreanDate(today)}` : `${formatKoreanDate(picked.ymd)} ${picked.ymd < today ? "기록" : "일정"}`;
  // 지난 날짜(이번 주 앞 요일)는 보기만 — 서버도 같은 판정을 한다(parent-ride-actions.ts).
  // 🔴 쉬는 날(법정공휴일 · 학원 휴원일)엔 일정 대신 "학원이 쉬어요"만 — 하루짜리 수정·타지 않기·결석을 잠근다
  //    (사용자 2026-10-01, 서버 `parentDayGate`와 같은 판정). 🔑 매주 반복되는 **고정시간 변경은 그대로 된다**.
  // 🔒 그날 **이미 셔틀을 탄 아이**는 결석 대상에서 뺀다(사용자 2026-10-08) — 서버(absentRideCore)도 같은 판정으로 거절한다.
  const rodeKids = new Set(viewer.children.filter((c) => (legs.get(c.id) ?? []).some(legRode)).map((c) => c.id));
  const absentKids = viewer.children.filter((c) => !rodeKids.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
  const restOf = (ymd: string) => restDayName(academyHolidays, ymd);
  const closedName = restOf(picked.ymd);
  const editable = picked.ymd >= today && !closedName;

  return (
    <>
      <TitleRow view="day" />

      <DayChips week={week.map((w) => ({ ...w, rest: restOf(w.ymd) !== null }))} picked={picked.day} todayCode={todayCode} />

      {/* 날짜 · 현재 시각 · [고정시간 변경] 한 줄 — 버튼은 오른쪽 끝, 좁으면 날짜 글자가 먼저 줄어든다. */}
      <div className="flex items-center gap-1.5 text-sm font-bold">
        <span className="min-w-0 truncate">{dayText}</span>
        <KstClock className="text-primary shrink-0" />
        {/* 고정(매주) 시간 변경 — 수정 모드에서만. 🔑 **지난 요일 칩에도 선다**(사용자 2026-09-30 — 9/29의 "지난 날짜
            칩엔 없다"를 뒤집음): 매주 반복이라 이번 주 그 요일이 지났어도 다음 그 요일부터 적용된다(서버가 그 요일의
            다음 날짜로 판정). 하루짜리 수정·타지 않기·결석은 그대로 지난 날짜에서 잠긴다(`editable`). */}
        {editing && viewer.children.length > 0 ? (
          <span className="ml-auto shrink-0">
            <RegularRideDialog
              kids={viewer.children.map((c) => ({ id: c.id, name: c.name }))}
              weekday={picked.day}
              onDate={picked.ymd}
              today={today}
              regular={regular}
              fleet={fleet}
            />
          </span>
        ) : null}
      </div>
      {closedName ? null : !live ? (
        <p className="text-text-dim -mt-3 text-xs break-keep">
          {pastDay
            ? "그날의 탑승 기록이에요. 지난 날은 수정할 수 없어요. 앞으로의 날짜는 [월별]에서 수정해 주세요."
            : "실제 탑승 기록은 당일에 보여요."}
        </p>
      ) : null}

      {viewer.children.length === 0 ? (
        <p className="border-line text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm">
          연결된 자녀가 없습니다. 학원에 문의해 주세요.
        </p>
      ) : closedName ? (
        <section className="bg-att-weekend border-line rounded-2xl border p-6 text-center">
          <p className="text-danger text-lg font-bold break-keep">
            {live ? "오늘은" : "이날은"} 학원이 쉬어요
          </p>
          <p className="mt-1 text-sm font-bold">{closedName}</p>
          <p className="text-text-dim mt-2 text-xs break-keep">
            셔틀이 다니지 않아 이날 시간은 바꿀 수 없어요. 매주 반복되는 고정시간은 [등하원 수정] → [고정시간 변경]에서
            바꿀 수 있어요.
          </p>
        </section>
      ) : (
        viewer.children.map((c) => (
          <ParentRideCard
            key={c.id}
            name={c.name}
            schoolGrade={c.schoolGrade}
            legs={legs.get(c.id) ?? []}
            showRoute
            editing={editing}
            fleet={fleet}
            dayLabel={dayText}
            onDate={picked.ymd}
            today={today}
            editable={editable}
            skipButtons
            nowMinutes={kstMinutesOfDay()}
          />
        ))
      )}

      <ActionRow
        dayHref={live ? PATH : `${PATH}?day=${picked.day}`}
        editing={editing}
        pastDay={pastDay}
        kids={absentKids}
        rodeAll={viewer.children.length > 0 && absentKids.length === 0}
        onDate={picked.ymd}
        editable={editable}
      />
    </>
  );
}

/**
 * 맨 아래 줄 — [등하원 수정] [결석]. (새로고침 링크는 사용자 2026-09-28 지시로 뺐다.)
 * '등하원 수정'은 `?edit=1`을 켜고 끄는 링크다(켜면 카드의 구간마다 '등원/하원 수정하기'·'타지 않기'가 선다).
 * '결석'은 사유를 받아 그날 등원·하원 둘 다 타지 않게 한다(`AbsentButton`, 사용자 2026-09-29). 지난 날짜엔 잠긴다.
 */
function ActionRow({
  dayHref,
  editing,
  pastDay,
  kids,
  rodeAll,
  onDate,
  editable,
}: {
  dayHref: string;
  editing: boolean;
  /** 지난 요일 — 수정 버튼을 잠그고 월별로 안내한다. */
  pastDay: boolean;
  /** 결석을 걸 수 있는 아이 — 그날 이미 셔틀을 탄 아이는 빠져 있다. */
  kids: { id: string; name: string }[];
  /** 자녀가 모두 이미 탔다 — 결석 버튼을 잠그고 이유를 툴팁으로. */
  rodeAll: boolean;
  onDate: string;
  editable: boolean;
}) {
  const editHref = editing ? dayHref : `${dayHref}${dayHref.includes("?") ? "&" : "?"}edit=1`;
  const btn = "flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-bold";
  const absentBtn = `${btn} border-danger text-danger bg-card border`;
  // 지난 요일(기록 보기) — [등하원 수정]·[결석]은 없고 월별로 가는 버튼만(사용자 2026-10-02).
  if (pastDay) {
    return (
      <a href={`${PATH}?view=month`} className={`${btn} bg-primary text-primary-foreground flex-none`}>
        월별에서 다음일정 수정하기
      </a>
    );
  }
  return (
    <div className="flex gap-2">
      <a
        href={editHref}
        aria-pressed={editing}
        className={`${btn} ${editing ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-[var(--shadow-card)]"}`}
      >
        {editing ? "수정 끝내기" : "등하원 수정"}
      </a>
      {editable && kids.length > 0 ? (
        <AbsentButton kids={kids} onDate={onDate} className={absentBtn} />
      ) : (
        <button
          type="button"
          disabled
          title={rodeAll ? "이미 셔틀을 탔어요 — 탄 뒤에는 결석으로 바꿀 수 없어요" : undefined}
          className={`${absentBtn} opacity-40`}
        >
          결석
        </button>
      )}
    </div>
  );
}

/** 제목 + 보기 전환(요일별 | 월별). 링크 두 개짜리 세그먼트 — 누르면 그 보기로 전체 새로 그림. */
function TitleRow({ view }: { view: "day" | "month" }) {
  const seg = (active: boolean) =>
    `flex h-8 items-center rounded-md px-2.5 text-xs font-bold ${active ? "bg-card text-foreground shadow-[var(--shadow-card)]" : "text-text-dim"}`;
  return (
    <div className="flex items-center justify-between gap-3">
      {/* 이름이 길어 폰 폭에서 전환 버튼과 부딪히면 제목이 어절 단위로 두 줄이 된다(버튼은 줄지 않음). */}
      <h1 className="min-w-0 text-lg font-bold break-keep">{TITLE}</h1>
      <nav aria-label="보기 전환" className="bg-bg-soft flex shrink-0 gap-0.5 rounded-lg p-0.5">
        <a href={PATH} aria-current={view === "day" ? "true" : undefined} className={seg(view === "day")}>
          요일별
        </a>
        <a href={`${PATH}?view=month`} aria-current={view === "month" ? "true" : undefined} className={seg(view === "month")}>
          월별
        </a>
      </nav>
    </div>
  );
}

/** 요일 칩(월~금) — 오늘은 '오늘', 쉬는 날은 회색 바탕 + 빨간 글씨(문구는 없다 — 사용자 2026-10-01). 링크라 폰에서 눌러도 전체 새로 그림(상태 없음). */
function DayChips({
  week,
  picked,
  todayCode,
}: {
  week: { day: DayCode; ymd: string; rest: boolean }[];
  picked: DayCode;
  todayCode: DayCode | null;
}) {
  return (
    <nav aria-label="요일 선택" className="grid grid-cols-5 gap-1.5">
      {week.map((w) => {
        const active = w.day === picked;
        return (
          <a
            key={w.day}
            href={w.day === todayCode ? PATH : `${PATH}?day=${w.day}`}
            aria-current={active ? "true" : undefined}
            className={`flex h-10 items-center justify-center rounded-lg text-sm font-bold ${
              active
                ? "bg-primary text-primary-foreground"
                : w.rest
                  ? "bg-att-weekend text-danger shadow-[var(--shadow-card)]"
                  : "bg-card text-foreground shadow-[var(--shadow-card)]"
            }`}
          >
            <span>{w.day === todayCode ? "오늘" : dayLabel(w.day)}</span>
          </a>
        );
      })}
    </nav>
  );
}
