import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { ToolbarButton } from "@/components/toolbar";
import { addDays } from "@/lib/date-kst";
import { WeekNav } from "@/app/(shell)/timetable/_components/week-nav";
import { getClassSheetWeek, getSheetLanding } from "@/features/class-sheets/server/queries";
import { getEcsToday, type EcsTodayResult } from "@/features/class-sheets/server/today";
import { getEcsSeatDay } from "@/features/class-sheets/server/seat-day";
import { TodayBoard } from "@/features/class-sheets/components/today-board";
import { TodayAttendanceStrip } from "@/features/attendance/live/components/today-strip";
import { MyTasksStrip } from "@/features/staff-tasks/components/my-tasks-strip";
import { MyDutiesStrip } from "@/features/duties/components/my-duties-strip";
import { SheetClient } from "@/features/class-sheets/components/sheet-client";
import { EcsSeatDayFace } from "@/features/class-sheets/components/seat-day-face";
import { effectiveTeacherId, effectiveTeacherScope, viewAsTeacher } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTeacherEnglishNames } from "@/features/teacher-view/server/teacher-names";
import { teacherNameFor } from "@/features/teacher-view/teacher-name";
// 오늘 면 반 순서 = **화면에 보이는 첫 교시**(SheetClient가 쓰는 것과 같은 순수 함수).
import { firstVisibleTodaySlot } from "@/features/class-sheets/lib/today-own-slots";
// 내가 손으로 정한 반 순서(2026-09-05) — 기본 순서(첫 교시) 위에 얹는다.
import { applyTodayOrder } from "@/features/class-sheets/today-order";
import { TodayOrderList } from "@/features/class-sheets/components/today-order-list";
import { EcsLandingList } from "./_components/landing-list";
import { EcsTeacherFilter } from "./_components/teacher-filter";
import { EcsTrackFilter } from "./_components/track-filter";
import {
  EcsFaceTabs,
  EcsDayNav,
  EcsQuickAttendanceLink,
  EcsTodayModeTabs,
  type EcsTodayMode,
} from "./_components/today-nav";
import { ENGLISH_TRACK_FILTER_LABEL } from "@/features/classes/english-track";
import { sheetDateLabelEn, sheetT, sheetTf, sheetWeekLabel, type SheetLang } from "@/features/teacher-view/i18n";
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { TextbookOptionsProvider, type TextbookOptionItem } from "@/features/textbooks/textbook-options-context";
import { loadEcsTextbookOptions } from "@/features/textbooks/server/ecs-options";
import { writeLockedNote } from "@/lib/write-lock";

/** 오늘 면 시트 모드의 반 1개분 — 시트 조회가 실패해도 나머지 반은 그려야 하므로 결과를 통째로 나른다. */
type TodaySheet = {
  classId: string;
  className: string;
  res: Awaited<ReturnType<typeof getClassSheetWeek>>;
};

export const metadata: Metadata = { title: "영어 강사 시트 — 에이와" };

/**
 * 담당 영어 반이 0개일 때의 안내 — **막다른 안내 금지.**
 * 수학만 맡은 사람에겐 반 배정이 멀쩡하고 시트를 잘못 연 것뿐이라, 갈 곳을 적는다
 * (실측 2026-09-01: 수학만 10명 · 영어만 8명). ⚠️ 담당 과목을 여기서 조회하지 않으므로
 * **단정하지 않고 조건문**으로 적는다.
 */
