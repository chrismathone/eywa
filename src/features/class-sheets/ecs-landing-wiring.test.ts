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

  it("🔴 내 이름이 아닌 이름을 '내 이름' 자리에 적지 않는다(다른 강사 뷰·겸직)", () => {
    expect(page).toContain("id === me.id");
  });

  it("목록이 내 역할로 묶는다 — 라벨은 사전 키(영어 화면이 따라온다)", () => {
    expect(list).toContain("groupLandingByMyRole(cards, viewerTeacherId)");
    expect(list).toContain("MY_ROLE_LABEL[g.key]");
    expect(list).toContain("sheetT(lang,");
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
