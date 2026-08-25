import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 자리(JJ실) 출석부의 **진도(수업계획)** 가 영어 강사 시트와 갈라지지 않게 잠근다.
 *
 * 잠그는 것은 넷이다:
 *  🔴 ① **저장 경로를 새로 만들지 않는다** — 자리 쪽 코드가 `class_sheet_plan_lines`를 직접 쓰거나
 *       계획 RPC를 부르면, 같은 표를 두 규칙(줄 번호·시기·CAS 기대값)으로 쓰게 된다.
 *  🔴 ② **권한은 자리 게이트가 아니라 ECS 게이트**가 정한다 — 자리 화면은 아르바이트·viewer도 여는
 *       화면이라 "출결을 찍을 수 있다"가 "계획을 볼/쓸 수 있다"를 뜻하지 않는다.
 *  🔴 ③ **랩실·공개 PIN에는 계획이 없다** — 공개 화면은 `plans`를 안 넘기고, 로더는 JJ가 아니면 곧장 접힌다.
 *  🔴 ④ **표는 한 벌** — 자리 화면이 계획 표를 다시 짜지 않고 공용 블록을 쓴다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/** 주석 줄을 빼고 **실행되는 줄**만 본다(문서에 적힌 문구가 가드를 속이지 않게). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

const SEAT_DIR = "app/(shell)/attendance/seat/[seat]";

describe("자리 JJ 진도 배선", () => {
  const loader = code(read("features/attendance/seat/server/jj-plan.ts"));

  it("🔴 권한은 영어 시트 게이트(requireEcsClassAccess)가 정한다", () => {
    expect(loader).toContain("requireEcsClassAccess(");
    // 자리 쓰기 게이트로 계획을 열지 말 것 — 축이 다르다(그쪽은 그날 그 자리 명단 담당).
    expect(loader).not.toContain("gateSeatWrite");
    // 쓰기 자격도 같은 게이트에서 온다(화면이 따로 판정하지 않는다).
    expect(loader).toContain("canEdit: access.canWrite");
  });

  it("🔴 RLS 0개 표라 admin + tenant_id 명시 필터(#104)", () => {
    expect(loader).toContain("createAdminClient()");
    expect(loader).toContain('.eq("tenant_id", tenantId)');
  });

  it("🔴 랩실·공개 PIN은 대상이 아니다", () => {
    expect(loader).toContain("if (!seatHasJjFields(seat)");
    // 공개(비로그인) 화면은 계획 재료를 아예 안 넘긴다 — 넘기는 순간 로그인 없이 반 계획이 열린다.
    const publicPage = code(read("app/(seat)/seat/[seat]/page.tsx"));
    expect(publicPage).not.toContain("plans=");
    expect(publicPage).not.toContain("loadSeatJjPlans");
  });

  it("🔴 자리 코드가 계획 표를 직접 쓰지 않는다(저장 경로는 공용 액션뿐)", () => {
    for (const rel of [
      "features/attendance/seat/server/jj-plan.ts",
      "features/attendance/seat/server/mark-actions.ts",
      "features/attendance/seat/server/actions.ts",
      `${SEAT_DIR}/_components/seat-jj-table.tsx`,
      `${SEAT_DIR}/_components/seat-board.tsx`,
      `${SEAT_DIR}/_components/seat-board-saves.ts`,
    ]) {
      const src = code(read(rel));
      expect(src, `${rel}에서 계획 행을 직접 쓰고 있다`).not.toMatch(
        /class_sheet_plan_lines"\)\s*\.\s*(insert|update|upsert|delete)/,
      );
      expect(src, `${rel}에서 계획 RPC를 직접 부르고 있다`).not.toContain("ecs_copy_slot");
      expect(src, `${rel}에서 계획 RPC를 직접 부르고 있다`).not.toContain("ecs_create_plan_line");
    }
  });

  it("🔴 계획 표는 한 벌 — 자리 화면은 공용 블록을 쓴다", () => {
    const table = code(read(`${SEAT_DIR}/_components/seat-jj-table.tsx`));
    expect(table).toContain("SlotPlanBlock");
    // 자기 계획 표를 다시 짜지 않는다(평시/내신·줄 추가·복사 버튼을 여기서 만들면 두 벌이 된다).
    expect(table).not.toContain("PlanTable");
    expect(table).not.toContain("평시");
    expect(table).not.toContain("내용 복사");
  });

  it("🔴 presence scope는 영어 시트와 같다(새 scope를 만들면 두 화면이 서로를 못 본다)", () => {
    const block = code(read("features/class-sheets/components/slot-plan-block.tsx"));
    // scope 문자열은 순수 모듈이 단일 소스 — 화면마다 다시 적으면 갈린다.
    expect(block).toContain("ecsPresenceScope(classId, weekMonday)");
    const src = code(read("features/class-sheets/lib/presence-scope.ts"));
    expect(src).toContain("`ecs:${classId}:${weekMonday}`");
    for (const rel of [
      "features/class-sheets/components/sheet-client.tsx",
      "features/class-sheets/components/sheet-toolbar.tsx",
      "features/class-sheets/components/today-plan-editor.tsx",
      "features/class-sheets/components/slot-plan-block.tsx",
    ]) {
      expect(code(read(rel)), `${rel}이 scope를 직접 적고 있다`).not.toContain("`ecs:$");
    }
    // 주차는 페이지가 날짜에서 만든다 — 시트와 같은 월요일 규약.
    const page = code(read(`${SEAT_DIR}/page.tsx`));
    expect(page).toContain("mondayOf(date)");
  });

  it("🔴 복사 후 CAS 재시드 — 방금 채워진 칸을 처음 고칠 때 충돌이 안 뜨게", () => {
    const machine = code(read("features/class-sheets/components/use-plan-handlers.ts"));
    // 타입 선언이 아니라 **구현**을 본다(같은 이름이 위에 한 번 더 있다).
    const at = machine.indexOf("copySlot: (planDate, slotStart, termMode) => {");
    expect(at).toBeGreaterThan(-1);
    const body = machine.slice(at, machine.indexOf("removeLine:", at));
    expect(body).toContain("seedPlanLines(store, r.lines)");
    // 복사 전엔 호스트의 다른 저장 큐(자리 듣기·단어 디바운스)도 함께 비운다.
    expect(body).toContain("flushHost");
  });

  it("저널 문서 키는 영어 시트와 같다(어느 화면에서 잃었든 다른 쪽에서 되살린다)", () => {
    const block = code(read("features/class-sheets/components/slot-plan-block.tsx"));
    expect(block).toContain("useSheetDoc({ tenantId, userId, classId, week: weekMonday })");
  });
});
