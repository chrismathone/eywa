import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS, MENU_KEYS, MENU_LABEL, menuKeyForPath } from "@/lib/permissions";
import { NAV_GROUPS, SUBTABS_BY_MENU, navItemByKey } from "@/lib/navigation";
import { MENU_ICON } from "@/components/icons/aywa-icons";
import { routeWindowSize } from "@/components/workspace/window-geometry";
import { resolveTextbookTab, textbookFaces, TEXTBOOK_FACE_DEFS } from "./faces";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
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
    expect(read("src", "app", "(shell)", "textbooks", "page.tsx")).toContain("`교재목록${TITLE_SUFFIX[tab]} — 에이와`");
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
    const sql = readMigration("0268a_class_textbook_plan_slots.sql");
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
    expect(dlg).toContain("setPicked(new Set([s.key]));");
    // 갈아탈 때 앞 담당의 자리(요일·차수)도 함께 비운다 — 남으면 두 담당이 한 배정에 섞인다.
    expect(dlg).toContain("setSpots(new Set());");
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

  it("🔴 배정 = 계획 + 가져오기 한 번에(원장 2026-10-22) — 실제 쓰기는 가져오기와 **같은 함수**만", () => {
    const body = plan.slice(plan.indexOf("export async function applyTextbookFill"), plan.indexOf("// ── 가져오기"));
    // 배정을 저장한다(그게 곧 월간계획이다) → 그 배정만 골라 가져오기와 같은 writer로 실제에 넣는다.
    expect(body).toContain("saveClassTextbookPlan");
    expect(body).toContain("planId: saved.id");
    expect(body).toContain("await writePlannedCells(");
    // ⚠️ 직접 RPC·옛 기입 경로로 따로 쓰지 않는다(두 벌이면 같은 칸이 길마다 다르게 들어간다).
    expect(body).not.toContain("await applyLoaded(");
    expect(body).not.toContain(`rpc("ecs_apply_textbook_lessons"`);
    // 🔴 지난 날짜엔 안 넣는다(미리보기의 '지난 날짜' 약속).
    expect(body).toMatch(/importFrom = input\.startDate > today \? input\.startDate : today/);
    // 🔴 [월간계획 전체 가져오기]는 없앴다(원장 2026-10-22 *"없어도될듯 대신 되돌리기"*) — 되살리지 말 것.
    expect(plan).not.toContain("importPlannedRange");
  });

  it("🔴 월간계획은 **저장하지 않는다** — 배정에서 계산하는 읽기 전용이다", () => {
    for (const write of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(monthPlan).not.toContain(write);
    }
    // 배분 규칙은 순수 함수 한 곳을 그대로 탄다(미리보기·계획·가져오기가 같은 답을 내야 한다).
    const expand = read("src", "features", "textbooks", "plan-expand.ts");
    expect(expand).toContain("buildLessonSchedule");
    expect(monthPlan).toContain("expandPlans");
  });

  it("🔴 원래 계획은 미루기를 반영하지 않는다 — 일정(가져오기)만 밀린다(원장 2026-09-28)", () => {
    // 같은 함수를 두 번 — 원래 계획은 강사 표식 없이(시간표 이동이 비운 회차만 · s2_0005), 일정은 shifts로.
    expect(monthPlan).toContain("shifts: Object.keys(m.moveGaps).length > 0 ? m.moveGaps : null");
    expect(monthPlan).toContain('if (r.origin === MOVE_GAP_ORIGIN && String(r.kind) === "skip") m.moveGaps[markerKeyOfRow(r)] = "skip";');
    // s2_0005 전에도 돈다 — origin 없이 다시 읽는다([[#95]] · 칸 이름이 오류에 있을 때만).
    expect(monthPlan).toContain("withMarkerOriginCols((cols) =>");
    const markers = read("src", "features", "textbooks", "server", "shift-markers.ts");
    expect(markers).toContain("if (!isMissingOriginColumn(e)) throw e;");
  });

  it("🔴 되돌리기는 반 옮기기의 비는 회차 표식을 출처까지 되살린다 — 강사 표식으로 되살면 원래 계획이 다시 센다(리뷰 2026-10-28)", () => {
    const snap = read("src", "features", "textbooks", "server", "shift-snapshot.ts");
    expect(snap).toContain('if (kind === "skip" && m.origin === MOVE_GAP_ORIGIN) moveGaps.push(markerKeyOfRow(m));');
    expect(plan).toContain("moveGapsBefore: before.moveGaps,");
    const del = read("src", "features", "textbooks", "server", "plan-delete-lines.ts");
    expect(del).toContain('row.origin === MOVE_GAP_ORIGIN ? { moveGap: true as const } : {}');
    const core = read("src", "features", "textbooks", "server", "shift-undo-core.ts");
    expect(core).toContain("...(m.moveGap ? { origin: MOVE_GAP_ORIGIN } : {}),");
    expect(core).toContain("(m.moveGap === undefined || m.moveGap === true)");
    expect(monthPlan).toContain("expandPlans({ ...common, shifts: m.shifts })");
    // 달력의 '계획' 표식·비교 배지는 원래 계획을 본다.
    const monthQueries = read("src", "features", "class-sheets", "server", "month-queries.ts");
    expect(monthQueries).toContain("plannedBySlot: plannedRes.baselineByCell");
    // 배정이 실제에 넣는 건 일정(byCell)이다.
    const fill = plan.slice(plan.indexOf("export async function applyTextbookFill"));
    expect(fill).toContain("byCell: planned.byCell");
    expect(fill).not.toContain("baselineByCell");
  });

  it("계획이 실제로 들어가는 길은 교재 배정 하나다 — 교시 한 칸·전체 가져오기는 없앴다", () => {
    expect(plan).not.toContain("export async function importPlannedRange");
    expect(plan).not.toContain("export async function importPlannedSlot");
    const api = read("src", "features", "class-sheets", "components", "plan-api.ts");
    expect(api).not.toContain("importPlan");
    const table = read("src", "features", "class-sheets", "components", "plan-table.tsx");
    expect(table).not.toContain("plan.fromPlan");
    expect(table).toContain("PlanCompareButton");
    // 툴바의 가져오기 자리엔 되돌리기만 선다(2026-10-22).
    const month = read("src", "features", "class-sheets", "components", "month-client.tsx");
    expect(month).toContain("<ImportUndoButton");
    expect(month).not.toContain("ImportPlanButton");
  });

  it("🔴 배정이 넣은 실제는 되돌릴 수 있다 — 알림 [실행 취소] + 툴바 [되돌리기 ▾], 손대지 않은 칸만", () => {
    const button = read("src", "features", "class-sheets", "components", "import-undo-button.tsx");
    expect(button).toContain("undoPlanImport");
    expect(button).toContain("month.importUndo.menu"); // ▾ 메뉴 — 언제·무슨 교재·몇 줄을 보고 고른다
    expect(button).toContain("if (recent.length === 0) return null"); // 되돌릴 기록이 있을 때만 선다
    expect(button).toContain("recent.map("); // 최근 5건(원장 2026-10-26)
    const dialog = read("src", "features", "class-sheets", "components", "textbook-fill-dialog.tsx");
    expect(dialog).toContain("month.importUndo.action"); // 배정 알림의 [실행 취소]
    expect(dialog).toContain("undoPlanImport");
    // 쓰기가 기록을 남기고(앞 스냅숏 → 뒤 차이) 되돌리기는 같은 쓰기 게이트를 탄다.
    const writer = plan.slice(plan.indexOf("async function writePlannedCells"));
    expect(writer).toContain("snapshotPlanLines(");
    expect(writer).toContain("recordImportBatch(");
    const undo = read("src", "features", "textbooks", "server", "import-undo-actions.ts");
    expect(undo).toContain("requireEcsClassAccess(input.classId, { write: true })");
    expect(undo).toContain("planUndo(");
    // 고른 반영과 그 뒤 반영을 함께(원장 2026-10-26 최근 5건) · 배정까지 지운다(빈 칸에 계획이 다시 그려지던 문제)
    expect(undo).toContain("undoChain(");
    expect(undo).toContain("deleteClassTextbookPlan(");
    // 미룸·당김 / 배정 삭제도 같은 히스토리(원장 2026-10-26) — 기록은 서버가 남기고, 되돌리기는 알림과 같은 액션.
    expect(undo).toContain("undoLessonShift(");
    expect(undo).toContain("undoPlanDelete(");
    expect(undo).toContain("{ skipHistory: true }"); // 배정 반영을 되돌리며 지운 배정은 '삭제' 기록이 아니다
    expect(plan).toContain('meta: { kind: "shift"');
    expect(plan).toContain('kind: "delete"');
    // 알림 [되돌리기]가 히스토리 기록도 함께 '되돌림'으로 — 안 그러면 툴바 목록에 되돌린 것이 다시 뜬다.
    for (const f of ["shift-undo-actions.ts", "plan-delete-actions.ts"]) {
      expect(read("src", "features", "textbooks", "server", f)).toContain("claimHistory(");
    }
    expect(read("src", "features", "class-sheets", "components", "use-plan-handlers.ts")).toContain("r.historyId");
    expect(read("src", "features", "class-sheets", "components", "month-client.tsx")).toContain("historyId: r.historyId");
    expect(read("src", "features", "class-sheets", "components", "textbook-fill-existing.tsx")).toContain("historyId: res.historyId");
    expect(read("src", "app", "(shell)", "textbooks", "_components", "plans-face.tsx")).toContain("historyId: res.historyId");
    expect(writer).toContain("plan: input.plan ?? null");
    expect(plan.slice(plan.indexOf("export async function applyTextbookFill"))).toContain("plan: { id: saved.id, title: computed.title }");
    // 표가 없어도 가져오기·월간 화면은 산다([[#95]]).
    const batch = read("src", "features", "textbooks", "server", "import-batch.ts");
    expect(batch).toContain('"PGRST205"');
  });

  it("🔴 시트가 못 읽어도 죽지 않는다 — 0266a 미적용이면 빈 계획으로 돈다", () => {
    expect(monthPlan).toContain("missing-table");
    expect(monthPlan).not.toContain("throw ");
  });
});