const ecsMathHint = (lang: SheetLang) => (
  <>
    {sheetT(lang, "landing.empty.noScoped.before")}{" "}
    <Link href="/mcs" className="text-primary font-bold underline underline-offset-2">
      {sheetT(lang, "landing.empty.noScoped.link")}
    </Link>
    {sheetT(lang, "landing.empty.noScoped.after")}
  </>
);

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
  // 화면 언어(2026-09-03) — ECS 레이아웃이 이미 읽어 둔 값을 **요청 캐시에서 그대로** 받는다(왕복 0).
  const [scoped, lang, viewAs, [textbooksOn, eieOn]] = await Promise.all([
    effectiveTeacherScope().then((s) => s !== null),
    getTeacherViewLang(),
    // '다른 강사 뷰'(열람 전용)면 순서 바꾸기를 **아예 안 만든다**(원장 2026-09-05
    // *"어차피 다른 강사 뷰는 읽음 전용이니까 드래그기능을 넣어주면 안되는 부분"*).
    viewAsTeacher(),
    // [계획 대비 현황] 입구 — 교재목록 모듈을 끈 학원엔 월간계획(교재 배정) 자체가 없다(요청 캐시라 왕복 0).
    // EiE 구분 — 꺼진 학원엔 프로그램 필터(EiE / 인재원 영어)가 없다(2026-09-30 "꺼지면 흔적 없이").
    getTenantSettings().then((st) => [isModuleEnabled(st.modules.disabled, "textbooks"), isModuleEnabled(st.modules.disabled, "eie")] as const),
  ]);
  const canReorder = viewAs === null;
  // 305 면은 사무실도 연다(오늘 면의 24반 폭탄과 달리 타임 단위). view=room 은 스코프와 무관.
  if (view === "room") {
    const roomRes = await getEcsSeatDay("JJ", date ?? null);
    return <EcsSeatDayFace res={roomRes} showToday={scoped} />;
  }
  const face: "today" | "week" = scoped ? (view === "week" ? "week" : "today") : "week";

  if (face === "today") {
    // 기본 = **시트 모드**(원장 2026-08-11 "원스크린 느낌으로 한곳에서 모두 수정") — 카드는 보조 요약.
    const mode: EcsTodayMode = modeParam === "cards" ? "cards" : "sheet";
    // 오늘 시트는 **본인 교시만** 그린다(원장 2026-08-19) — 판정 주체는 `effectiveTeacherId`
    // (겸직 강사뷰까지 커버하는 단일 소스. 요청당 캐시라 위 스코프 조회와 왕복을 공유한다).
    // 교재 제안 목록도 같은 Promise.all에(B4) — fail-soft라 무엇이 잘못돼도 빈 목록이다([[#95]]).
    const [todayRes, myTeacherId, textbookOptions] = await Promise.all([
      getEcsToday(date ?? null),
      effectiveTeacherId(),
      loadEcsTextbookOptions(),
    ]);
    let sheets: TodaySheet[] | null = null;
    if (mode === "sheet" && todayRes.ok && todayRes.cards.length > 0) {
      // 반별 주간 시트를 병렬로(B4) — 강사 스코프라 그 날 수업 반 몇 개뿐이다(사무실은 오늘 면 차단).
      // 첫 페인트는 route loading.tsx가 스켈레톤으로 받는다(B7).
      const results = await Promise.all(
        todayRes.cards.map((c) => getClassSheetWeek(c.classId, todayRes.weekMonday)),
      );
      sheets = results
        .map((res, i) => ({
          classId: todayRes.cards[i]!.classId,
          className: todayRes.cards[i]!.className,
          res,
        }))
        // 🔴 순서는 **화면에 보이는 첫 교시**로 다시 세운다(원장 2026-08-19 *"시간대가 순서대로 배치가
        //    안되어있는것 같은데"*). 서버 카드 순서(`cards`)는 `startsAt` = **남의 교시까지 포함한** 그 날
        //    첫 시각이라, 15:00을 남이 맡고 내가 15:40만 맡은 반이 15:00짜리 반보다 위에 왔다.
        //    판정은 화면과 **같은 순수 함수**(firstVisibleTodaySlot)를 쓴다 — 두 벌이면 다시 갈린다.
        // ⚠️ 요약 카드 모드(`cards`)는 반 전체를 그리므로 서버 순서 그대로가 맞다(여기서만 다시 센다).
        .sort((a, b) => {
          const key = (s: TodaySheet) =>
            s.res.ok
              ? (firstVisibleTodaySlot(s.res.data, { date: todayRes.date, myTeacherId }) ?? "99:99")
              : "99:99"; // 조회 실패한 반은 맨 뒤(시각을 알 수 없다)
          return key(a).localeCompare(key(b)) || a.className.localeCompare(b.className, "ko");
        });
      // 🔴 **개인 순서가 마지막에 이긴다** — 위 시각 정렬은 아직 아무 것도 안 정한 사람의 기본값이고,
      //    손으로 정한 순서가 있으면 그게 그 사람의 답이다. 저장에 없는 반은 시각 순서 그대로 뒤에 남는다.
      sheets = applyTodayOrder(sheets, todayRes.ok ? todayRes.todayOrder : []);
    }
    return (
      <EcsTodayFace
        // 요약 카드도 **같은 순서**로 — 보기를 바꿨다고 반 차례가 달라지면 그게 더 헷갈린다.
        res={
          todayRes.ok
            ? { ...todayRes, cards: applyTodayOrder(todayRes.cards, todayRes.todayOrder) }
            : todayRes
        }
        scoped={scoped}
        mode={mode}
        sheets={sheets}
        myTeacherId={myTeacherId}
        lang={lang}
        canReorder={canReorder}
        textbookOptions={textbookOptions}
      />
    );
  }
  const res = await getSheetLanding(week ?? null, { resetStaleFilters: true });

  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={sheetT(lang, "landing.eyebrow")}
          title={sheetT(lang, "landing.title")}
          description={sheetT(lang, "landing.desc")}
        />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }

  // 주 라벨 — 영어는 같은 재료(월요일)로 다시 만든다. 서버가 준 `weekLabel`(한국어)은 그대로 둔다
  // (인쇄·다른 화면도 그 문자열을 쓴다 — 여기서 서버를 바꾸면 그쪽까지 따라 바뀐다).
  const weekText = sheetWeekLabel(res.weekMonday, res.weekLabel, lang);

  /**
   * 목록을 **누구의 눈으로** 묶을지 — 강사 본인이면 담임/부담임, 사무실이면 종전 담임별.
   *
   * 🔴 `scoped`일 때만 id를 넘긴다. 겸직 관리자가 강사뷰를 켰을 때도 `effectiveTeacherId`가 그 사람을
   *    가리키므로 같은 취급을 받는다(뷰 전환은 스코프를 바꾼다 — 권한은 그대로).
   * ⚠️ 이름은 영어 화면이면 영어 이름으로([`teacherNameFor`]) — 표 조회는 **요청 캐시**라(셸이 이미
   *    불렀다) 왕복이 늘지 않고, 한국어 화면이면 그 함수가 빈 표를 받아 원문을 그대로 돌려준다.
   */
  const viewer: { id: string | null; name: string | null } = scoped
    ? await (async () => {
        const [id, me, names] = await Promise.all([
          effectiveTeacherId(),
          getCurrentUser(),
          getTeacherEnglishNames(),
        ]);
        const target = viewAs;
        // 🔴 **'다른 강사 뷰'에서도 그 강사의 이름을 적는다**(원장 2026-09-05 *"관리자가 강사뷰를
        //    접근할때도 내이름 + 담임/부담임으로 보여야하는거 아냐?"*). 그 뷰의 존재 이유가
        //    **"그 사람이 보는 화면 그대로"**라 이름도 그 사람 것이어야 한다(원장 2026-08-19 규약).
        //    상단 배지가 이미 '○○ 강사뷰 · 열람 종료'라 내 이름으로 오해할 여지도 없다.
        const display = target?.displayName ?? (id && me && id === me.id ? me.displayName : null);
        return { id, name: display ? teacherNameFor(display, names, lang) : null };
      })()
    : { id: null, name: null };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={sheetT(lang, "landing.eyebrow")}
        title={sheetT(lang, "landing.title")}
        description={`${sheetT(lang, "landing.desc")} · ${weekText}`}
        embedLabel={`${sheetT(lang, "landing.title")} · ${weekText}`}
      />

      {/* 🔴 툴바를 감싸던 카드 껍데기를 뺐다(원장 2026-09-01) — 아래 반 카드가 자기 테두리를
          갖고 있어 선이 이중으로 겹쳐 보였다. 컨트롤 자체가 테두리를 가져 줄은 그대로 읽힌다. */}
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        {/* '오늘'은 강사 스코프만 — 사무실이 눌러도 주간으로 떨어지는 탭은 거짓 어포던스.
            305는 사무실 본업(그 시각 여러 반)이라 스코프 없어도 단다. */}
        <EcsFaceTabs face="week" showToday={scoped} lang={lang} />
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(monday) => `/ecs?view=week&week=${monday}`} />
        {/* 프로그램 필터(EiE / 인재원 영어) — 계정 귀속. 시트 가져오기 왼쪽에 붙여 주 네비와 한 줄. */}
        {eieOn ? <EcsTrackFilter value={res.trackFilter} counts={res.trackCounts} /> : null}
        {/* 담임 필터 — 프로그램 **다음**에 걸린다(둘은 곱해진다). 옵션이 프로그램 적용 후 집합이라
            순서가 화면과 같고, 담임이 한 명뿐인 화면(강사 본인)에선 컴포넌트가 스스로 사라진다. */}
        <EcsTeacherFilter
          value={res.teacherFilter}
          options={res.teacherOptions}
          totalCount={res.trackCounts[res.trackFilter]}
        />
        {/* 반 계획 보기(원장 2026-09-23 *"우상단 [반 계획 보기] 버튼"* · 툴바 줄 **끝**) — 인재원 영어 반 ×
            영역 월간·주간 대조. 인재원 반이 한 곳도 없는 주엔 빈 화면이라 버튼을 안 세운다. */}
        {res.trackCounts.injaewon > 0 ? (
          <ToolbarButton
            // 보던 주가 이번 주면 오늘(일간 기본), 아니면 그 주 월요일로 연다.
            href={`/ecs/goals?date=${res.today >= res.weekMonday && res.today <= addDays(res.weekMonday, 6) ? res.today : res.weekMonday}`}
            className="ml-auto"
          >
            {sheetT(lang, "goals.title")}
          </ToolbarButton>
        ) : null}
        {/* 계획 대비 현황(원장 2026-09-28) — 원래 월간계획 ↔ 실제를 선생님별·월별로. 반 계획 보기 옆. */}
        {textbooksOn ? (
          <ToolbarButton href="/ecs/plan-gap" className={res.trackCounts.injaewon > 0 ? undefined : "ml-auto"}>
            {sheetT(lang, "gap.title")}
          </ToolbarButton>
        ) : null}
      </div>

      {res.cards.length === 0 ? (
        // 원인별로 다른 안내 — 담당 반이 없는 강사에게 "학원 설정을 확인하라"고 하면
        // 고칠 수 없는 일을 시키는 거짓 안내가 된다(원인 오표시 금지).
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {res.emptyReason === "filtered"
            ? // 되돌릴 수 있는 원인 — 무엇을 누르면 되는지까지 말한다(막다른 안내 금지).
              // 🔴 프로그램 **이름**(EiE·인재원 영어)은 번역하지 않는다 — 필터 칩과 같은 규약(고유명).
              `${sheetT(lang, "landing.empty.filtered.prefix")} '${
                res.trackFilter === "all"
                  ? sheetT(lang, "filter.all")
                  : ENGLISH_TRACK_FILTER_LABEL[res.trackFilter]
              }'${sheetT(lang, "landing.empty.filtered.suffix")}${res.trackCounts.all}${sheetT(lang, "landing.empty.filtered.tail")}`
            : res.emptyReason === "no-week-classes"
              ? // 반은 있는데 그 주만 비었다 — 주를 옮기면 보인다는 것까지 말한다(막다른 안내 금지).
                sheetT(lang, "landing.empty.noWeekClasses")
              : res.emptyReason === "no-scoped-classes"
                ? ecsMathHint(lang)
                : res.emptyReason === "not-configured"
                  ? sheetT(lang, "landing.empty.notConfigured")
                  : sheetT(lang, "landing.empty.none")}
        </p>
      ) : (
        // 카드 벽 → **한 장의 시트**(2026-08-11 원장 "이름에 걸맞게 컴팩트하게"). 상세는 landing-list.tsx.
        <EcsLandingList
          cards={res.cards}
          weekMonday={res.weekMonday}
          lang={lang}
          viewerTeacherId={viewer.id}
          viewerName={viewer.name}
          landingOrder={res.landingOrder}
          canReorder={canReorder}
        />
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
 *    🔴 단 **교시는 본인 담당만** 그린다(원장 2026-08-19 *"오늘 시트에서는 본인 수업만 보이고, 주간 시트는
 *    여전히 지금처럼"*) — 자리(JJ·LAB)와 기록이 남은 교시는 남기고, 숨긴 건수는 각주로 밝힌다
 *    ([today-own-slots](@/features/class-sheets/lib/today-own-slots)). 주간 시트·요약 카드는 불변.
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
  myTeacherId,
  lang,
  canReorder,
  textbookOptions,
}: {
  res: EcsTodayResult;
  scoped: boolean;
  mode: EcsTodayMode;
  sheets: TodaySheet[] | null;
  /** 화면 언어(2026-09-03) — 서버 컴포넌트라 context를 못 읽어 부모가 넘긴다. */
  lang: SheetLang;
  /**
   * 시트 모드의 **내 교시만 보기** 기준 강사 id(`effectiveTeacherId`). 요약 카드 모드는 안 쓴다 —
   * 카드는 하루 요약·작성률이라 반 전체가 목적이다(원장 지시 범위 = "오늘 시트").
   */
  myTeacherId: string | null;
  /** 반 순서를 끌어 바꿀 수 있나 — '다른 강사 뷰'(열람 전용)는 false. */
  canReorder: boolean;
  /** 계획 칸 교재 제안(교재목록 마스터) — 빈 배열이면 `<datalist>`를 아예 안 만든다. */
  textbookOptions: TextbookOptionItem[];
}) {
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader
          eyebrow={sheetT(lang, "landing.eyebrow")}
          title={sheetT(lang, "landing.title")}
          // ⚠️ 조회 실패 갈래라 **수업 수를 모른다** — 수가 든 문구(`today.desc.*`)를 쓰면 `{n}`이 그대로
          //    화면에 찍힌다. 여기선 수 없는 일반 설명을 쓴다(주간 면 실패 갈래와 같은 문구).
          description={sheetT(lang, "landing.desc")}
        />
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
        eyebrow={sheetT(lang, "landing.eyebrow")}
        title={sheetT(lang, "landing.title")}
        // 🔴 문장 **전체**를 사전에서 받는다 — 조각(`머리+수+꼬리`)으로 두면 en 어순이 무너지고,
        //    조각 하나가 다른 키와 같은 영어가 되어 뜻이 뭉친다(`Today`가 면 탭·창 라벨과 겹쳤다).
        description={sheetTf(lang, isToday ? "today.desc.today" : "today.desc.day", { n: res.cards.length })}
        embedLabel={`${sheetT(lang, "landing.title")} · ${isToday ? sheetT(lang, "today.embed.today") : res.date.slice(5)}`}
      />

      {/* 좁은 화면(모바일·좁은 창)은 칩 툴바를 가로 레일로 — 시간표 툴바와 같은 .toolbar-rail 규약. */}
      <div className="toolbar-rail flex flex-wrap items-center gap-3 px-1 py-1">
        <EcsFaceTabs face="today" showToday lang={lang} />
        <EcsTodayModeTabs mode={mode} date={res.date} lang={lang} />
        <EcsDayNav date={res.date} today={res.today} mode={mode} lang={lang} />
        {/* 출결 모드 — 영어 전담 강사에게는 ECS가 홈이라 여기가 그 사람의 입구다(폰엔 사이드바가 없다). */}
        <EcsQuickAttendanceLink lang={lang} />
        {/* 오늘 면이 강사의 기본 진입점 — 보던 날짜로 계획 표를 연다. 교시담당 반은 표의 서버 스코프가 포함한다. */}
        <ToolbarButton href={`/ecs/goals?date=${res.date}`} className="ml-auto">
          {sheetT(lang, "goals.title")}
        </ToolbarButton>
      </div>

      {/* 휴일 한 줄(원장 2026-09-01 *"ecs/mcs 휴일참조"* + *"대신 입력은 가능하도록"*).
          🔴 **재촉이 아니라 사실 전달**이다 — 수업 카드도, 출결도, 계획도 그대로 뜨고 그대로 저장된다.
             그래서 문구가 "쓰지 마세요"가 아니라 "그대로 쓰시면 됩니다"로 끝난다.
          ⚠️ 카드가 0개여도 띄운다 — 그때야말로 "왜 오늘 아무것도 없지"의 답이 이 줄이다.
          ⚠️ 색은 danger 틴트(달력에서 공휴일이 빨간 것과 같은 관행)지만 실패가 아니므로 아이콘·굵기로
             경고를 더 세우지 않는다. */}
      {res.holidayName ? (
        <p className="border-danger/30 bg-danger-soft/40 text-foreground rounded-2xl border px-4 py-2.5 text-sm">
          {/* ⚠️ 날짜를 "09/24은"처럼 적지 않는다 — 조사가 어긋난다. '일'로 끝나면 '은'이 맞다.
              ⚠️ 영어는 조사가 없어 날짜 표기 뒤에 `is`가 붙는다 — 그래서 주어를 통째로 만들어 넣는다
                 (한국어 문장을 조각내 붙이면 조사가 깨진다). 🔴 휴일 **이름**은 데이터라 번역 안 한다. */}
          <b className="text-danger">
            {isToday
              ? sheetT(lang, "today.holiday.today")
              : lang === "en"
                ? `${sheetDateLabelEn(res.date)} is`
                : `${Number(res.date.slice(5, 7))}월 ${Number(res.date.slice(8, 10))}일은`}{" "}
            {res.holidayName}
          </b>{" "}
          {sheetT(lang, "today.holiday.tail")} <b>{sheetT(lang, "today.holiday.asUsual")}</b>
          {sheetT(lang, "today.holiday.tail2")}
        </p>
      ) : null}

      {/* 읽기 권한 안내(원장 2026-11-05) — 계획·학생 기록 칸은 이미 잠겨 있지만 값이 차 있으면 왜 못 고치는지
          모른다. 시트 모드는 반마다 SheetClient가 쌓이므로 **이 화면에 한 줄만** 띄운다(칸·반마다 반복 금지).
          판정 = 카드·시트와 같은 `res.canWrite`(accessLevelTenant("ecs") full|scoped). */}
      {!res.canWrite && res.cards.length > 0 ? (
        <p className="text-text-dim px-1 text-sm">{writeLockedNote("ecs")}</p>
      ) : null}

      {/* 오늘 시트는 **본인 담당 교시만** 그린다(2026-08-19) — 그래서 "그 교시가 왜 없지"가 생긴다.
          종전엔 반마다 각주를 길게 달았는데 반이 셋이면 같은 문장이 셋 쌓였다 → 원장 지시로 각주를 빼고
          (*"이 멘트 필요없음"*) **되돌릴 곳만 화면 맨 위 한 줄**로 알린다(*"적당히 크게"*).
          ⚠️ 시트 모드에서만 — 요약 카드는 반 전체 교시를 그리므로 이 안내가 거짓이 된다.
          ⚠️ 반이 0개면 그 빈 화면 문구가 이미 주간 시트를 가리킨다(같은 말을 두 번 하지 않는다). */}
      {mode === "sheet" && res.cards.length > 0 ? (
        <p className="text-text-dim px-1 text-base leading-relaxed font-medium">
          {sheetT(lang, "today.weekHint.before")}{" "}
          <span className="text-foreground font-bold">{sheetT(lang, "today.weekHint.link")}</span>
          {sheetT(lang, "today.weekHint.after")}
        </p>
      ) : null}

      {/* 오늘 출석 미입력 스트립(2026-08-14) — 영어가 이 기능의 최대 수요처다: 최근 28일 영어 반은
          수업이 열린 464 반×날짜 중 **425건(91.6%)이 출결 0행**이었다. 원스크린과 같은 컴포넌트라
          강사가 화면마다 다른 제스처를 외우지 않는다. ⚠️ Suspense로 첫 페인트를 막지 않는다(B7).
          ⚠️ 오늘이 아닌 날짜를 보고 있으면 스트립은 스스로 오늘 기준이라 뜨지 않는다(과거 재촉 금지). */}
      {isToday && (
        <Suspense fallback={null}>
          <TodayAttendanceStrip />
        </Suspense>
      )}
      {/* 내 할 일(0377a) — 원스크린과 같은 한 줄. 열린 할 일이 있을 때만. */}
      <Suspense fallback={null}>
        <MyTasksStrip />
      </Suspense>
      {/* 오늘 내 업무(s2_0039) — 원스크린과 같은 한 줄(영어는 반 알림장 · 출결). */}
      <Suspense fallback={null}>
        <MyDutiesStrip />
      </Suspense>

      {/* 계획 칸의 교재 제안 — `<datalist>`는 프로바이더가 한 번만 그린다(주간·월간과 같은 부품). */}
      <TextbookOptionsProvider options={textbookOptions}>
      {res.cards.length === 0 ? (
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {!res.hasAnyClass
            ? scoped
              ? sheetT(lang, "today.empty.noClassScoped")
              : sheetT(lang, "today.empty.noClass")
            : `${sheetT(lang, isToday ? "today.empty.noLesson.today" : "today.empty.noLesson.day")}${sheetT(lang, "today.empty.noLesson.tail")}`}
        </p>
      ) : mode === "sheet" ? (
        // 시트 모드 — 반마다 SheetClient를 그 날짜 열만 필터해 쌓는다. 조회 실패한 반은 그 반만 사유를
        // 보이고 나머지는 그린다(한 반 때문에 하루 전체가 죽으면 안 된다).
        // 🔴 순서 바꾸기는 **껍데기만** 클라다 — 카드는 여기서 서버가 그린 그대로 넘어간다
        //    (클라가 다시 그리면 편집기·저널·presence가 재마운트돼 입력 중이던 값이 날아간다).
        <TodayOrderList
          key={res.date}
          canReorder={canReorder}
          items={(sheets ?? []).map((s) => ({
            id: s.classId,
            label: s.className,
            node: s.res.ok ? (
              // 🔴 수업명 줄은 **카드 안**으로 내려갔다(원장 2026-08-18: "수업명을 빈 공간으로 이동시켜줘"
              //    + "그러면 행 절약할 수 있을듯"). 이름·'주간 시트 열기'·'수정중' 배지는 SheetClient가
              //    `header`로 넘긴다(today-class-sheet.tsx) — 위계는 그대로 옮겼다.
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
                myTeacherId={myTeacherId}
              />
            ) : (
              <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-4 text-sm">
                {s.className}: {s.res.error}
              </p>
            ),
          }))}
        />
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
          // 휴일이면 요약 스트립의 **재촉 색**만 걷는다(숫자는 그대로) — 위 한 줄이 이미 사유를 말한다.
          // 반 카드의 일괄 출석은 휴일 이름을 넣어 한 번 묻는다(원장 2026-10-13, 막지는 않는다).
          holidayName={res.holidayName}
        />
      )}
      </TextbookOptionsProvider>
    </div>
  );
}
