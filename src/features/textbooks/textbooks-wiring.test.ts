import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS, MENU_KEYS, MENU_LABEL, menuKeyForPath } from "@/lib/permissions";
import { NAV_GROUPS, SUBTABS_BY_MENU, navItemByKey } from "@/lib/navigation";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { routeWindowSize } from "@/components/workspace/window-geometry";
import { resolveTextbookTab, textbookFaces, TEXTBOOK_FACE_DEFS } from "./faces";

/**
 * 교재목록 **배선 가드** — 새 메뉴가 반쯤만 배선되는 것을 막는다(`inventory-wiring.test.ts` 선례).
 *
 * 🔑 여기서 잡는 것은 "보이는데 권한이 없다" / "권한은 있는데 길이 없다" / "라벨이 영문으로 샌다"
 *    같은, 타입체크를 통과하면서 화면에서만 드러나는 반쪽 배선이다.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("교재목록 — 메뉴 배선", () => {
  it("권한 키가 등록돼 있다", () => {
    expect(MENU_KEYS).toContain("textbooks");
    expect(MENU_ACCESS.textbooks).toBeDefined();
  });

  it("한글 라벨이 있다 — 없으면 권한 편집기·감사로그에 영문 키가 그대로 샌다", () => {
    expect(MENU_LABEL.textbooks).toBe("교재목록");
  });

  it("경로가 메뉴 키로 풀린다 — 면은 `?tab=`이라 경로가 하나다", () => {
    expect(menuKeyForPath("/textbooks")).toBe("textbooks");
    // ⚠️ 이 함수는 **pathname**을 받는다(쿼리는 안 들어온다) — 면이 늘어도 첫 세그먼트는 그대로다.
    expect(menuKeyForPath("/textbooks/anything")).toBe("textbooks");
  });

  it("사이드바 '수업' 그룹에 서 있다", () => {
    const group = NAV_GROUPS.find((g) => g.label === "수업");
    expect(group?.items.some((i) => i.menuKey === "textbooks" && i.href === "/textbooks")).toBe(true);
  });

  it("아이콘이 있고 다른 책 메뉴와 겹치지 않는다", () => {
    expect(MENU_ICON.textbooks).toBeTruthy();
    // 🔴 2026-09-08부터 뜻이 다르면 그림도 다르다 — 수업목록(book)·교재 요청(bookMarked)과 나란히 선다.
    expect(MENU_ICON.textbooks).not.toBe(MENU_ICON.classes);
    expect(MENU_ICON.textbooks).not.toBe(MENU_ICON.textbook_requests);
  });

  it("창 크기가 지정돼 있다 — 기본값(480)이면 표가 접힌다", () => {
    expect(routeWindowSize("textbooks")?.w ?? 0).toBeGreaterThanOrEqual(1000);
  });

  it("사이드바 하부탭은 두지 않는다 — 면은 화면 안 탭바(faces.ts)로만 오간다", () => {
    expect(SUBTABS_BY_MENU.textbooks).toBeUndefined();
  });

  it("메뉴 허브에 한 줄이 있다", () => {
    expect(read("src", "lib", "menu-hub.ts")).toContain('fromMenu("textbooks"');
  });

  it("사이드바 라벨과 페이지 제목 접두가 같다 — 창 타이틀바가 문서 제목을 읽는다", () => {
    expect(navItemByKey("textbooks")?.label).toBe("교재목록");
    expect(read("src", "app", "(shell)", "textbooks", "page.tsx")).toContain("`교재목록${TITLE_SUFFIX[tab]} — aywa`");
  });
});

describe("교재목록 — 권한 기본값", () => {
  it("사무실은 full, 강사는 readonly(고르기만) — 원장 2026-09-16", () => {
    expect(MENU_ACCESS.textbooks.master).toBe("full");
    expect(MENU_ACCESS.textbooks.admin).toBe("full");
    expect(MENU_ACCESS.textbooks.manager).toBe("full");
    // 🔴 강사가 none이면 시트에서 교재를 **고를 수도 없다**(상세·차수 조회가 이 키를 본다).
    expect(MENU_ACCESS.textbooks.teacher).toBe("readonly");
  });

  it("학생에겐 닫혀 있다", () => {
    expect(MENU_ACCESS.textbooks.student).toBe("none");
  });
});

describe("교재목록 — 면(faces)", () => {
  it("모르는 값·없음은 기본 착지(교재)로 떨어진다", () => {
    expect(resolveTextbookTab(undefined)).toBe("books");
    expect(resolveTextbookTab("nope")).toBe("books");
    expect(resolveTextbookTab("plans")).toBe("plans");
  });

  it("건수를 모르면 숫자를 안 붙인다 — 0은 '하나도 없다'는 거짓말이 된다", () => {
    const unknown = textbookFaces({ books: null });
    expect(unknown.find((f) => f.key === "books")?.label).toBe("교재");
    const known = textbookFaces({ books: 12 });
    expect(known.find((f) => f.key === "books")?.label).toBe("교재 12");
  });

  it("기본 착지 면의 href엔 ?tab이 없다(주소가 짧게 남는다)", () => {
    expect(TEXTBOOK_FACE_DEFS[0]!.href).toBe("/textbooks");
  });
});

describe("교재목록 — 게이트", () => {
  const access = read("src", "features", "textbooks", "server", "access.ts");

  it("쓰기 게이트는 canWriteTenant다 — canAccess는 readonly를 통과시킨다", () => {
    expect(access).toMatch(/canWriteTenant\(\s*user\.systemRole,\s*"textbooks"\s*\)/);
    expect(access).not.toContain("canAccessTenant(");
  });

  it("교재·차수를 바꾸는 액션은 전부 쓰기 게이트를 지난다", () => {
    const actions = read("src", "features", "textbooks", "server", "actions.ts");
    const exported = actions.match(/export async function (\w+)/g) ?? [];
    // 읽기 전용 진입점(loadTextbookDetail)은 메뉴 접근 게이트를 쓴다 — 나머지는 쓰기 게이트.
    const writeExports = exported.filter((m) => !m.endsWith("loadTextbookDetail"));
    const gateCalls = actions.match(/await requireTextbookWrite\(\)/g) ?? [];
    expect(gateCalls.length).toBe(writeExports.length);
    expect(actions).toContain("canAccessTenant(user.systemRole, \"textbooks\")");
  });

  it("표지 액션도 전부 쓰기 게이트를 지난다", () => {
    const cover = read("src", "features", "textbooks", "server", "cover-actions.ts");
    const exported = cover.match(/export async function (\w+)/g) ?? [];
    const gateCalls = cover.match(/await requireTextbookWrite\(\)/g) ?? [];
    expect(exported.length).toBeGreaterThan(0);
    expect(gateCalls.length).toBe(exported.length);
  });

  it("🔴 반 배정·기입은 **ECS 게이트**를 탄다 — 교재 마스터 권한이 아니다", () => {
    const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
    expect(plan).toContain('requireEcsClassAccess');
    expect(plan).toMatch(/requireEcsClassAccess\([^)]*\{\s*write:\s*true\s*\}/);
    // 교재 마스터 쓰기 게이트를 여기 쓰면 담임 강사가 자기 반에 교재를 못 태운다.
    expect(plan).not.toContain("requireTextbookWrite");
  });

  it("모든 서버 쿼리·액션이 tenant_id로 좁힌다 — admin 클라이언트는 RLS를 우회한다", () => {
    for (const file of ["queries.ts", "actions.ts", "cover-actions.ts", "plan-actions.ts"]) {
      const src = read("src", "features", "textbooks", "server", file);
      const froms = src.match(/\.from\("(textbooks|textbook_lessons|class_textbook_plans)"\)/g) ?? [];
      if (froms.length === 0) continue;
      expect(src.includes('.eq("tenant_id"') || src.includes("tenant_id: ")).toBe(true);
    }
  });
});

describe("교재목록 — fail-soft (0266a 미적용)", () => {
  it("표 없음과 그냥 실패를 다른 사실로 가른다", () => {
    const access = read("src", "features", "textbooks", "server", "access.ts");
    expect(access).toContain("42P01");
    expect(access).toContain("PGRST205");
    const banner = read("src", "app", "(shell)", "textbooks", "_components", "not-ready-banner.tsx");
    expect(banner).toContain("missing-table");
    expect(banner).toContain("failed");
    expect(banner).toContain("0266a");
  });

  it("🔴 ECS 시트의 교재 제안은 절대 throw하지 않는다 — 영어 강사 전원이 매일 여는 화면이다", () => {
    const opts = read("src", "features", "textbooks", "server", "ecs-options.ts");
    expect(opts).toContain("catch");
    expect(opts).toContain("return [];");
  });
});

/**
 * 🔴 **교시는 (요일, 시각)으로 고른다** — 원장 제보 2026-09-18(*"추민아 선생님이 배정해도 송지혜
 *    선생님까지 다같이 배정됌"*). 같은 시각의 담당이 요일마다 갈리는 조합이 실측 **60개(반×시각)**라
 *    시각만으로 묶으면 남의 칸에 차수가 내려앉는다. 되돌리는 길은 줄을 하나씩 지우는 것뿐이다.
 */