/**
 * 🔴 **회차 미루기·당기기**(0282a) — 원장 2026-09-22 *"실제 에서는 수업 회차를 한주 미루거나 당기거나
 *    할수있게 하고싶음 미루면 차수 무시하고 수업내용 기입해서 쓸수있게"*.
 */
describe("교재 배정 — 회차 미루기·당기기", () => {
  const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
  const sched = read("src", "features", "textbooks", "lesson-schedule.ts");

  it("표식은 (반, 날짜, 교시) 한 칸 단위다 — 배정마다 따로 담지 않는다", () => {
    const sql = readMigration("0282a_class_lesson_shifts.sql");
    expect(sql).toContain("create table if not exists public.class_lesson_shifts");
    expect(sql).toContain("(tenant_id, class_id, plan_date, slot_start)");
    // 🔴 부분 유니크 금지([[#113]]) — 이 축으로 upsert한다(토글).
    // ⚠️ `[^;]*`로 **그 문장 안에서만** 본다 — `[\s\S]*?`면 뒤의 RLS 정책(`where schemaname = …`)까지 걸린다.
    expect(sql).not.toMatch(/create unique index[^;]*where/i);
  });

  it("🔴 미룸·당김은 **실제 진도를 한 주씩 옮긴다**(원장 2026-10-15) — 규칙은 planLessonShift 한 곳", () => {
    // 1차(2026-09-22)는 표식만 남겨 이미 가져온 칸에선 아무것도 안 움직였다 — "얼럿만 뜨고 안 밀림".
    const body = plan.slice(plan.indexOf("export async function setLessonShift"));
    expect(body).toContain("shiftActualLines(");
    const io = read("src", "features", "textbooks", "server", "shift-lines.ts");
    expect(io).toContain("planLessonShift(");
    // 평시 줄만 — 같은 칸의 내신 줄은 그 날짜에 남는다.
    expect(io).toContain('term_mode: "regular"');
    // 옮기기는 새 행 복제 → 원래 행 삭제(id를 따라 보내면 옛 주를 연 창의 편집이 엉뚱한 주에 써진다).
    expect(io).not.toMatch(/\.update\(\{\s*plan_date/);
    // 가져오기 RPC(빈 칸만 채움)를 다시 부르지 않는다 — 그게 1차 구현이 안 움직인 이유다.
    expect(body).not.toContain("ecs_apply_textbook_lessons");
  });

  it("🔴 배정 교재가 지나가는 칸은 **교재 순서로** 다시 깐다(원장 2026-10-16 — 화·금 교재 순서 꼬임)", () => {
    const body = plan.slice(plan.indexOf("export async function setLessonShift"));
    // 교재 경로가 먼저 — 같은 요일 이동이 먼저 돌면 화요일 칸만 움직여 순서가 꼬인다.
    expect(body.indexOf("shiftAlongPlans(")).toBeGreaterThan(-1);
    expect(body.indexOf("shiftAlongPlans(")).toBeLessThan(body.indexOf("shiftActualLines("));
    const relay = read("src", "features", "textbooks", "server", "shift-relay.ts");
    // 표식을 반영한 일정(월간계획과 같은 함수)이 정본 — 둘이 다른 순서를 말하지 않게.
    expect(relay).toContain("expandPlans(");
    expect(relay).toContain("placeShiftMarker(");
    // 배정 교재의 줄(고쳐 쓴 줄 포함)은 요일 이동에서 뺀다(두 번 움직이거나 요일 축으로 다시 꼬이면 안 된다).
    expect(relay).toContain("excludeIds: bookLineIds");
    expect(relay).toContain("isBookLine(l, book)");
    // 🔴 못 읽었으면 종전 방식으로 떨어뜨리지 않는다(그게 순서를 꼬던 길이다).
    expect(relay).toMatch(/status !== "ok"\) \{\s*return \{ handled: true, ok: false/);
  });

  it("🔴 같은 주의 다른 칸도 화면에 갈아 끼운다 — 한 칸짜리 화면엔 넘기지 않는다(2026-10-16 재점검)", () => {
    // 화를 누르면 그 주 금요일도 바뀐다 — 주간 시트가 누른 칸만 바꾸면 금요일이 옛 진도로 남아 보인다.
    const body = plan.slice(plan.indexOf("export async function setLessonShift"));
    expect(body).toContain("readWeekCells(");
    const handlers = read("src", "features", "class-sheets", "components", "use-plan-handlers.ts");
    expect(handlers).toContain("if (multiSlot)");
    const sheet = read("src", "features", "class-sheets", "components", "sheet-client.tsx");
    expect(sheet).toContain("multiSlot: true");
    // 🔴 SlotPlanBlock의 onSlotLines는 날짜·교시를 안 보고 자기 칸을 통째로 바꾼다 — 넘기면 남의 칸이 그려진다.
    const block = read("src", "features", "class-sheets", "components", "slot-plan-block.tsx");
    expect(block).not.toContain("multiSlot");
    // 🔴 지우는 건 옛 일정이 그 교재를 놓았던 칸뿐(교재가 끝난 뒤 복사해 둔 같은 문구 줄을 지우지 않게).
    const relay = read("src", "features", "textbooks", "server", "shift-relay.ts");
    expect(relay).toContain("previous: scheduleWith(m!.shifts ?? {})");
  });

  it("🔴 차수 하나 = 줄 하나 — 배정·미룸·당김이 같은 쓰기를 탄다(원장 2026-10-19 \"차시마다 한줄씩\")", () => {
    // 한 줄로 잇던 옛 함수가 되살아나면 `25분` 줄 하나에 차수가 둘 들어간다.
    expect(plan).not.toContain("mergeSameCellLessons");
    const body = plan.slice(plan.indexOf("async function writePlannedCells"));
    expect(body).toContain("applyCellLessons(");
    expect(body).toContain("groupCellLessons(");
    const relay = read("src", "features", "textbooks", "server", "shift-relay.ts");
    expect(relay).toContain("applyCellLessons(");
    expect(relay).not.toContain('rpc("ecs_apply_textbook_lessons"');
    // 고쳐 쓴 줄도 차수 자리를 차지한다(1차수 줄을 고친 칸에서 2차수가 1번 자리로 밀려 들어가지 않게).
    expect(relay).toContain("lines: mine, edited,");
  });

  it("🔴 되돌리기 — 같은 게이트 · 클라 기록을 그대로 믿지 않는다(원장 2026-10-19 \"덮어쓰기(되돌리기)\")", () => {
    const undo = read("src", "features", "textbooks", "server", "shift-undo-actions.ts");
    expect(undo).toContain("requireEcsClassAccess(input.classId, { write: true })");
    expect(undo).toContain("validToken(input.token, input.classId)");
    expect(undo).toContain("restoreShiftState(");
    expect(read("src", "features", "textbooks", "server", "shift-undo-core.ts")).toContain("planShiftUndo(");
    // 누르기 전 모습은 setLessonShift가 옮기기 **전에** 읽는다.
    const body = plan.slice(plan.indexOf("export async function setLessonShift"));
    expect(body.indexOf("snapshotShiftState(")).toBeLessThan(body.indexOf("shiftAlongPlans("));
  });

  it("🔴 배정 삭제 = 진도 줄·표식 함께 지우기(선택) + 되돌리기(원장 2026-10-19)", () => {
    const body = plan.slice(plan.indexOf("export async function deleteClassTextbookPlan"));
    expect(body).toContain("clearPlanLines(");
    // 손대지 않은 배정 줄만(고쳐 쓴 줄·다른 교재는 남는다) · 다른 배정이 같이 쓰는 칸의 표식은 남긴다.
    const io = read("src", "features", "textbooks", "server", "plan-delete-lines.ts");
    expect(io).toContain("isAssignedLine(");
    expect(io).toContain("markersToClear(");
    // 같은 교재가 다른 축에도 배정돼 있으면 줄은 남긴다(줄엔 축 표시가 없다).
    expect(io).toContain("!input.keepLines");
    // 되돌리기 기록은 실제로 지운 것만(앞뒤 스냅숏 차이로 만들면 남의 입력까지 담긴다).
    const own = body.slice(0, body.indexOf("export async function", 10));
    expect(own).not.toContain("diffShift(");
    // 되돌리기 = 같은 게이트 + 클라 재료 재검사.
    const undo = read("src", "features", "textbooks", "server", "plan-delete-actions.ts");
    expect(undo).toContain("requireEcsClassAccess(input.classId, { write: true })");
    expect(undo).toContain("validPlan(input.plan, input.classId)");
    expect(undo).toContain("restoreShiftState(");
    // 두 삭제 화면이 같은 선택지를 낸다.
    const face = read("src", "app", "(shell)", "textbooks", "_components", "plans-face.tsx");
    const sheet = read("src", "features", "class-sheets", "components", "textbook-fill-existing.tsx");
    expect(face).toContain("deleteClassTextbookPlan(plan.id, { withLines })");
    expect(sheet).toContain("deleteClassTextbookPlan(planId, { withLines })");
  });

  it("🔴 버튼은 실제 줄이 있는 칸에만 · 누르면 확인 창부터(원장 2026-10-19)", () => {
    const table = read("src", "features", "class-sheets", "components", "plan-table.tsx");
    const cal = read("src", "features", "class-sheets", "components", "month-calendar.tsx");
    const month = read("src", "features", "class-sheets", "components", "month-client.tsx");
    expect(table).toContain("canShiftCell(rows)");
    expect(table).toContain("shiftConfirm.ask(");
    expect(cal).toContain("canShiftCell(lines)");
    expect(month).toContain("onShift={shiftConfirm.ask}");
  });

  it("🔴 버튼은 **실제를 적는 표**에 있다 — 달력에만 두면 사람이 못 찾는다", () => {
    // 원장 제보 2026-09-22 *"밀기 당기기는 어디에있음?"* — 처음엔 월간 달력 칸에만 뒀다.
    const table = read("src", "features", "class-sheets", "components", "plan-table.tsx");
    expect(table).toContain("plan.shift.skip");
    expect(table).toContain("handlers.setShift");
    // ⚠️ 지난 날짜를 막지 않는다(뒤늦게 미루는 게 정상 흐름) — 날짜 비교로 버튼을 감추면 안 된다.
    const cal = read("src", "features", "class-sheets", "components", "month-calendar.tsx");
    expect(cal).not.toContain("date >= data.today ?");
  });

  it("미루기는 차수를 **안 쓰고** 지나간다 — 휴일과 같은 규칙", () => {
    expect(sched).toContain('if (shift === "skip") continue;');
    // ⚠️ 미룬 칸을 '연휴로 건너뜀'에 섞지 않는다(사람이 내린 결정이지 연휴가 아니다).
    const loop = sched.slice(sched.indexOf("for (const slot of daySlots)"));
    expect(loop).not.toContain("skippedHolidays.push");
  });
});

/**
 * 🔴 **교재목록 '반 배정' 탭은 실제 칸에 쓰지 않는다**(원장 결정 D1, 2026-09-23 — 감사 D1·F4·N7·S7·T9).
 *    옛 [미리보기]→[기입](`applyTextbookPlan`)이 09-22 결정(*"배정은 실제 칸에 한 줄도 안 쓴다"*)의 뒷문으로
 *    남아 배정만으로 작성률이 올랐다. 실제로 옮기는 길은 시트의 [월간계획 가져오기] 하나뿐이다.
 */
describe("교재 배정 — 반 배정 탭은 읽기 전용", () => {
  const plan = read("src", "features", "textbooks", "server", "plan-actions.ts");
  const face = read("src", "app", "(shell)", "textbooks", "_components", "plans-face.tsx");
  const preview = read("src", "app", "(shell)", "textbooks", "_components", "plan-preview-dialog.tsx");

  it("🔴 저장된 배정을 실제로 기입하던 액션이 없다", () => {
    expect(plan).not.toContain("export async function applyTextbookPlan");
    expect(plan).not.toContain("async function applyLoaded");
    for (const f of [face, preview]) {
      expect(f).not.toContain("applyTextbookPlan");
      expect(f).not.toContain("applyTextbookFill");
    }
  });

  it("미리보기는 읽기 게이트로 연다(쓰기 권한 없는 사무실도 본다)", () => {
    expect(plan).toContain("loadPlan(planId, { write: false })");
  });

  it("잘못 건 배정을 지울 입구가 탭과 시트 배정 창 둘 다에 있다(F4)", () => {
    expect(face).toContain("deleteClassTextbookPlan");
    const existing = read("src", "features", "class-sheets", "components", "textbook-fill-existing.tsx");
    expect(existing).toContain("deleteClassTextbookPlan");
    const dlg = read("src", "features", "class-sheets", "components", "textbook-fill-dialog.tsx");
    expect(dlg).toContain("<TextbookFillExisting");
  });

  it("🔴 모듈을 끈 학원은 화면 입구에서도 교재 배정을 감춘다(S7)", () => {
    const month = read("src", "app", "(shell)", "ecs", "[classId]", "month", "page.tsx");
    expect(month).toContain('isModuleEnabled(settings.modules.disabled, "textbooks")');

    const mathMonth = read("src", "app", "(shell)", "mcs", "[classId]", "month", "page.tsx");
    expect(mathMonth).toContain('const textbooksOn = isModuleEnabled(settings.modules.disabled, "textbooks")');
    expect(mathMonth).toContain("user && textbooksOn ? getMathClassTextbooks");
    expect(mathMonth).toContain("{textbooksOn ? (");
    expect(mathMonth).toContain("<MathTextbookProvider");

    const ecs = read("src", "app", "(shell)", "ecs", "page.tsx");
    const ecsOptions = read("src", "features", "textbooks", "server", "ecs-options.ts");
    expect(ecs).toContain("textbooksOn ? loadEcsTextbookOptions() : Promise.resolve([])");
    expect(ecsOptions).toContain('isModuleOnForTenant(user.tenantId, "textbooks")');
  });

  it("수학 반 배정 표는 MCS가 꺼지면 강사 시트 링크를 만들지 않는다", () => {
    const page = read("src", "app", "(shell)", "textbooks", "page.tsx");
    const mathFace = read("src", "app", "(shell)", "textbooks", "_components", "math-plans-face.tsx");
    expect(page).toContain('mcsOn={isModuleEnabled(settings.modules.disabled, "mcs")}');
    expect(mathFace).toContain("mcsOn ? (");
  });

  it("배정 목록은 500건에서 자르지 않는다(T9)", () => {
    const q = read("src", "features", "textbooks", "server", "queries.ts");
    const body = q.slice(q.indexOf("export async function getClassTextbookPlans"), q.indexOf("export async function getAssignableTextbooks"));
    expect(body).toContain("fetchAllPaged<PlanDbRow>");
    expect(body).not.toMatch(/\.range\(0, 499\)[;)]/);
  });
});
