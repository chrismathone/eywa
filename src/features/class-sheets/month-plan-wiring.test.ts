/**
 * **월간 계획서(MP) 배선 규약** — 하나만 어긋나도 **에러 없이** 틀린다.
 *
 * MP는 원장 2026-09-01 지시로 **EiE 반에만** 붙는다: *"일단은 EiE 수업에만 적용될거고, 추후에
 * 인재원 영어에 적용할지는 당장 결정 안 할 예정임."* 화면에서 탭만 감추면 주소를 직접 치면 열리므로
 * (#77) **표면 넷이 전부 같은 판정**을 통과해야 한다 — 탭 · 조회 · 저장 · 인쇄.
 *
 * 그리고 표(0239a)는 원장이 손으로 적용한다([[#95]]) → **표가 없어도 달력·진도표는 살아야 한다.**
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
/** 주석은 규약이 아니라 설명이다 — 단언이 주석 문구에 걸려 거짓 통과하지 않게 지운다. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const chrome = strip(read("src", "features", "class-sheets", "chrome.ts"));
const monthQueries = strip(read("src", "features", "class-sheets", "server", "month-queries.ts"));
const planActions = strip(read("src", "features", "class-sheets", "server", "month-plan-actions.ts"));
const planPrint = strip(read("src", "features", "class-sheets", "server", "month-plan-print.ts"));
const planChrome = strip(read("src", "features", "class-sheets", "server", "month-plan-chrome.ts"));
const planView = strip(read("src", "features", "class-sheets", "components", "month-plan-view.tsx"));
const planTexts = strip(read("src", "features", "owner", "month-plan-texts.ts"));
const monthPage = strip(read("src", "app", "(shell)", "ecs", "[classId]", "month", "page.tsx"));
const monthClient = strip(read("src", "features", "class-sheets", "components", "month-client.tsx"));
const toolbar = strip(read("src", "features", "class-sheets", "components", "sheet-toolbar.tsx"));
const landing = strip(read("src", "app", "(shell)", "ecs", "_components", "landing-list.tsx"));
const migration = read("supabase", "migrations", "0239a_class_month_plan_cells.sql");
const migrationFooter = read("supabase", "migrations", "0240a_class_month_plan_footer.sql");

describe("🔴 EiE 판정 — 표면 넷이 같은 근거를 본다", () => {
  it("탭은 `sheetFacesFor(isEie)`로만 선다(두 상단 바가 같은 함수를 쓴다)", () => {
    expect(chrome).toContain("export function sheetFacesFor");
    expect(monthClient).toContain("faces={sheetFacesFor(data.isEie)}");
    expect(toolbar).toContain("faces={sheetFacesFor(data.isEie)}");
  });

  it("조회는 `english_track` 컬럼(게이트가 읽어 온 값)으로 판정한다", () => {
    expect(monthQueries).toContain('const isEie = access.englishTrack === "eie"');
  });

  it("🔴 저장 액션이 게이트 뒤에서 **한 번 더** 본다(주소를 직접 쳐도 못 쓴다)", () => {
    expect(planActions).toContain("requireEcsClassAccess(input.classId, { write: true })");
    expect(planActions).toContain('gate.access.englishTrack !== "eie"');
  });

  it("🔴 인쇄도 같은 게이트 + EiE 재확인을 통과한다(인쇄는 별도 주소다)", () => {
    expect(planPrint).toContain("getClassSheetMonth(classId, monthRaw)");
    expect(planPrint).toContain("if (!res.data.isEie)");
  });

  it("🔴 반 이름으로 추측하지 않는다(이름을 고치면 분류가 조용히 뒤집힌다)", () => {
    for (const src of [chrome, monthQueries, planActions, planPrint]) {
      expect(src).not.toMatch(/class_?[Nn]ame[\s\S]{0,40}(startsWith|includes|match)/);
    }
  });

  it("🔴 저장값·주소의 보기가 `mp`여도 EiE가 아니면 달력으로 떨어진다", () => {
    expect(monthQueries).toContain("clampEcsMonthView(readEcsMonthView(");
    expect(monthPage).toContain("clampEcsMonthView(");
  });

  it("랜딩의 MP 링크도 컬럼 하나로 판정한다", () => {
    expect(landing).toContain('card.englishTrack === "eie"');
  });
});

describe("🔴 쓰기 경로는 하나뿐 — 칸·열·휴강이 같은 액션을 탄다", () => {
  it("월간 계획 저장 액션은 `saveMonthPlanCells` 하나다", () => {
    expect((planActions.match(/^export async function /gm) ?? []).length).toBe(1);
    expect(planActions).toContain("export async function saveMonthPlanCells");
  });

  it("클라의 세 동작(칸 타이핑·e-book 열·휴강)이 전부 그 액션으로 모인다", () => {
    const hook = strip(read("src", "features", "class-sheets", "components", "use-month-plan.ts"));
    expect((hook.match(/saveMonthPlanCells\(/g) ?? []).length).toBe(1);
    for (const fn of ["setCell", "setEbookColumn", "setDayOff"]) expect(hook).toContain(fn);
  });

  it("🔴 `off` 칸은 자유 텍스트가 아니다(상태 표식이라 값이 둘뿐)", () => {
    expect(planActions).toContain('new Set(["off", "open"])');
  });

  it("⚠️ 유니크가 부분 인덱스가 아니라서 upsert 추론이 성립한다([[#113]])", () => {
    expect(planActions).toContain('onConflict: "tenant_id,class_id,plan_date,col_kind"');
    expect(migration).toContain("unique (tenant_id, class_id, plan_date, col_kind)");
    expect(migration).not.toMatch(/create unique index[\s\S]*class_month_plan_cells[\s\S]*where/i);
  });

  it("⚠️ admin 클라이언트라 모든 조회·쓰기에 tenant_id가 붙는다([[#104]])", () => {
    expect(planActions).toContain('.eq("tenant_id", tenantId)');
    expect(monthQueries).toMatch(/from\("class_month_plan_cells"\)[\s\S]{0,200}?eq\("tenant_id"/);
  });
});

describe("🔴 표가 없어도 죽지 않는다([[#95]])", () => {
  it("조회는 throw 대신 상태를 돌려주고, 원인을 단정하지 않는다", () => {
    expect(monthQueries).toContain('"missing-table"');
    expect(monthQueries).toContain('"failed"');
    expect(monthQueries).toContain('mpCode === "42P01"');
  });

  it("화면은 한글 배너로 알리고 편집만 잠근다(달력·진도표는 그대로 돈다)", () => {
    expect(monthClient).toContain('data.mp.status === "missing-table"');
    expect(monthClient).toContain('canEdit={data.canEdit && data.mp.status === "ok"}');
  });

  it("저장 실패도 PostgREST 원문이 아니라 한글로 말한다(raw 코드 노출 금지)", () => {
    expect(planActions).toContain("DB 갱신 필요");
  });
});

describe("🔴 인쇄물은 학부모 문서다 — 신호가 실리지 않는다", () => {
  const paper = strip(
    read("src", "app", "(print)", "ecs", "[classId]", "month-plan", "print", "month-plan-paper.tsx"),
  );
  it("대조·경고·작성률을 만들지도 그리지도 않는다", () => {
    for (const banned of [
      "mpCompareDay",
      "mpSummarize",
      "mpIsWarning",
      "MP_STATUS_LABEL",
      "미작성",
      "교재 다름",
    ]) {
      expect(paper).not.toContain(banned);
    }
    expect(planPrint).not.toContain("mpCompareDay");
  });

  it("머리말·꼬리말은 학원설정이 단일 소스다(문구를 코드에 박지 않는다)", () => {
    expect(planChrome).toContain("resolveMonthPlanTexts(subject)");
    expect(paper).toContain("texts.bookLegend");
    expect(paper).toContain("monthPlanLines(texts.notices)");
  });

  it("꼬리말 기간은 `operating_periods` 해석값에서 온다(문자열 하드코딩 금지)", () => {
    expect(planChrome).toContain("getPeriodWindow(");
    expect(planChrome).toContain("mpPeriodRangeLabel(period)");
  });

  it("🔴 화면과 인쇄가 **같은 껍데기 함수**를 쓴다(두 문서가 갈리지 않게)", () => {
    // 인쇄물과 계획 화면이 각자 조회하면 언젠가 문구·강사·기간이 어긋난다.
    expect(planPrint).toContain("getMonthPlanChrome(");
    expect(monthPage).toContain("getMonthPlanChrome(");
    expect(planChrome).toContain("export async function getMonthPlanChrome");
    // 화면은 서버가 준 값만 그린다 — 자기가 다시 해석하지 않는다.
    expect(planView).not.toContain("resolveMonthPlanTexts");
  });

  it("🔴 계획 화면도 시트 문서 모양을 그린다(머리말·안내·범례·꼬리말)", () => {
    expect(planView).toContain("mpDocTitle(");
    expect(planView).toContain("mpSessionLine(");
    expect(planView).toContain("monthPlanLines(chrome.texts.notices)");
    expect(planView).toContain("chrome.texts.bookLegend");
    expect(planView).toContain("defaultMonthPlanFooter(chrome.texts)");
  });

  it("🔴 꼬리말은 **반이 적은 것이 이긴다**(0240a) — 화면·인쇄가 같은 규칙", () => {
    // 학원설정 문구는 **기본값**일 뿐이고, 반이 고쳐 적었으면 그 값이 나가야 한다.
    for (const src of [planView, paper]) {
      expect(src).toContain("mpResolveFooter(");
      expect(src).toContain("defaultMonthPlanFooter(");
    }
    // 저장 경로를 새로 만들지 않는다 — 같은 액션·같은 표(col_kind='footer').
    expect(planActions).toContain('"footer"');
    expect(migrationFooter).toContain("'footer'");
    // 🔴 세션 줄은 편집 대상이 아니다(날짜라 글자로 굳히면 거짓이 된다).
    expect(planTexts).not.toContain("mpSessionLine");
    expect(planTexts).toContain("export function defaultMonthPlanFooter");
  });

  it("🔴 열 라벨은 **주 블록마다** 다시 그린다(시트 그대로) — 화면·인쇄 둘 다", () => {
    // 그 주에 수업이 없는 요일의 라벨이 그 주에서만 사라지는 모양이 여기서 나온다.
    // 라벨이 thead에 한 번만 있으면 그 주만 비울 길이 없다.
    for (const src of [planView, paper]) {
      expect(src).toContain("MP_COLUMN_LABEL[col]");
      // 주 루프(`weeks.map`) 안에서 라벨을 그린다 — thead에는 요일만 선다.
      const head = src.slice(src.indexOf("<thead>"), src.indexOf("</thead>"));
      expect(head).not.toContain("MP_COLUMN_LABEL");
    }
  });

  it("🔴 문서 기본 문구가 비어 있지 않다(비면 그 블록이 인쇄에서 통째로 사라진다)", () => {
    // 2026-09-01 원본 시트에서 옮긴 값 — 되돌려 비우면 학부모 문서에서 안내·Prep이 조용히 빠진다.
    for (const key of ["bookLegend", "notices", "slogan", "prepTitle", "prepNotes"]) {
      expect(planTexts).toContain(`${key}:`);
    }
    expect(planTexts).toContain("Prep 시간에 마무리 못한 온라인 학습은");
    expect(planTexts).toContain("발음은 정확하게!");
    expect(planTexts).toContain("Prep 안내");
    expect(planTexts).not.toContain('notices: ""');
    expect(planTexts).not.toContain('prepTitle: ""');
    expect(planTexts).not.toContain('prepNotes: ""');
  });
});

describe("🔴 휴일 판정은 MP만 들인다", () => {
  it("학원설정이 단일 소스다(`buildHolidayMap`)", () => {
    expect(monthQueries).toContain("buildHolidayMap(settings.operations.holidays)");
  });

  it("⚠️ 캘린더 탭의 내장 법정공휴일 표를 쓰지 않는다(학원 휴원일이 아니다)", () => {
    for (const src of [monthQueries, planPrint, planChrome, planView, monthClient]) {
      expect(src).not.toContain("features/calendar/holidays");
    }
  });

  /**
   * ⚠️ 이 자리엔 원래 "주간 시트·오늘 보드는 휴일을 **안** 본다"는 가드가 있었다 — 같은 날 오후
   *    원장 지시(*"ecs/mcs 휴일참조 시켜"* → *"대신 입력은 가능하도록 해줘 출석부처럼"*)로 **뒤집혔다**.
   *    지금 잠글 것은 "안 본다"가 아니라 **"보되 같은 자료를 본다"**이다(규약은 [[holiday.ts]]).
   */
  it("🔴 주간 시트·오늘 보드도 **학원설정 하나만** 본다(내장 법정공휴일 표 금지)", () => {
    for (const f of ["queries.ts", "today.ts"]) {
      const src = strip(read("src", "features", "class-sheets", "server", f));
      expect(src).toContain("buildHolidayMap(settings.operations.holidays)");
      expect(src).not.toContain("features/calendar/holidays");
    }
  });
});

