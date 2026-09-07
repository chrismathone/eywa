/**
 * ECS 랜딩·오늘 면 배선 가드 — 원장 지시 2026-09-05 세 건.
 *  ① 시트의 '목록'은 **주간 시트 상태**로 돌아간다(맨 `/ecs`면 강사는 '오늘'로 떨어진다).
 *  ② 강사 본인 화면은 **내 이름 + 담임/부담임**으로 묶인다(종전엔 남의 이름으로만 묶였다).
 *  ③ 오늘 면 반 순서를 **드래그로** 바꾸고 **계정에** 저장한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...seg: string[]) => readFileSync(join(process.cwd(), "src", ...seg), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("① '목록' 버튼은 온 곳(주간 시트)으로 돌아간다", () => {
  it("주간 시트는 보던 주까지 싣는다", () => {
    const src = codeOnly(read("features", "class-sheets", "components", "sheet-toolbar.tsx"));
    expect(src).toContain("listHref={`/ecs?view=week&week=${data.weekMonday}`}");
  });

  it("월간 뷰도 주간 면으로 — 어느 주로 갈지는 '주간' 전환과 **같은 판정**을 재사용한다", () => {
    const src = codeOnly(read("features", "class-sheets", "components", "month-client.tsx"));
    expect(src).toContain("listHref={`/ecs?view=week&week=${weekMonday}`}");
    expect(src).toContain("weekForMonth("); // 두 벌로 적으면 서로 다른 주로 간다
  });
});

describe("② 강사 본인 화면 = 내 이름 + 담임/부담임", () => {
  const page = codeOnly(read("app", "(shell)", "ecs", "page.tsx"));
  const list = codeOnly(read("app", "(shell)", "ecs", "_components", "landing-list.tsx"));

  it("스코프가 있을 때만 내 id·이름을 넘긴다(사무실은 종전 담임별 묶음)", () => {
    expect(page).toContain("viewerTeacherId={viewer.id}");
    expect(page).toContain("viewerName={viewer.name}");
    expect(page).toMatch(/const viewer[\s\S]{0,80}scoped/);
  });

  it("🔴 '다른 강사 뷰'에서도 **그 강사의 이름**을 적는다 — 그 뷰는 '그 사람이 보는 화면 그대로'다", () => {
    expect(page).toContain("target?.displayName");
  });

  it("목록이 내 역할로 묶는다 — 라벨은 사전 키(영어 화면이 따라온다)", () => {
    expect(list).toContain("groupLandingByMyRole(cards, viewerTeacherId)");
    expect(list).toContain("MY_ROLE_LABEL[g.key]");
    expect(list).toContain("sheetT(lang,");
  });

  it("🔴 흐름이 **둘 다** 배선된다 — 좌우 분단과 단일 흐름", () => {
    // EiE가 0개이거나 프로그램 필터를 켜면 좌우로 안 가른다(단일 흐름). 한쪽만 배선하면
    // 바로 그 사람들에게만 옛 담임별 묶음이 남는다(2026-09-05 실제로 그랬다).
    const calls = list.split("<TeacherGroupFlow").length - 1;
    expect(calls).toBe(2);
    expect(list.split("viewerTeacherId={viewerTeacherId}").length - 1).toBe(2);
  });
});

describe("③ 오늘 면 반 순서 — 드래그 + 계정 저장", () => {
  const page = codeOnly(read("app", "(shell)", "ecs", "page.tsx"));
  const list = codeOnly(read("features", "class-sheets", "components", "today-order-list.tsx"));

  it("🔴 개인 순서가 **기본(첫 교시) 정렬 뒤에** 적용된다", () => {
    const iSort = page.indexOf("firstVisibleTodaySlot");
    const iApply = page.indexOf("sheets = applyTodayOrder(");
    expect(iSort).toBeGreaterThan(-1);
    expect(iApply).toBeGreaterThan(iSort);
  });

  it("요약 카드도 같은 순서 — 보기를 바꿨다고 차례가 달라지지 않는다", () => {
    expect(page).toContain("cards: applyTodayOrder(todayRes.cards, todayRes.todayOrder)");
  });

  it("🔴 카드는 서버가 그린 그대로 넘어간다 — 클라가 시트를 다시 그리지 않는다", () => {
    // 다시 그리면 편집기·저널·presence가 재마운트돼 입력 중이던 값이 날아간다.
    expect(page).toContain("<TodayOrderList");
    expect(list).not.toContain("SheetClient");
    expect(list).toContain("node: ReactNode");
  });

  it("🔴 손잡이로만 끈다 — 카드 전체를 드래그로 두면 표 안 조작을 삼킨다", () => {
    const at = list.indexOf("{...listeners}");
    expect(at).toBeGreaterThan(-1);
    // listeners가 붙은 자리는 button이다(그 앞 200자 안에 <button 이 있다).
    expect(list.slice(Math.max(0, at - 400), at)).toContain("<button");
    expect(list).toContain("touch-none"); // 없으면 터치에서 스크롤이 드래그를 삼킨다
  });

  it("저장 실패면 되돌린다 — 저장 안 된 순서를 화면에 남기지 않는다", () => {
    expect(list).toContain("setIds(before)");
  });

  it("저장은 계정에(ui_prefs) — localStorage 아님", () => {
    const actions = codeOnly(read("features", "class-sheets", "server", "actions.ts"));
    expect(actions).toContain("export async function setMyEcsTodayOrder(");
    expect(actions).toContain("mergeTodayOrder(saved, next)"); // 다른 날 순서를 지우지 않는다
    expect(list).not.toContain("localStorage");
  });
});

describe("④ '다른 강사 뷰'는 **그 사람 뷰와 동일** — 순서도 그 사람 것, 드래그는 없음", () => {
  const page = codeOnly(read("app", "(shell)", "ecs", "page.tsx"));
  const today = codeOnly(read("features", "class-sheets", "server", "today.ts"));
  const landing = codeOnly(read("features", "class-sheets", "server", "queries.ts"));

  it("🔴 순서는 **대상 강사가 저장한 값**을 읽는다", () => {
    // 보는 사람(관리자) 값을 쓰면 남의 화면을 내 취향으로 재배열해 놓고 "그 사람 화면"이라 부르게 된다.
    for (const [name, src] of [["today", today], ["landing", landing]] as const) {
      expect(src, name).toContain("viewAsTeacher()");
      expect(src, name).toContain("orderOwner");
    }
  });

  it("🔴 열람 전용이면 드래그 장치를 **아예 안 만든다**", () => {
    expect(page).toContain("const canReorder = viewAs === null;");
    for (const seg of [
      ["features", "class-sheets", "components", "today-order-list.tsx"],
      ["features", "class-sheets", "components", "landing-order-rows.tsx"],
    ]) {
      const src = codeOnly(read(...seg));
      // 손잡이만 감추고 DndContext를 남기면 키보드 센서로는 여전히 옮겨져 저장까지 간다.
      expect(src, seg.join("/")).toContain("if (!canReorder) {");
      const at = src.indexOf("if (!canReorder) {");
      expect(src.indexOf("<DndContext"), seg.join("/")).toBeGreaterThan(at);
    }
  });

  it("🔴 서버도 거절한다 — 화면에서만 잠그면 액션은 그대로 부를 수 있다([[#77]])", () => {
    const actions = codeOnly(read("features", "class-sheets", "server", "actions.ts"));
    for (const fn of ["setMyEcsTodayOrder", "setMyEcsLandingOrder"]) {
      const at = actions.indexOf(`export async function ${fn}(`);
      expect(at, fn).toBeGreaterThan(-1);
      expect(actions.slice(at, at + 400), fn).toContain("readonlyTeacherViewError()");
    }
  });

  it("두 면 모두 canReorder를 받는다", () => {
    expect(page).toContain("canReorder={canReorder}");
    expect(page.split("canReorder={canReorder}").length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe("⑤ 랜딩 목록 순서 — 묶음 안에서만", () => {
  const list = codeOnly(read("app", "(shell)", "ecs", "_components", "landing-list.tsx"));

  it("묶음마다 목록을 만든다 — 묶음을 넘나드는 이동은 구조로 막힌다", () => {
    expect(list).toContain("<LandingOrderRows");
    expect(list).toContain("applyTodayOrder(g.cards, landingOrder)");
  });

  it("🔴 저장 키가 오늘 면과 다르다 — 두 화면은 같은 반을 다른 축으로 세운다", () => {
    const prefs = codeOnly(read("features", "class-sheets", "view-prefs.ts"));
    expect(prefs).toContain("readEcsLandingOrder");
    expect(prefs).toContain("landingOrder");
    expect(prefs).toContain("todayOrder");
    const actions = codeOnly(read("features", "class-sheets", "server", "actions.ts"));
    expect(actions).toContain("setMyEcsLandingOrder");
    expect(actions).toContain("landingOrder:");
    expect(actions).toContain("todayOrder:");
  });

  it("🔴 이름이 묶음 머리(15px)보다 크고 맨 앞이다 — 원장 2026-09-05 '20% 키워줘·반 9개는 이름 뒤로'", () => {
    expect(list).toContain('<h2 className="text-foreground text-[18px] font-extrabold">{viewerName}</h2>');
    const iName = list.indexOf("{viewerName}</h2>");
    const iCount = list.indexOf("{s.classes}</span>개", iName);
    expect(iName).toBeGreaterThan(-1);
    expect(iCount).toBeGreaterThan(iName); // 반 N개가 이름 뒤
  });
});