describe("교재 배정 — 칸은 요일까지 고른다", () => {
  it("칩을 (시각, 담당)으로 묶는다 — 시각만으로 묶지 않는다", () => {
    const q = read("src", "features", "textbooks", "server", "queries.ts");
    expect(q).toContain("`${start}|${label}`");
    // 담당 이름은 시트 달력과 같은 해석기를 탄다(닉네임 `Jane` → `추민아`).
    expect(q).toContain("resolveTeacherLabel");
  });

  it("배분 함수가 요일을 보고 거른다", () => {
    const sched = read("src", "features", "textbooks", "lesson-schedule.ts");
    expect(sched).toContain("slotsOfPicks(all, dowKeyOf(date), picked)");
    // 🔴 옛 이름으로 되돌아가면(시각만) 이 가드가 먼저 깨진다.
    expect(sched).not.toContain("slotsOfStarts");
  });

  it("창이 칩 키로 고르고, 서버엔 칸 목록을 넘긴다", () => {
    const dlg = read("src", "features", "class-sheets", "components", "textbook-fill-dialog.tsx");
    expect(dlg).toContain("picked.has(s.key)");
    expect(dlg).toContain("slotPicks: pickedSlots");
    // 🔴 매 렌더 새 배열이면 자동 미리보기가 무한히 돈다.
    expect(dlg).toContain("useMemo(");
  });

  it("저장 칸 이름이 SQL과 앱에서 같다", () => {
    const sql = read("supabase", "migrations", "0268a_class_textbook_plan_slots.sql");
    expect(sql).toContain("slot_picks text[]");
    const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
    expect(plan).toContain("slot_picks: slotPicks");
    expect(plan).not.toContain("slot_starts");
  });
});