/**
 * 원장 2026-09-02 두 건 — *"반이 너무 길어서 칸 밖으로 나감. `(September 2026)`은 다음줄로 처리하고
 * 글씨 크기 조정 필요함"* · *"휴강에 대해 셀을 회색처리하는 등 더 적극적인 휴강 표기 필요함"*.
 *
 * 둘 다 **화면(계획 보기)과 인쇄물이 같아야** 뜻이 산다 — 한쪽만 고치면 같은 달이 두 문서에서
 * 다르게 보인다. 그래서 두 파일이 **같은 함수·같은 스타일**을 통과하는지를 여기서 잠근다.
 */
describe("🔴 제목은 두 줄 + 길이에 따라 축소 (2026-09-02)", () => {
  const paper = strip(
    read("src", "app", "(print)", "ecs", "[classId]", "month-plan", "print", "month-plan-paper.tsx"),
  );
  const fit = strip(read("src", "features", "class-sheets", "lib", "month-plan-title-fit.ts"));

  it("화면·인쇄가 같은 두 함수를 쓴다(제목 조립 · 크기 사다리)", () => {
    for (const src of [planView, paper]) {
      expect(src).toContain("mpTitleLines(");
      expect(src).toContain("mpFitTitle(");
      expect(src).toContain("mpTitleBoxPx(");
      expect(src).toContain("mpTitleNameStyle(");
      expect(src).toContain("mpTitlePeriodStyle(");
    }
  });

  it("🔴 축소는 순수 함수 한 곳에서만 — 화면 파일에 pt 분기를 흩지 않는다", () => {
    for (const src of [planView, paper]) {
      expect(src).not.toMatch(/\d+pt/);
    }
    expect(fit).toContain("MP_TITLE_NAME_STEPS_PT");
  });

  it("⚠️ 한 줄 문자열은 남는다(툴팁·문서 제목) — 다만 본문은 두 줄로 그린다", () => {
    for (const src of [planView, paper]) {
      expect(src).toContain("title={mpDocTitle(");
      // 두 줄이므로 제목 칸은 세로 배치다(가로 한 줄로 되돌리면 다시 넘친다).
      expect(src).toContain("flex flex-col");
    }
  });
});

