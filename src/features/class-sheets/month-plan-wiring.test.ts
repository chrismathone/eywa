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
const monthPage = strip(read("src", "app", "(shell)", "ecs", "[classId]", "month", "page.tsx"));
const monthClient = strip(read("src", "features", "class-sheets", "components", "month-client.tsx"));
const toolbar = strip(read("src", "features", "class-sheets", "components", "sheet-toolbar.tsx"));
const landing = strip(read("src", "app", "(shell)", "ecs", "_components", "landing-list.tsx"));
const migration = read("supabase", "migrations", "0239a_class_month_plan_cells.sql");

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
    expect(planPrint).toContain("resolveMonthPlanTexts(subject)");
    expect(paper).toContain("texts.bookLegend");
    expect(paper).toContain("monthPlanLines(texts.notices)");
  });

  it("꼬리말 기간은 `operating_periods` 해석값에서 온다(문자열 하드코딩 금지)", () => {
    expect(planPrint).toContain("getPeriodWindow(");
    expect(planPrint).toContain("mpPeriodRangeLabel(period)");
  });
});

describe("🔴 휴일 판정은 MP만 들인다", () => {
  it("학원설정이 단일 소스다(`buildHolidayMap`)", () => {
    expect(monthQueries).toContain("buildHolidayMap(settings.operations.holidays)");
  });

  it("⚠️ 캘린더 탭의 내장 법정공휴일 표를 쓰지 않는다(학원 휴원일이 아니다)", () => {
    for (const src of [monthQueries, planPrint, monthClient]) {
      expect(src).not.toContain("features/calendar/holidays");
    }
  });

  it("⚠️ 주간 시트·오늘 보드는 휴일을 여전히 안 본다(작성률 분모가 조용히 바뀌지 않게)", () => {
    for (const f of ["queries.ts", "today.ts"]) {
      const src = strip(read("src", "features", "class-sheets", "server", f));
      expect(src).not.toContain("buildHolidayMap");
    }
  });
});