/**
 * 🔴 **한 배정엔 한 담당만** — 원장 2026-09-18(*"지금 남들 + 자기수업 다 넣을수있자나 교사가 다르면
 *    교재배정을 새로해야지"*). 섞으면 차수가 두 선생님 칸에 **번갈아** 들어가 둘 다 제 진도를 못 읽는다.
 */
describe("교재 배정 — 한 배정엔 한 담당만", () => {
  it("창은 다른 담당을 고르면 그쪽으로 갈아탄다(섞이지 않는다)", () => {
    const dlg = read("src", "features", "class-sheets", "components", "textbook-fill-dialog.tsx");
    expect(dlg).toContain("if (otherTeacher) return new Set([s.key]);");
    // 규칙을 말로도 적는다 — 칩이 흐려진 이유를 사람이 알 수 있어야 한다.
    expect(dlg).toContain("fill.slots.oneTeacher");
  });

  it("🔴 서버가 다시 센다 — 화면 조건은 게이트가 아니다([[#77]])", () => {
    const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
    expect(plan).toContain("labels.size > 1");
    // 부원장/Yoojin이 한 사람이라 정규화한 뒤에 센다(안 그러면 멀쩡한 배정이 거절된다).
    expect(plan).toContain("canonicalSlotTeacherLabel");
  });
});

/**
 * 🔴 **월간계획과 실제는 다른 물건이다** — 원장 2026-09-22(*"영어강사시트 실제(강사가 실제나간 진도)와
 *    월간계획 이렇게 나눠서 쓰고싶음 … 월간계획에서 교재배정을 해놓고 그걸 각자 월간계획에서 가저오기 해서
 *    실제수업에서 변동사항이 있으면 변경 후 사용"*).
 *    계획은 **배정에서 계산**하고(표 신설 없음), 실제로 들어가는 길은 [가져오기] 하나뿐이다.
 */
describe("교재 배정 — 계획과 실제를 가른다", () => {
  const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
  const monthPlan = read("src", "features", "textbooks", "server", "month-plan.ts");

  it("🔴 배정은 실제 칸에 한 줄도 쓰지 않는다 — 기입 RPC를 부르지 않는다", () => {
    const body = plan.slice(plan.indexOf("export async function applyTextbookFill"), plan.indexOf("// ── 가져오기"));
    // ⚠️ **호출만** 본다 — 왜 그런가를 적은 주석에도 그 이름이 나온다(가드가 설명을 결과로 오인하면 안 된다).
    expect(body).not.toContain("await applyLoaded(");
    expect(body).not.toContain(`rpc("ecs_apply_textbook_lessons"`);
    // 대신 배정을 저장한다(그게 곧 월간계획이다).
    expect(body).toContain("saveClassTextbookPlan");
  });

  it("🔴 월간계획은 **저장하지 않는다** — 배정에서 계산하는 읽기 전용이다", () => {
    for (const write of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(monthPlan).not.toContain(write);
    }
    // 배분 규칙은 순수 함수 한 곳을 그대로 탄다(미리보기·계획·가져오기가 같은 답을 내야 한다).
    expect(monthPlan).toContain("buildLessonSchedule");
  });

  it("계획이 실제로 들어가는 길은 [가져오기] 하나뿐이다", () => {
    expect(plan).toContain("export async function importPlannedSlot");
    const api = read("src", "features", "class-sheets", "components", "plan-api.ts");
    expect(api).toContain("importPlannedSlot");
    const table = read("src", "features", "class-sheets", "components", "plan-table.tsx");
    expect(table).toContain("plan.fromPlan");
  });

  it("🔴 시트가 못 읽어도 죽지 않는다 — 0266a 미적용이면 빈 계획으로 돈다", () => {
    expect(monthPlan).toContain("missing-table");
    expect(monthPlan).not.toContain("throw ");
  });
});
