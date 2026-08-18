import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { WeekNav } from "@/app/(shell)/timetable/_components/week-nav";
import { getClassSheetWeek, getSheetLanding } from "@/features/class-sheets/server/queries";
import { getEcsToday, type EcsTodayResult } from "@/features/class-sheets/server/today";
import { getEcsSeatDay } from "@/features/class-sheets/server/seat-day";
import { TodayBoard } from "@/features/class-sheets/components/today-board";
import { TodayAttendanceStrip } from "@/features/attendance/live/components/today-strip";
import { SheetClient } from "@/features/class-sheets/components/sheet-client";
import { EcsSeatDayFace } from "@/features/class-sheets/components/seat-day-face";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { EcsLandingList } from "./_components/landing-list";
import { EcsTeacherFilter } from "./_components/teacher-filter";
import { EcsTrackFilter } from "./_components/track-filter";
import { EcsFaceTabs, EcsDayNav, EcsTodayModeTabs, type EcsTodayMode } from "./_components/today-nav";
import { ENGLISH_TRACK_FILTER_LABEL } from "@/features/classes/english-track";

/** 오늘 면 시트 모드의 반 1개분 — 시트 조회가 실패해도 나머지 반은 그려야 하므로 결과를 통째로 나른다. */
type TodaySheet = {
  classId: string;
  className: string;
  res: Awaited<ReturnType<typeof getClassSheetWeek>>;
};

export const metadata: Metadata = { title: "영어 강사 시트 — eywa" };

/**
 * ECS 랜딩 — 면 세 개.
 *  · **오늘**(강사 기본값) = 영어 강사의 원스크린. 그 날 수업이 있는 내 반만 교시 순서로 쌓아
 *    계획·출결·보고서 상태를 한 화면에서 본다(원장 지시 2026-08-07 "ECS를 기반으로 한 원스크린").
 *  · **주간** = 기존 반 카드 + 주간 작성률(사무실 기본값 — 전 반을 훑는 자리라 날짜로 좁히면 못 쓴다).
 *  · **305 · JJ실** = 집중자율수업실 하루. 같은 시각 여러 반을 한 표로(출결·듣기·단어). 사무실도 연다.
 *
 * ⚠️ 기본 면을 **역할이 아니라 스코프**로 가른다: 강사 스코프가 있으면(내 반이 정해져 있으면) '오늘'.
 *    관리자는 스코프가 없어 '오늘'로 열면 학원 전체의 그날 수업이 쏟아진다 — 그건 시간표의 일이다.
 */