describe("🔴 휴강은 감추지 않고 회색으로 표시한다 (2026-09-02)", () => {
  const paper = strip(
    read("src", "app", "(print)", "ecs", "[classId]", "month-plan", "print", "month-plan-paper.tsx"),
  );
  const style = strip(read("src", "features", "class-sheets", "lib", "month-plan-sheet-style.ts"));

  it("화면·인쇄가 같은 판정(`mpDayKindOf`)과 같은 스타일을 쓴다", () => {
    for (const src of [planView, paper]) {
      expect(src).toContain("mpDayKindOf(");
      expect(src).toContain("mpOffBandCellStyle()");
      expect(src).toContain("mpOffValueCellStyle()");
      expect(src).toContain("mpOffLabel(");
    }
  });

  it("🔴 판정 근거는 여전히 `mpDayIsOff` 하나다(새 판정을 만들지 않았다)", () => {
    for (const src of [planView, paper]) {
      expect(src).toContain("mpDayIsOff(");
      // 날짜를 직접 비교해 휴일을 다시 정하는 코드가 없어야 한다.
      expect(src).not.toContain("features/calendar/holidays");
    }
  });

  it("🔴 회색 값을 컴포넌트에 다시 적지 않는다(시트 서식 단일 소스)", () => {
    for (const src of [planView, paper]) {
      for (const hex of ["#d9d9d9", "#5a5a5a"]) expect(src).not.toContain(hex);
    }
    expect(style).toContain("offBg:");
    expect(style).toContain("offFg:");
  });

  it("🔴 인쇄물의 격자 범위가 화면과 같아졌다 — 휴강이라고 주·요일을 빼지 않는다", () => {
    // 그전엔 인쇄만 `liveOn`(휴강 제외)으로 걸러서, 화면엔 있는 주가 인쇄물에서 통째로 사라졌다.
    expect(paper).toContain("month.weeks.filter((w) => w.dates.some(hasClassOn))");
    expect(paper).not.toContain("liveOn");
  });

  it("⚠️ 그래도 **전부 휴강인 달**은 표 대신 그 사실을 적는다", () => {
    expect(paper).toContain("mpActiveDates(allDates, hasClassOn, isOff)");
    expect(paper).toContain("전부 휴강");
  });

  it("🔴 저장 경로는 한 줄도 안 건드렸다(회색은 표시일 뿐)", () => {
    // 휴강 표기 때문에 새 액션·새 col_kind가 생기면 안 된다.
    expect((planActions.match(/^export async function /gm) ?? []).length).toBe(1);
    expect(planActions).not.toContain("mpOffLabel");
    expect(planActions).not.toContain("mpDayKindOf");
  });
});
