import Link from "next/link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { EyIcon } from "@/components/icons/eywa-icons";
import { TOOLBAR_CHIP } from "@/components/toolbar-controls";
import { dotProps } from "@/features/calendar/color";
import {
  getCalendarTags,
  getMonthEvents,
  getYearEvents,
  getYearRangeEvents,
} from "@/features/calendar/server/queries";
import { CalendarClient } from "./_components/calendar-client";
import { YearView } from "./_components/year-view";
import { ListView } from "./_components/list-view";
import { StatsView } from "./_components/stats-view";

export const metadata = { title: "캘린더 — eywa" };

/**
 * 캘린더(학원 공용 일정) — 원장 2026-08-18: *"일단 캘린더 탭으로 우리 프로그램 내에 일정부터 관리."*
 * eywa DB가 일정의 단일 진실(0218a — 구글 상시 동기화 없음).
 *
 * 다중 뷰(0224a, 원장 2026-08-19 "여러가지 버전으로 볼 수 있게"): `?v=month(기본)|year|list|stats`
 * + `y=YYYY`(연간·목록·분석) + `tag=<태그id|none>`(필터). 전환·연도·필터 전부 URL(Link) —
 * 새로고침·딥링크·창 타이틀이 공짜고 서버 컴포넌트가 유지된다. `m=`은 월 보기 전용.
 *
 * ⚠️ **분석 뷰만 `y`를 한 해가 아니라 3개년 창의 가운데로 읽는다**(원장 2026-08-19 "전년도 후년도까지
 *    한번에") — 조회도 그때만 3년치다. 다른 뷰는 지금대로 한 해만 읽는다(괜한 3배 조회 금지, B4/B7).
 *
 * 접근 = `calendar` 메뉴(사무실 full / 강사·상담·회계 readonly) — 열람은 전 직원(뷰 4종 모두),
 * 쓰기는 사무실. 쓰기 판정은 화면·액션이 같은 함수(canWriteTenant)를 쓴다([[#77]]).
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM"에 delta개월 — UTC 산술이라 서버 TZ 무관. */
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const VIEWS = [
  { key: "month", label: "월" },
  { key: "year", label: "연간" },
  { key: "list", label: "목록" },
  { key: "stats", label: "분석" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; v?: string; y?: string; tag?: string }>;
}) {
  const user = await requireAccess("calendar");
  const sp = await searchParams;
  const today = kstToday();
  const thisMonth = today.slice(0, 7);
  const month = sp.m && MONTH_RE.test(sp.m) ? sp.m : thisMonth;

  const view: ViewKey = VIEWS.some((x) => x.key === sp.v) ? (sp.v as ViewKey) : "month";
  const thisYear = Number(today.slice(0, 4));
  const yRaw = Number(sp.y);
  const year = Number.isInteger(yRaw) && yRaw >= 2000 && yRaw <= 2100 ? yRaw : thisYear;

  // 분석 창 = 전년·해당연도·다음연도. 표시와 조회가 **같은 배열**을 쓰므로 경계 연도(2000·2100)에서도
  // "화면엔 있는데 데이터는 없는 해"가 생기지 않는다.
  const statsYears = [year - 1, year, year + 1].filter((y) => y >= 2000 && y <= 2100);

  // 태그 사전·일정·쓰기 판정은 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [tags, data, canWrite] = await Promise.all([
    getCalendarTags(),
    view === "month"
      ? getMonthEvents(month)
      : view === "stats"
        ? getYearRangeEvents(statsYears[0]!, statsYears[statsYears.length - 1]!)
        : getYearEvents(year),
    canWriteTenant(user.systemRole, "calendar"),
  ]);

  // 태그 필터 — 사전에 없는 id는 조용히 "전체"로(주소창 장난·삭제된 태그의 딥링크).
  const tagParam =
    sp.tag === "none" || (sp.tag && tags.some((t) => t.id === sp.tag)) ? sp.tag : undefined;
  const filtered =
    tagParam === undefined
      ? data.events
      : data.events.filter((e) => (tagParam === "none" ? !e.tag : e.tag?.id === tagParam));

  const tagQ = tagParam ? `&tag=${tagParam}` : "";
  const viewHref = (k: ViewKey) => (k === "month" ? "/calendar" : `/calendar?v=${k}&y=${year}${tagQ}`);
  const yearHref = (yy: number) => `/calendar?v=${view}&y=${yy}${tagQ}`;
  const tagHref = (t?: string) => `/calendar?v=${view}&y=${year}${t ? `&tag=${t}` : ""}`;

  const [y, mo] = month.split("-");
  const monthLabel = `${y}년 ${Number(mo)}월`;
  const navBtn =
    "border-line text-text-dim hover:text-foreground hover:border-primary/50 flex size-8 items-center justify-center rounded-lg border transition";

  return (
    // 풀폭·풀높이 — 캘린더는 여백보다 면적이 정보다(원장 2026-08-18 "캘린더가 너무 작음").
    // 헤더 없음(원장 2026-08-18 "밑에 똑같이 있으니까 없애고 위로 당겨줘") — 창 타이틀바가 "캘린더".
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 뷰 전환(알약) + 연간·목록·분석의 연도 이동 — 월 이동은 월 보기(CalendarClient)가 담당. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 툴바 라운드 통일(원장 2026-09-01) — 알약 대신 덜 둥근 묶음 상자. 색은 종전 그대로. */}
        <nav className="bg-bg-soft flex h-8 items-center gap-0.5 rounded-lg p-0.5" aria-label="캘린더 보기 방식">
          {VIEWS.map((vd) => (
            <Link
              key={vd.key}
              href={viewHref(vd.key)}
              className={`rounded-md px-3 py-1 text-[12.5px] transition ${
                view === vd.key
                  ? "bg-card text-foreground font-semibold shadow-sm"
                  : "text-text-dim hover:text-foreground"
              }`}
            >
              {vd.label}
            </Link>
          ))}
        </nav>
        {view !== "month" ? (
          <div className="flex items-center gap-1.5">
            <Link href={yearHref(year - 1)} className={navBtn} aria-label="이전 연도">
              <EyIcon name="chevronLeft" size={16} />
            </Link>
            {/* 분석 뷰는 한 해가 아니라 3개년 창이라 라벨도 범위로 — 가운데 해만 굵게(◀▶가 미는 축). */}
            <span className="num text-foreground min-w-[64px] text-center text-[16px] font-bold tracking-tight">
              {view === "stats" ? (
                <>
                  {statsYears.map((y, i) => (
                    <span key={y}>
                      {i > 0 ? <span className="text-text-faint mx-1 font-normal">·</span> : null}
                      <span className={y === year ? "" : "text-text-dim text-[13px] font-medium"}>
                        {y}
                      </span>
                    </span>
                  ))}
                </>
              ) : (
                year
              )}
            </span>
            <Link href={yearHref(year + 1)} className={navBtn} aria-label="다음 연도">
              <EyIcon name="chevronRight" size={16} />
            </Link>
            {year !== thisYear ? (
              <Link
                href={yearHref(thisYear)}
                className="border-line text-text-dim hover:text-foreground hover:border-primary/50 inline-flex h-8 items-center rounded-lg border px-2.5 text-[12px] transition"
              >
                올해
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 태그 필터(연간·목록·분석) — 월 보기는 그리드가 색으로 이미 말한다. */}
      {view !== "month" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.length > 0 ? (
            <>
              <Link
                href={tagHref()}
                className={`${TOOLBAR_CHIP} ${
                  tagParam === undefined
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line bg-card text-text-dim hover:border-primary/50 hover:text-foreground"
                }`}
              >
                전체
              </Link>
              {tags.map((t) => {
                // 색은 단일 소스(color.ts) — 프리셋은 클래스, 사용자 지정 hex는 inline style로 온다.
                const dot = dotProps(t.color);
                return (
                  <Link
                    key={t.id}
                    href={tagHref(t.id)}
                    className={`${TOOLBAR_CHIP} gap-1.5 ${
                      tagParam === t.id
                        ? "border-primary bg-primary text-primary-foreground font-medium"
                        : "border-line bg-card text-text-dim hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${dot.className}`}
                      style={dot.style}
                      aria-hidden
                    />
                    {t.name}
                  </Link>
                );
              })}
              <Link
                href={tagHref("none")}
                className={`${TOOLBAR_CHIP} ${
                  tagParam === "none"
                    ? "border-primary bg-primary text-primary-foreground font-medium"
                    : "border-line bg-card text-text-dim hover:border-primary/50 hover:text-foreground"
                }`}
              >
                태그 없음
              </Link>
            </>
          ) : null}
          <span className="text-text-faint ml-auto text-[11px]">휴가는 월 보기에서만 표시됩니다</span>
        </div>
      ) : null}

      {!data.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          캘린더 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0218a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : view === "month" ? (
        <CalendarClient
          month={month}
          monthLabel={monthLabel}
          prevMonth={shiftMonth(month, -1)}
          nextMonth={shiftMonth(month, 1)}
          isCurrentMonth={month === thisMonth}
          today={today}
          events={data.events}
          canWrite={canWrite}
          tags={tags}
        />
      ) : view === "year" ? (
        <YearView year={year} events={filtered} />
      ) : view === "list" ? (
        <ListView events={filtered} />
      ) : (
        <StatsView years={statsYears} events={data.events} tags={tags} tagFilter={tagParam} />
      )}
    </div>
  );
}
