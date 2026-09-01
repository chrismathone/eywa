import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 월간 뷰에서 **그 날짜를 그 자리에서 고치는** 배선이 조용히 갈라지지 않게 잠근다
 * (원장 2026-09-01 *"ecs 월간뷰에서도 더블클릭으로 해당날짜 수정가능하게"*).
 *
 * 잠그는 것 넷:
 *  ① 편집기는 **기존 기계를 재사용**한다 — `SlotPlanBlock` + `ECS_PLAN_API`. 계획 저장 경로를 월간용으로
 *    새로 짜면 같은 표를 서로 다른 규칙(줄 번호·CAS 기대값)으로 쓰게 된다(use-plan-handlers 🔴).
 *  ② 줄은 **월간 조회가 아니라 `getEcsDayPlan`이 다시 읽는다** — 월간 조회는 빈 줄·고아 줄을 걸러서
 *    주므로 그대로 심으면 CAS 기대값이 어긋나 첫 저장이 충돌로 뜬다(day-plan.ts 🔴).
 *  ③ 달력 칸의 **단일 클릭 이동을 미룬다** — 안 미루면 첫 클릭이 이미 페이지를 떠나서 두 번째 클릭이
 *    닿을 곳이 없다(더블클릭이 영원히 안 걸린다).
 *  ④ 닫을 때 **저장 큐를 비운 뒤** 다시 읽는다 — 안 비우면 방금 친 글자가 서버에 닿기 전에 옛 값을
 *    다시 그려 "고쳤는데 그대로"가 된다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/**
 * 주석 줄을 빼고 **실행되는 줄**만 본다(문서에 적힌 문구가 가드를 속이지 않게).
 * ⚠️ JSX 주석 여는 줄(`{`+`/*`)도 뺀다 — 이 화면 파일들은 "왜 이렇게 했나"를 코드 안에 길게 적어 두는
 *    관례라, 안 빼면 **없앤 것을 설명하는 문장**이 가드에 걸려 헛되이 실패한다(첫 구현이 그랬다).
 */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("{/*");
    })
    .join("\n");

describe("월간 뷰 · 그 날짜 고치기 배선", () => {
  const editor = code(read("features/class-sheets/components/month-day-editor.tsx"));
  const calendar = code(read("features/class-sheets/components/month-calendar.tsx"));
  const client = code(read("features/class-sheets/components/month-client.tsx"));
  const dayPlan = code(read("features/class-sheets/server/day-plan.ts"));

  it("① 편집기가 기존 계획 기계를 재사용한다(SlotPlanBlock + ECS_PLAN_API)", () => {
    expect(editor).toContain("SlotPlanBlock");
    expect(editor).toContain("ECS_PLAN_API");
  });

  it("① 편집기가 저장 경로를 새로 만들지 않는다(RPC·패치 액션 직접 호출 금지)", () => {
    for (const forbidden of [
      "flushSheetPatches",
      "createPlanLine",
      "movePlanLine",
      "deletePlanLine",
      "copySlotFromPrevious",
      "ecs_copy_slot",
    ]) {
      expect(editor).not.toContain(forbidden);
    }
  });

  it("② 줄은 getEcsDayPlan이 다시 읽는다(월간 조회의 걸러진 목록을 심지 않는다)", () => {
    expect(editor).toContain("getEcsDayPlan");
    // 월간 조회가 만든 걸러진 맵을 편집기에 넘기면 안 된다.
    expect(editor).not.toContain("linesBySlot={");
    expect(editor).toContain("plan.linesBySlot[");
  });

  it("② getEcsDayPlan은 같은 게이트를 통과하고 admin + tenant 필터로 읽는다", () => {
    expect(dayPlan).toContain("requireEcsClassAccess");
    expect(dayPlan).toContain("createAdminClient");
    expect(dayPlan).toContain('.eq("tenant_id"');
    // 🔴 편집기용이므로 **거르지 않는다** — 월간 조회의 필터를 여기로 복사해 오면 ②가 무너진다.
    expect(dayPlan).not.toContain("isMeaningfulPlanLine");
  });

  it("③ 달력 칸은 단일 클릭 이동을 미루고 더블클릭에서 취소한다", () => {
    expect(calendar).toContain("onDoubleClick");
    expect(calendar).toContain("DBLCLICK_MS");
    expect(calendar).toContain("setTimeout");
    // 미룬 타이머를 언마운트에서 반드시 정리한다(떠난 뒤 이동이 튀지 않게).
    expect(calendar).toContain("clearTimeout");
    expect(calendar).toContain("useEffect(() => cancelNav");
  });

  it("③ 키보드·새 탭 클릭은 가로채지 않는다", () => {
    expect(calendar).toContain("e.detail === 0");
    expect(calendar).toMatch(/metaKey|ctrlKey/);
  });

  it("④ 닫을 때 등록된 flush를 모두 기다린 뒤 다시 읽는다", () => {
    expect(editor).toContain("registerFlush");
    expect(editor).toContain("Promise.all");
    expect(editor).toContain("onSaved");
    expect(client).toContain("router.refresh()");
  });

  it("④ SlotPlanBlock이 registerFlush를 실제로 등록·해제한다", () => {
    const block = code(read("features/class-sheets/components/slot-plan-block.tsx"));
    expect(block).toContain("registerFlush(() => store.flush())");
    expect(block).toContain("registerFlush(null)");
  });

  it("두 보기 모두 같은 창을 연다(달력=더블클릭 · 진도표=날짜 열 머리)", () => {
    const rail = code(read("features/class-sheets/components/month-rail.tsx"));
    expect(calendar).toContain("onOpenDay");
    expect(rail).toContain("onOpenDay(date)");
    expect(client).toContain("MonthDayEditor");
  });
});

