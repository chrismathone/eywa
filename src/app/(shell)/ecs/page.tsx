import type { Metadata } from "next";
import { requireAccess } from "@/lib/auth/require-access";
import { PageHeader } from "@/components/page-header";
import { WeekNav } from "@/app/(shell)/timetable/_components/week-nav";
import { getSheetLanding } from "@/features/class-sheets/server/queries";
import { getEcsToday, type EcsTodayResult } from "@/features/class-sheets/server/today";
import { TodayBoard } from "@/features/class-sheets/components/today-board";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { canManageSheetSync } from "@/features/integrations/server/sheet-access";
import { EcsSheetImportDialog } from "./_components/sheet-import-dialog";
import { EcsLandingList } from "./_components/landing-list";
import { EcsTrackFilter } from "./_components/track-filter";
import { EcsFaceTabs, EcsDayNav } from "./_components/today-nav";
import { ENGLISH_TRACK_FILTER_LABEL } from "@/features/classes/english-track";

export const metadata: Metadata = { title: "영어 강사 시트 — eywa" };

/**
 * ECS 랜딩 — 면 두 개.
 *  · **오늘**(강사 기본값) = 영어 강사의 원스크린. 그 날 수업이 있는 내 반만 교시 순서로 쌓아
 *    계획·출결·보고서 상태를 한 화면에서 본다(원장 지시 2026-08-07 "ECS를 기반으로 한 원스크린").
 *  · **주간** = 기존 반 카드 + 주간 작성률(사무실 기본값 — 전 반을 훑는 자리라 날짜로 좁히면 못 쓴다).
 *
 * ⚠️ 기본 면을 **역할이 아니라 스코프**로 가른다: 강사 스코프가 있으면(내 반이 정해져 있으면) '오늘'.
 *    관리자는 스코프가 없어 '오늘'로 열면 학원 전체의 그날 수업이 쏟아진다 — 그건 시간표의 일이다.
 */
export default async function EcsLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; date?: string }>;
}) {
  await requireAccess("ecs");
  const { week, view, date } = await searchParams;
  // 🔴 '오늘' 면은 **강사 스코프 전용**이다. 스코프가 없는 사람(사무실)에게 이 면은 그 날 운영 중인
  // 영어 반 **전부**(실측 24반)를 편집기·저널·presence 채널과 함께 펼친다 — 쓸 일도 없는 화면에
  // IndexedDB 문서 24개와 realtime 채널 24개를 여는 셈이다(2026-08-07 적대적 리뷰).
  // 학원 전체의 하루를 보는 건 시간표의 일이다. `?view=today`를 손으로 넣어도 주간으로 떨어뜨린다.
  const scoped = (await effectiveTeacherScope()) !== null;
  const face: "today" | "week" = scoped ? (view === "week" ? "week" : "today") : "week";

  if (face === "today") {
    const todayRes = await getEcsToday(date ?? null);
    return <EcsTodayFace res={todayRes} scoped={scoped} />;
  }
  // 시트 가져오기 버튼은 시트 경로 자격(sheet_sync=full)에만 — 서버 액션도 같은 게이트로 이중 방어.
  const [res, user] = await Promise.all([getSheetLanding(week ?? null), getCurrentUser()]);
  const canSync = user ? await canManageSheetSync(user.systemRole) : false;

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
        {/* 면 전환은 **'오늘'을 쓸 수 있는 사람에게만** 보인다 — 눌러도 주간으로 돌아오는 탭은 거짓 어포던스다. */}
        {scoped ? <EcsFaceTabs face="week" /> : null}
        <WeekNav currentWeek={res.weekMonday} today={res.today} hrefForWeek={(monday) => `/ecs?view=week&week=${monday}`} />
        {/* 프로그램 필터(EiE / 인재원 영어) — 계정 귀속. 시트 가져오기 왼쪽에 붙여 주 네비와 한 줄. */}
        <EcsTrackFilter value={res.trackFilter} counts={res.trackCounts} />
        {canSync ? (
          <div className="ml-auto">
            <EcsSheetImportDialog />
          </div>
        ) : null}
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
 * ⚠️ 빈 화면 문구를 **원인별로** 가른다(랜딩과 같은 규약): 담당 반이 아예 없는 것과, 반은 있는데
 *    그 날 수업이 없는 것은 사람이 할 일이 완전히 다르다. 하나로 뭉치면 둘 중 하나는 거짓말이 된다.
 */
function EcsTodayFace({ res, scoped }: { res: EcsTodayResult; scoped: boolean }) {
  if (!res.ok) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="수업 운영" title="영어 강사 시트" description="오늘 수업" />
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">{res.error}</p>
      </div>
    );
  }
  const isToday = res.date === res.today;
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
        <EcsFaceTabs face="today" />
        <EcsDayNav date={res.date} today={res.today} />
      </div>

      {res.cards.length === 0 ? (
        <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
          {!res.hasAnyClass
            ? scoped
              ? "담당하고 계신 영어 반이 없습니다. 반 배정은 사무실에 문의하세요."
              : "운영 중인 영어 반이 없습니다."
            : `${isToday ? "오늘은" : "이 날은"} 수업이 없습니다. 다른 날짜를 보시거나 '주간 시트'에서 이번 주 전체를 확인하세요.`}
        </p>
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
