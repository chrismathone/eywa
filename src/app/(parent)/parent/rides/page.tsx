import { redirect } from "next/navigation";

import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getParentViewer } from "@/features/shuttle/server/parent-viewer";
import { loadRideLegsFor } from "@/features/shuttle/server/parent-ride-data";
import { AbsentButton } from "@/features/shuttle/components/absent-button";
import { KstClock } from "@/features/shuttle/components/kst-clock";
import { ParentRideCard } from "@/features/shuttle/components/parent-ride-card";
import { RegularRideDialog } from "@/features/shuttle/components/regular-ride-dialog";
import { weekDates } from "@/features/shuttle/parent-rides";
import { dayLabel, type DayCode } from "@/features/shuttle/types";

const TITLE = "등하원 시간 변경·확인";
export const metadata = { title: TITLE };

const PATH = "/parent/rides";

/**
 * 학부모 탭 2 '등하원 시간 변경·확인' — 연결된 아이의 셔틀 등하원.
 *
 * 🔑 보기 전환(제목 옆): **요일별**(기본, 아래 기능 전부) / **월별**(자리만 — 사용자 2026-09-26 "일단 기능을 넣지 말아줘").
 *    `?view=month`로 가른다. 월별일 땐 셔틀 조회를 아예 하지 않는다.
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
  searchParams: Promise<{ day?: string; view?: string; edit?: string }>;
}) {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  const { day, view, edit } = await searchParams;
  const editing = edit === "1";

  if (view === "month") {
    return (
      <>
        <TitleRow view="month" />
        <section className="bg-card rounded-2xl p-6 text-center shadow-[var(--shadow-card)]">
          <p className="font-bold">월별 보기는 준비 중이에요</p>
          <p className="text-text-dim mt-1 text-sm break-keep">지금은 요일별로 확인해 주세요.</p>
        </section>
      </>
    );
  }

  const today = kstToday();
  const week = weekDates(today); // 월~금 — 주말에 열면 다음 주
  // 주말엔 '오늘' 칩이 없다 → 기본은 첫 칩(월요일).
  const todayCode = week.find((w) => w.ymd === today)?.day ?? null;
  const picked = week.find((w) => w.day === day) ?? week.find((w) => w.day === todayCode) ?? week[0]!;
  const live = picked.ymd === today;

  // 수정 모드일 때만 학원의 모든 호차 노선도 읽는다('수정하기' 모달 재료). 변경 내역은 직원 전용이라 읽지 않는다.
  const { legs, fleet, regular } = await loadRideLegsFor(
    viewer.tenantId, viewer.children.map((c) => c.id), picked.ymd, "term", live, editing,
  );
  // 다른 요일도 **그 날짜**의 일정이다 — 학부모가 미리 바꾼 변경이 반영돼 있다(2026-09-29).
  const dayText = live ? `오늘 · ${formatKoreanDate(today)}` : `${formatKoreanDate(picked.ymd)} 일정`;
  // 지난 날짜(이번 주 앞 요일)는 보기만 — 서버도 같은 판정을 한다(parent-ride-actions.ts).
  const editable = picked.ymd >= today;

  return (
    <>
      <TitleRow view="day" />

      <DayChips week={week} picked={picked.day} todayCode={todayCode} />

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
      {!live ? (
        <p className="text-text-dim -mt-3 text-xs break-keep">실제 탑승 기록은 당일에 보여요.</p>
      ) : null}

      {viewer.children.length === 0 ? (
        <p className="border-line text-text-dim rounded-2xl border border-dashed p-6 text-center text-sm">
          연결된 자녀가 없습니다. 학원에 문의해 주세요.
        </p>
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
          />
        ))
      )}

      <ActionRow
        dayHref={live ? PATH : `${PATH}?day=${picked.day}`}
        editing={editing}
        kids={viewer.children.map((c) => ({ id: c.id, name: c.name }))}
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
  kids,
  onDate,
  editable,
}: {
  dayHref: string;
  editing: boolean;
  kids: { id: string; name: string }[];
  onDate: string;
  editable: boolean;
}) {
  const editHref = editing ? dayHref : `${dayHref}${dayHref.includes("?") ? "&" : "?"}edit=1`;
  const btn = "flex h-11 flex-1 items-center justify-center rounded-lg text-sm font-bold";
  const absentBtn = `${btn} border-danger text-danger bg-card border`;
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
        <button type="button" disabled className={`${absentBtn} opacity-40`}>
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

/** 요일 칩(월~금) — 오늘은 '오늘'. 링크라 폰에서 눌러도 전체 새로 그림(상태 없음). */
function DayChips({
  week,
  picked,
  todayCode,
}: {
  week: { day: DayCode; ymd: string }[];
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
              active ? "bg-primary text-primary-foreground" : "bg-card text-foreground shadow-[var(--shadow-card)]"
            }`}
          >
            {w.day === todayCode ? "오늘" : dayLabel(w.day)}
          </a>
        );
      })}
    </nav>
  );
}
