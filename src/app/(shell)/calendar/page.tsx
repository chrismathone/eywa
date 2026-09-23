import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { FilterSelect } from "@/components/filter-select";
import { HrefSelect } from "@/components/href-select";
import { PeriodNav } from "@/components/period-nav";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { SearchToggle } from "@/components/search-toggle";
import {
  CALENDAR_QUERY_MAX,
  getCalendarTags,
  getMonthEvents,
  getYearEvents,
  getYearRangeEvents,
  searchEventsByTitle,
} from "@/features/calendar/server/queries";
import { CalendarClient } from "./_components/calendar-client";
import { YearView } from "./_components/year-view";
import { ListView } from "./_components/list-view";
import { StatsView } from "./_components/stats-view";
import { EventOpenHost } from "./_components/event-open";

export const metadata = { title: "캘린더 — aywa" };

/**
 * 캘린더(학원 공용 일정) — 원장 2026-08-18: *"일단 캘린더 탭으로 우리 프로그램 내에 일정부터 관리."*
 * aywa DB가 일정의 단일 진실(0218a — 구글 상시 동기화 없음).
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
/** 연간·목록·분석의 연도 범위 — 밖이면 올해로(주소창 장난). 화살표 잠금도 같은 값. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

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
  searchParams: Promise<{ m?: string; v?: string; y?: string; tag?: string; q?: string }>;
}) {
  const user = await requireAccess("calendar");
  const sp = await searchParams;
  const today = kstToday();
  const thisMonth = today.slice(0, 7);
  const month = sp.m && MONTH_RE.test(sp.m) ? sp.m : thisMonth;

  const view: ViewKey = VIEWS.some((x) => x.key === sp.v) ? (sp.v as ViewKey) : "month";
  const thisYear = Number(today.slice(0, 4));
  const yRaw = Number(sp.y);
  const year = Number.isInteger(yRaw) && yRaw >= YEAR_MIN && yRaw <= YEAR_MAX ? yRaw : thisYear;

  // 분석 창 = 전년·해당연도·다음연도. 표시와 조회가 **같은 배열**을 쓰므로 경계 연도(2000·2100)에서도
  // "화면엔 있는데 데이터는 없는 해"가 생기지 않는다.
  const statsYears = [year - 1, year, year + 1].filter((y) => y >= YEAR_MIN && y <= YEAR_MAX);

  // 제목 검색(N9, 2026-09-23 전수 점검) — 목록·연간 보기에서만. 목록은 **전체 연도**에서 찾고(몇 해 전 일정을
  // 연도를 넘기며 찾지 않게), 연간은 보고 있는 해 안에서 거른다(12개월 카드는 한 해의 틀이다).
  const q = view === "list" || view === "year" ? (sp.q ?? "").trim().slice(0, CALENDAR_QUERY_MAX) : "";
  const searchAllYears = view === "list" && q.length > 0;

  // 태그 사전·일정·쓰기 판정은 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [tags, data, canWrite] = await Promise.all([
    getCalendarTags(),
    view === "month"
      ? getMonthEvents(month)
      : view === "stats"
        ? getYearRangeEvents(statsYears[0]!, statsYears[statsYears.length - 1]!)
        : searchAllYears
          ? searchEventsByTitle(q)
          : getYearEvents(year),
    canWriteTenant(user.systemRole, "calendar"),
  ]);

  // 태그 필터 — 사전에 없는 id는 조용히 "전체"로(주소창 장난·삭제된 태그의 딥링크).
  const tagParam =
    sp.tag === "none" || (sp.tag && tags.some((t) => t.id === sp.tag)) ? sp.tag : undefined;
  const qLower = q.toLowerCase();
  const filtered = data.events.filter(
    (e) =>
      (tagParam === undefined || (tagParam === "none" ? !e.tag : e.tag?.id === tagParam)) &&
      // 연간 보기의 제목 검색은 여기서(목록은 서버 조회가 이미 제목으로 좁혔다 — 같은 조건이라 다시 걸러도 무해).
      (!qLower || e.title.toLowerCase().includes(qLower)),
  );

  const tagQ = tagParam ? `&tag=${tagParam}` : "";
  // 연도를 넘겨도 검색어는 잇는다(목록·연간끼리 오갈 때도) — 월·분석으로 가면 쓰지 않는다.
  const qQ = q ? `&q=${encodeURIComponent(q)}` : "";
  // 월 보기에서 다른 보기로 갈 땐 **보던 달의 해**를 잇는다(옛 코드는 올해 고정이라 2027-03을 보다 연간을 고르면 2026으로 갔다).
  // ⚠️ 월 보기는 연도 바닥이 없어(‹로 1999-12까지 간다) 범위 밖이면 서버가 쓸 값(`year` = 올해)을 그대로 싣는다 — href가
  //    "1999로 간다"고 적고 2026에 내리는 거짓 주소를 만들지 않는다(재리뷰 2026-09-04).
  const monthYear = Number(month.slice(0, 4));
  const yearForView = view === "month" && monthYear >= YEAR_MIN && monthYear <= YEAR_MAX ? monthYear : year;
  const viewHref = (k: ViewKey) =>
    k === "month"
      ? "/calendar"
      : `/calendar?v=${k}&y=${yearForView}${tagQ}${k === "list" || k === "year" ? qQ : ""}`;
  const yearHref = (yy: number) => `/calendar?v=${view}&y=${yy}${tagQ}${qQ}`;

  const [y, mo] = month.split("-");
  const monthLabel = `${y}년 ${Number(mo)}월`;

  // 보기 전환 = `보기: 월` 드롭다운(§10 칩 줄 금지). 항목이 값이 아니라 **서버 href**다 — 보기를 바꿀 때 연도·태그를 함께
  // 실어야 해서 `FilterSelect`(파라미터 하나 교체)가 아니라 `HrefSelect`(출석부 '보기'와 같은 부품). 월 보기 줄은
  // CalendarClient가 그리므로 노드로 넘긴다(같은 줄에 월 네비·버튼이 서야 한다 — 줄이 둘이면 창 높이를 먹는다).
  const viewSelect = (
    <HrefSelect
      axisLabel="보기"
      ariaLabel="캘린더 보기 방식"
      value={view}
      options={VIEWS.map((vd) => ({ value: vd.key, label: vd.label, href: viewHref(vd.key) }))}
    />
  );
  // 분석은 한 해가 아니라 3개년 창이라 라벨도 범위로(화살표는 창을 한 해씩 민다).
  const yearLabel =
    view === "stats" ? `${statsYears[0]}~${statsYears[statsYears.length - 1]}년` : `${year}년`;

  return (
    // 풀폭·풀높이 — 캘린더는 여백보다 면적이 정보다(원장 2026-08-18 "캘린더가 너무 작음").
    // 헤더 없음(원장 2026-08-18 "밑에 똑같이 있으니까 없애고 위로 당겨줘") — 창 타이틀바가 "캘린더".
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 툴바(지시서 §10, 디자인 v5 15단계 2026-09-04) — **한 줄**: `보기: 월` · 연도 이동(앱 전역 PeriodNav — 옛 size-8
          화살표 링크 + '올해' 버튼; 라벨 클릭 = 올해) · `태그: 전체`(옛 칩 줄 — 태그 수만큼 늘어 두 줄이었다). 옛 알약 세그먼트
          (h-8·12px)와 두 줄 툴바를 걷었다. 월 보기는 CalendarClient가 같은 자리에 월 네비·버튼을 그린다. */}
      {view !== "month" ? (
        <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
          {viewSelect}
          <PeriodNav
            label={yearLabel}
            prevHref={yearHref(year - 1)}
            nextHref={yearHref(year + 1)}
            currentHref={yearHref(thisYear)}
            relation={year === thisYear ? "current" : year < thisYear ? "past" : "future"}
            prevAriaLabel="이전 연도"
            nextAriaLabel="다음 연도"
            currentTitle="눌러서 올해로"
            // 연도 범위(2000~2100) 밖은 서버가 올해로 되돌리므로 경계에선 화살표를 잠근다(공휴일 면과 같은 규약).
            prevDisabled={year <= YEAR_MIN}
            nextDisabled={year >= YEAR_MAX}
            // "2026년" / "2025~2027년"(분석)이 안 넘치는 고정 폭.
            labelWidth={view === "stats" ? 104 : 60}
          />
          {/* 태그 필터(연간·목록·분석) — 월 보기는 그리드가 색으로 이미 말한다. `tag`만 갈아 끼우고 v·y는 그대로. */}
          {tags.length > 0 ? (
            <FilterSelect
              paramName="tag"
              value={tagParam ?? ""}
              options={[
                ...tags.map((t) => ({ value: t.id, label: t.name })),
                { value: "none", label: "태그 없음" },
              ]}
              allLabel="전체"
              axisLabel="태그"
              ariaLabel="태그 필터"
              cap={100}
              className="w-auto"
              triggerClassName={TOOLBAR_SELECT}
            />
          ) : null}
          {/* 제목 검색(N9) — 목록은 전체 연도, 연간은 이 해 안. 필요할 때만 펼친다(§10). */}
          {view === "list" || view === "year" ? <SearchToggle placeholder="일정 제목" defaultValue={q} /> : null}
          {/* 숫자의 뜻을 바꾸는 사실이라 접지 않는다 — 휴가(결재 문서) 오버레이는 월 보기에만 있다. */}
          <span className="text-text-faint ml-auto text-xs">휴가는 월 보기에서만 표시됩니다</span>
        </div>
      ) : null}

      {!data.ready ? (
        <>
          {/* 표가 없어도 보기 전환은 남긴다(옛 nav도 배너와 무관하게 항상 섰다) — 월 보기 줄은 CalendarClient 몫이라 여기서 그린다. */}
          {view === "month" ? <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">{viewSelect}</div> : null}
          <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
            캘린더 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0218a</span>를
            적용하면 바로 쓸 수 있습니다.
          </div>
        </>
      ) : view === "month" ? (
        <CalendarClient
          viewSelect={viewSelect}
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
        <EventOpenHost canWrite={canWrite} today={today} tags={tags}>
          <YearView year={year} events={filtered} />
        </EventOpenHost>
      ) : view === "list" ? (
        <EventOpenHost canWrite={canWrite} today={today} tags={tags}>
          <ListView events={filtered} searchAllYears={searchAllYears} />
        </EventOpenHost>
      ) : (
        <StatsView years={statsYears} events={data.events} tags={tags} tagFilter={tagParam} />
      )}
    </div>
  );
}