export default async function EcsLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; date?: string; mode?: string }>;
}) {
  await requireAccess("ecs");
  const { week, view, date, mode: modeParam } = await searchParams;
  // 🔴 '오늘' 면은 **강사 스코프 전용**이다. 스코프가 없는 사람(사무실)에게 이 면은 그 날 운영 중인
  // 영어 반 **전부**(실측 24반)를 편집기·저널·presence 채널과 함께 펼친다 — 쓸 일도 없는 화면에
  // IndexedDB 문서 24개와 realtime 채널 24개를 여는 셈이다(2026-08-07 적대적 리뷰).
  // 학원 전체의 하루를 보는 건 시간표의 일이다. `?view=today`를 손으로 넣어도 주간으로 떨어뜨린다.
  const scoped = (await effectiveTeacherScope()) !== null;
  // 305 면은 사무실도 연다(오늘 면의 24반 폭탄과 달리 타임 단위). view=room 은 스코프와 무관.
  if (view === "room") {
    const roomRes = await getEcsSeatDay("JJ", date ?? null);
    return <EcsSeatDayFace res={roomRes} showToday={scoped} />;
  }
  const face: "today" | "week" = scoped ? (view === "week" ? "week" : "today") : "week";

  if (face === "today") {
    // 기본 = **시트 모드**(원장 2026-08-11 "원스크린 느낌으로 한곳에서 모두 수정") — 카드는 보조 요약.
    const mode: EcsTodayMode = modeParam === "cards" ? "cards" : "sheet";
    const todayRes = await getEcsToday(date ?? null);
    let sheets: TodaySheet[] | null = null;
    if (mode === "sheet" && todayRes.ok && todayRes.cards.length > 0) {
      // 반별 주간 시트를 병렬로(B4) — 강사 스코프라 그 날 수업 반 몇 개뿐이다(사무실은 오늘 면 차단).
      // 첫 페인트는 route loading.tsx가 스켈레톤으로 받는다(B7).
      const results = await Promise.all(
        todayRes.cards.map((c) => getClassSheetWeek(c.classId, todayRes.weekMonday)),
      );
      sheets = results.map((res, i) => ({
        classId: todayRes.cards[i]!.classId,
        className: todayRes.cards[i]!.className,
        res,
      }));
    }
    return <EcsTodayFace res={todayRes} scoped={scoped} mode={mode} sheets={sheets} />;
  }
  const res = await getSheetLanding(week ?? null);

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="영어 강사 시트" description="영어 반별 주간 수업계획서/출석부" />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="수업 운영"
        title="영어 강사 시트"
        description={`영어 반별 주간 수업계획서/출석부 · ${res.weekLabel}`}
        embedLabel={`영어 강사 시트 · ${res.weekLabel}`}
      />

      <div className="bg-card shadow-card flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        {/* '오늘'은 강사 스코프만 — 사무실이 눌러도 주간으로 떨어지는 탭은 거짓 어포던스.
            305는 사무실 본업(그 시각 여러 반)이라 스코프 없어도 단다. */}
        <EcsFaceTabs face="week" showToday={scoped} />
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(monday) => `/ecs?view=week&week=${monday}`} />
        {/* 프로그램 필터(EiE / 인재원 영어) — 계정 귀속. 시트 가져오기 왼쪽에 붙여 주 네비와 한 줄. */}
        <EcsTrackFilter value={res.trackFilter} counts={res.trackCounts} />
        {/* 담임 필터 — 프로그램 **다음**에 걸린다(둘은 곱해진다). 옵션이 프로그램 적용 후 집합이라
            순서가 화면과 같고, 담임이 한 명뿐인 화면(강사 본인)에선 컴포넌트가 스스로 사라진다. */}
        <EcsTeacherFilter
          value={res.teacherFilter}
          options={res.teacherOptions}
          totalCount={res.trackCounts[res.trackFilter]}
        />
      </div>

      {res.cards.length === 0 ? (
        // 원인별로 다른 안내 — 담당 반이 없는 강사에게 "학원 설정을 확인하라"고 하면
        // 고칠 수 없는 일을 시키는 거짓 안내가 된다(원인 오표시 금지).
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {res.emptyReason === "filtered"
            ? // 되돌릴 수 있는 원인 — 무엇을 누르면 되는지까지 말한다(막다른 안내 금지).
              `지금 보기가 '${ENGLISH_TRACK_FILTER_LABEL[res.trackFilter]}'로 좁혀져 있어 표시할 반이 없습니다. 위 '프로그램'에서 전체를 누르면 ${res.trackCounts.all}개 반이 모두 보입니다.`
            : res.emptyReason === "no-scoped-classes"
              ? "담당하고 계신 영어 반이 없습니다. 반 배정은 사무실에 문의하세요."
              : res.emptyReason === "not-configured"
                ? "영어 과목의 수업계획(영어 강사 시트) 영역이 아직 설정되지 않았습니다. 학원 설정 → 과목 운영에서 영역을 지정하세요."
                : "이 주에 운영 중인 영어 반이 없습니다."}
        </p>
      ) : (
        // 카드 벽 → **한 장의 시트**(2026-08-11 원장 "이름에 걸맞게 컴팩트하게"). 상세는 landing-list.tsx.
        <EcsLandingList cards={res.cards} weekMonday={res.weekMonday} />
      )}
    </div>
  );
}

/**
 * '오늘' 면 — 영어 강사의 원스크린. 그 날 수업이 있는 내 반만 교시 순서로 쌓는다.
 *
 * 모드 2개(원장 2026-08-11 *"왔다갔다하면서 다 수정해야해서 큰 의미가 떨어져 — 한곳에서 모두 수정"*):
 *  · **시트(기본)** — 반마다 주간 시트를 **그 날짜 열만** 필터해 쌓는다. 주간 시트와 같은 기계(SheetClient:
 *    계획 줄 추가·출결·태도·특이사항·시수·일괄 입력·CAS·저널·presence)라 여기서 전부 편집이 끝난다.
 *  · **요약 카드** — 기존 보드(일괄 출석·알림장/보고서 배지·하루 합산). 훑어보기용 보조.
 *
 * ⚠️ 빈 화면 문구를 **원인별로** 가른다(랜딩과 같은 규약): 담당 반이 아예 없는 것과, 반은 있는데
 *    그 날 수업이 없는 것은 사람이 할 일이 완전히 다르다. 하나로 뭉치면 둘 중 하나는 거짓말이 된다.
 */
