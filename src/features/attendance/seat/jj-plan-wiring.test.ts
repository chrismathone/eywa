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
 *  🔴 ③ **랩실엔 계획이 없다** — 로더는 JJ가 아니면 곧장 접힌다.
 *  🔴 ④ **표는 한 벌** — 자리 화면이 계획 표를 다시 짜지 않고 공용 블록을 쓴다.
 *  🔴 ⑤ **문이 둘, 밑바닥은 하나**(2026-08-25) — 비로그인 공개 화면(`/seat/jj`)도 진도를 쓴다. 그쪽 문은
 *       ECS 게이트가 아니라 **자리 PIN 쿠키 + 오늘 + 그 교시 명단**이고(`gateSeatPlanWrite`), 통과 뒤에는
 *       로그인 경로와 **같은 저장 함수**(`plan-write.ts`)로 흐른다. 게이트 판정 자체는 런타임 테스트
 *       [jj-plan-public.test.ts](./server/jj-plan-public.test.ts)가 잠근다.
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

  it("🔴 랩실은 대상이 아니다", () => {
    expect(loader).toContain("if (!seatHasJjFields(seat)");
    expect(code(read("features/attendance/seat/server/jj-plan-public.ts"))).toContain(
      "if (!seatHasJjFields(seat)) return {};",
    );
  });

  it("🔴 공개 PIN 화면은 **ECS 로더를 쓰지 않는다**(세션이 없어 전건 거절된다)", () => {
    const publicPage = code(read("app/(seat)/seat/[seat]/page.tsx"));
    // 로그인 로더(ECS 게이트)를 여기서 부르면 계획이 통째로 빈다 — 반드시 공개 로더.
    expect(publicPage).not.toContain("loadSeatJjPlans");
    expect(publicPage).toContain("loadPublicSeatJjPlans(seat, session.tenantId, date, period.start)");
    // 저장도 자리 PIN 문으로 나가야 한다 — 안 붙이면 화면엔 그려지는데 저장이 전건 거절된다.
    expect(publicPage).toContain("viaPin: true");
    // 주차는 시트와 같은 월요일 규약(저널 문서 키가 갈리면 복구가 서로 안 보인다).
    expect(publicPage).toContain("mondayOf(date)");
  });

  it("🔴 로그인 화면은 그대로 ECS 게이트 문이다(회귀 금지)", () => {
    const page = code(read(`${SEAT_DIR}/page.tsx`));
    expect(page).toContain("loadSeatJjPlans(");
    expect(page).not.toContain("loadPublicSeatJjPlans");
    // 로그인 화면이 PIN 문으로 나가면 자리 권한이 영어 시트 권한을 우회하는 뒷문이 된다.
    expect(page).not.toContain("viaPin");
  });

  it("🔴 공개 PIN 쓰기 액션은 **하나도 빠짐없이** 자리 게이트를 지난다(#77)", () => {
    const actions = code(read("features/attendance/seat/server/jj-plan-actions.ts"));
    const exported = [...actions.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
    // 셀·줄 추가·이동·삭제·복사 다섯 문 + 칸 편집 감사로그(`commitSeatPlanEdits`, 2026-09-14) — 새 문을 더하면
    // 이 수도 함께 올린다(아래 줄이 그 문도 자리 게이트를 지나는지 함께 잠근다).
    expect(exported).toHaveLength(6);
    expect(actions.match(/await gateSeatPlanWrite\(/g) ?? []).toHaveLength(exported.length);
    // 게이트가 본 (날짜, 교시)와 쓰는 (날짜, 교시)가 갈리면 "오늘로 통과시키고 어제에 쓰기"가 열린다.
    expect(actions).not.toContain("date: string");
    // 로그인 문(ECS 게이트)을 여기서 겸용하지 않는다 — 겸용하면 자리 권한이 시트 권한을 우회한다.
    expect(actions).not.toContain("requireEcsClassAccess");
  });

  it("🔴 이미 있는 줄을 건드리는 셋은 게이트가 돌려준 범위(날짜·교시)를 넘긴다", () => {
    const actions = code(read("features/attendance/seat/server/jj-plan-actions.ts"));
    // 줄 id는 반에만 묶여 있다 — 범위를 안 넘기면 "오늘만"으로 통과한 사람이 지난 날짜 줄을 고친다.
    expect(actions).toContain("applyPlanPatches(gate.grant, input.patches, gate.scope)");
    expect(actions).toContain("removePlanLine(gate.grant, { lineId: input.lineId }, gate.scope)");
    expect(actions).toMatch(/relocatePlanLine\([\s\S]{0,160}gate\.scope,/);
    // 새로 만들거나 복사하는 둘은 게이트가 본 값을 그대로 쓴다(입력을 다시 읽으면 갈릴 수 있다).
    expect(actions).toMatch(/insertPlanLine\(gate\.grant, \{[\s\S]{0,40}\.\.\.gate\.scope,/);
    expect(actions).toContain("copyPlanSlotFromPrevious(gate.grant, { ...gate.scope, termMode: input.termMode })");
  });

  it("🔴 두 문의 축이 섞이지 않는다(자리 게이트 ↔ ECS 게이트)", () => {
    // ECS 로더는 여전히 자리 게이트를 모른다.
    expect(loader).not.toContain("gateSeatPinOnly");
    // 공개 게이트는 ECS 게이트를 안 쓴다(로그인 없는 화면이라 통과할 수 없다).
    const publicGate = code(read("features/attendance/seat/server/jj-plan-public.ts"));
    expect(publicGate).not.toContain("requireEcsClassAccess");
    // 명단 판정은 출결 쓰기가 쓰는 그 경로 재사용 — 두 벌로 만들면 화면과 저장이 갈린다.
    expect(publicGate).toContain("rosterKeys(");
    expect(publicGate).toContain("gateSeatPinOnly(");
    // 공개 경로는 세션이 없다 → admin + tenant_id 명시 필터(#104).
    expect(publicGate).toContain("createAdminClient()");
    expect(publicGate).toContain('.eq("tenant_id", tenantId)');
  });

  it("🔴 계획 쓰기 밑바닥은 게이트 없는 공개 엔드포인트가 아니다", () => {
    const impl = read("features/class-sheets/server/plan-write.ts");
    // "use server"면 export 전부가 게이트 없는 서버 액션으로 열린다.
    expect(impl).not.toMatch(/^\s*"use server"/m);
    expect(impl).toContain('import "server-only"');
    // 권한 판정은 문(액션)이 한다 — 밑바닥이 게이트를 겸하면 두 벌이 된다.
    expect(code(impl)).not.toContain("requireEcsClassAccess");
  });

  it("🔵 공개 PIN 경로의 작성자는 null이다(계정 없는 사람을 이름 붙이지 않는다)", () => {
    const publicGate = code(read("features/attendance/seat/server/jj-plan-public.ts"));
    expect(publicGate).toContain("actorId: null");
    // 밑바닥이 null을 받을 수 있어야 한다(타입이 좁아지면 조용히 남의 이름이 박힌다).
    expect(code(read("features/class-sheets/server/plan-write.ts"))).toContain("actorId: string | null");
  });

  it("🔴 자리 코드가 계획 표를 직접 쓰지 않는다(저장 경로는 공용 액션뿐)", () => {
    for (const rel of [
      "features/attendance/seat/server/jj-plan.ts",
      "features/attendance/seat/server/jj-plan-public.ts",
      "features/attendance/seat/server/jj-plan-actions.ts",
      "features/attendance/seat/seat-plan-api.ts",
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