/**
 * 구조 가드 — 주간 이동이 **앱 전역 기간 네비**를 쓴다(원장 2026-09-01 *"주차이동을 월간처럼 깔끔한
 * 스타일로 바꾸자"* — 08-31 *"웹앱내에서 비슷한 곳은 다"*의 연장).
 *
 * 🔴 '이번주' 알약을 되살리지 말 것 — 그 두 가지 일(이번 주로 돌아가기 / 지금 이번 주인가)은
 *    PeriodNav의 **라벨 클릭 + 과거·미래 조회 배지**가 나눠 맡는다.
 */
describe("주간 이동 네비", () => {
  const weekNav = code(read("app/(shell)/timetable/_components/week-nav.tsx"));
  const weekNavClient = code(read("app/(shell)/timetable/_components/week-period-nav.tsx"));
  const toolbar = code(read("features/class-sheets/components/sheet-toolbar.tsx"));

  it("두 주간 네비가 모두 PeriodNav를 쓴다", () => {
    expect(weekNavClient).toContain("PeriodNav");
    expect(weekNav).toContain("WeekPeriodNav");
    expect(toolbar).toContain("<PeriodNav");
  });

  it("손으로 그린 '이번주' 알약이 남아 있지 않다", () => {
    expect(weekNav).not.toContain("이번주");
    expect(toolbar).not.toContain("이번주");
  });

  it("과거/미래 조회 신호(relation)를 넘긴다 — 지난 주를 이번 주로 착각하지 않게", () => {
    expect(weekNav).toContain("weekRelation");
    expect(toolbar).toContain("relation={rel}");
  });

  it("🔴 시간표의 미저장 이탈 가드가 유지된다(옮긴 배치가 말없이 날아가지 않게)", () => {
    expect(weekNavClient).toContain("confirmTimetableNav");
  });

  it("🔴 ECS 시트는 이동 전 저장 flush를 가로챈다", () => {
    expect(toolbar).toContain("onNavigate={onNavigate}");
  });

  it("🔴 가로챈 이동에도 '가는 중'이 보인다(안 보이면 화살표를 두 번 누른다)", () => {
    // 시간표·ECS 랜딩은 `startTransition`이라 Promise가 없다 → PeriodNav에 pending을 직접 넘겨야 한다.
    expect(weekNavClient).toContain("pending={pending}");
    expect(code(read("components/period-nav.tsx"))).toContain("externalPending");
  });
});
