import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EmbedLink } from "@/components/embed-link";
import { teacherViewHome } from "@/lib/auth/teacher-home";
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/aywa-icon-compat";
import { requireAccess } from "@/lib/auth/require-access";
import { formatKoreanDate, kstToday } from "@/lib/date-kst";
import { getLiveBoard } from "@/features/attendance/live/server/queries";
import { holidayNameOf } from "@/features/attendance/live/server/load";
import { getHolidayDayActivity } from "@/features/attendance/server/holiday-activity";
import { HolidayActivityPanel } from "@/features/attendance/live/components/holiday-activity-panel";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { classNameFor } from "@/features/teacher-view/class-name";
import { reportError } from "@/lib/observability/report-error";
import { quickClasses } from "@/features/attendance/quick/board";
// 강사 미니셸이면 화면 언어를 따른다(원장 2026-09-04 "강사가 접근 가능한 모든 메뉴를 전환").
import { getTeacherViewLang } from "@/features/teacher-view/server/lang";
import { sheetDateLabel, sheetT, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";
import { QuickBoard } from "@/features/attendance/quick/components/quick-board";
import { PAGE_TITLE_SUFFIX } from "@/lib/config/site-metadata";

export async function generateMetadata() {
  return { title: `${sheetT(await getTeacherViewLang(), "quick.title")}${PAGE_TITLE_SUFFIX}` };
}

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
  // 휴원일 판정과 보드 적재는 서로 독립이라 병렬(B4). 화면 언어는 쿠키 한 번이라 같이 묶는다.
  const [board, holiday, lang, homeHref] = await Promise.all([
    getLiveBoard(today, true),
    holidayNameOf(today),
    getTeacherViewLang(),
    teacherViewHome(),
  ]);

  if (holiday) {
    // 휴원일엔 명단을 만들지 않는다. 그래도 이 강사 반에 그날 입력된 출결·보강 예약이 있으면 읽기 전용으로 보여 주고,
    // 입력할 곳(월별 출석부)으로 보낸다 — 수업한 휴원일에 빈 화면에서 멈추지 않게.
    // 🔴 범위는 **내 수업만**(selfOnly) — 이 화면은 관리자 계열이 열어도 자기 반만 본다. 일별 출석부 링크는 없다.
    const [activity, settings] = await Promise.all([
      getHolidayDayActivity(today, true).catch((error: unknown) => {
        reportError(error, { scope: "attendance.quick.holidayActivity", date: today });
        return null;
      }),
      getTenantSettings(),
    ]);
    return (
      <div className="space-y-4">
        <Header date={today} lang={lang} homeHref={homeHref} />
        {/* 🔴 휴일 **이름**은 학원설정에 적힌 그대로 — 옮길 표가 없다(지어내지 않는다). */}
        <EmptyState
          icon={CalendarDays}
          title={sheetTf(lang, "quick.holiday.title", { name: holiday })}
          description={sheetT(lang, "quick.holiday.desc")}
          action={
            <EmbedLink
              href={`/attendance?month=${today.slice(0, 7)}`}
              className="text-primary text-sm font-bold underline underline-offset-2"
            >
              {sheetT(lang, "quick.holiday.monthly")}
            </EmbedLink>
          }
        />
        <HolidayActivityPanel
          activity={activity}
          date={today}
          lang={lang}
          labelOf={buildSubjectMaps(settings.operations.subjects).labelOf}
          classNameOf={(name) => classNameFor(name, lang)}
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
      <Header date={today} lang={lang} homeHref={homeHref} />
      <QuickBoard date={today} classes={classes} canEdit={board.canEdit} />
    </div>
  );
}

function Header({ date, lang, homeHref }: { date: string; lang: SheetLang; homeHref: string }) {
  // 날짜 표기도 화면 언어를 따른다 — 한국어는 앱 전역 `formatKoreanDate`가 정본이다.
  const label = sheetDateLabel(date, formatKoreanDate(date), lang);
  return (
    <PageHeader
      eyebrow={sheetT(lang, "quick.eyebrow")}
      title={sheetT(lang, "quick.title")}
      description={sheetTf(lang, "quick.header.desc", { date: label })}
      embedLabel={sheetTf(lang, "quick.embed", { date: label })}
      actions={<Button render={<EmbedLink href={homeHref} />}>{sheetT(lang, "quick.exit")}</Button>}
    />
  );
}