function EcsTodayFace({
  res,
  scoped,
  mode,
  sheets,
}: {
  res: EcsTodayResult;
  scoped: boolean;
  mode: EcsTodayMode;
  sheets: TodaySheet[] | null;
}) {
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="영어 강사 시트" description="오늘 수업" />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const isToday = res.date === res.today;
  const okSheets = (sheets ?? []).filter((s) => s.res.ok);
  const classOptions = okSheets.map((s) => ({ id: s.classId, name: s.className }));
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="수업 운영"
        title="영어 강사 시트"
        description={`${isToday ? "오늘" : "이 날"} 수업 ${res.cards.length}개 · 계획·출결·보고서를 한 화면에서`}
        embedLabel={`영어 강사 시트 · ${isToday ? "오늘" : res.date.slice(5)}`}
      />

      {/* 좁은 화면(모바일·좁은 창)은 칩 툴바를 가로 레일로 — 시간표 툴바와 같은 .toolbar-rail 규약. */}
      <div className="bg-card shadow-card toolbar-rail flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <EcsFaceTabs face="today" showToday />
        <EcsTodayModeTabs mode={mode} date={res.date} />
        <EcsDayNav date={res.date} today={res.today} mode={mode} />
      </div>

      {/* 오늘 출석 미입력 스트립(2026-08-14) — 영어가 이 기능의 최대 수요처다: 최근 28일 영어 반은
          수업이 열린 464 반×날짜 중 **425건(91.6%)이 출결 0행**이었다. 원스크린과 같은 컴포넌트라
          강사가 화면마다 다른 제스처를 외우지 않는다. ⚠️ Suspense로 첫 페인트를 막지 않는다(B7).
          ⚠️ 오늘이 아닌 날짜를 보고 있으면 스트립은 스스로 오늘 기준이라 뜨지 않는다(과거 재촉 금지). */}
      {isToday && (
        <Suspense fallback={null}>
          <TodayAttendanceStrip />
        </Suspense>
      )}

      {res.cards.length === 0 ? (
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {!res.hasAnyClass
            ? scoped
              ? "담당하고 계신 영어 반이 없습니다. 반 배정은 사무실에 문의하세요."
              : "운영 중인 영어 반이 없습니다."
            : `${isToday ? "오늘은" : "이 날은"} 수업이 없습니다. 다른 날짜를 보시거나 '주간 시트'에서 이번 주 전체를 확인하세요.`}
        </p>
      ) : mode === "sheet" ? (
        // 시트 모드 — 반마다 SheetClient를 그 날짜 열만 필터해 쌓는다. 조회 실패한 반은 그 반만 사유를
        // 보이고 나머지는 그린다(한 반 때문에 하루 전체가 죽으면 안 된다).
        <div className="space-y-6">
          {(sheets ?? []).map((s) =>
            s.res.ok ? (
              <section key={s.classId} className="space-y-2">
                {/* 🔴 수업명 줄은 **카드 안**으로 내려갔다(원장 2026-08-18: *"수업명을 빈 공간으로
                    이동시켜줘"* + *"그러면 행 절약할 수 있을듯"*). 여기 바깥 제목 줄과 카드 안 일괄
                    버튼 줄이 나란히 있어 반마다 두 줄을 먹었는데, 정작 일괄 줄 왼쪽은 늘 비어 있었다.
                    이름·'주간 시트 열기'·'수정중' 배지는 이제 SheetClient가 `header`로 넘긴다
                    (today-class-sheet.tsx) — 위계(굵게·링크는 한 단계 낮게)는 그대로 옮겼다. */}
                <SheetClient
                  // 반 상세와 같은 재마운트 키 + **날짜** — 날짜 이동은 searchParam 네비라 키에 없으면
                  // 요일 필터 state가 옛 날짜에 남는다(카드 모드 key={date}와 같은 이유).
                  key={`${s.classId}:${s.res.data.weekMonday}:${s.res.data.showSelfStudy ? "jj" : "nojj"}:${res.date}`}
                  data={s.res.data}
                  classOptions={classOptions}
                  userId={res.userId}
                  tenantId={res.tenantId}
                  initialDay={res.date}
                  variant="today"
                />
              </section>
            ) : (
              <p key={s.classId} className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-4 text-sm">
                {s.className}: {s.res.error}
              </p>
            ),
          )}
        </div>
      ) : (
        // 🔴 `key={date}` — 날짜 이동은 searchParam 네비라 React가 이 클라 컴포넌트를 **재사용**한다.
        // 출결 낙관 상태는 `useState` 초기값으로만 만들어져, 같은 반이 두 요일에 걸치면 **어제 찍은 값이
        // 오늘 칸에 그대로 보인다**(2026-08-07 적대적 리뷰). 원스크린이 같은 이유로 `key={roster.date}`를 쓴다.
        <TodayBoard
          key={res.date}
          cards={res.cards}
          date={res.date}
          weekMonday={res.weekMonday}
          skillAreas={res.skillAreas}
          canWrite={res.canWrite}
          userId={res.userId}
          tenantId={res.tenantId}
          fontSize={res.fontSize}
          isToday={isToday}
        />
      )}
    </div>
  );
}
