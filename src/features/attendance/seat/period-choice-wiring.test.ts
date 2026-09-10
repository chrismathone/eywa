import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 자리 **교시 선택**(0255a) 구조 가드 — 원장 2026-09-10.
 *
 * 순수 규칙은 `period-choice.test.ts`가 잡는다. 여기는 **배선**을 잠근다: 출결·시간표 불변 · 감사로그 ·
 * 공개 화면 제외 · 부분 유니크 금지 · 두 보기가 같은 명단을 그린다. 전부 값이 아니라 "어느 코드를
 * 거치는가"라서 단위 테스트로는 안 잡히고, 어긋나도 **에러가 안 난다**.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 낱말이 가드를 통과시키지 않게(가드 전체가 문자열 검사다). */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SQL = read("supabase", "migrations", "0255a_seat_period_choice.sql");
const ACTIONS = strip(read("src", "features", "attendance", "seat", "server", "period-actions.ts"));
const QUERY = strip(read("src", "features", "attendance", "seat", "server", "period-choice.ts"));
const PURE = strip(read("src", "features", "attendance", "seat", "period-choice.ts"));
const DIR = ["src", "app", "(shell)", "attendance", "seat", "[seat]", "_components"];
const BOARD = strip(read(...DIR, "seat-board.tsx"));
const ALL_DAY = strip(read(...DIR, "seat-all-day.tsx"));
const LAB = strip(read(...DIR, "seat-lab-grid.tsx"));
const SHELL_PAGE = strip(read("src", "app", "(shell)", "attendance", "seat", "[seat]", "page.tsx"));
const PUBLIC_PAGE = strip(read("src", "app", "(seat)", "seat", "[seat]", "page.tsx"));

describe("① 감추기만 한다 — 출결·시간표·수강은 한 줄도 안 바뀐다", () => {
  it("교시 선택 액션은 출결·시간표·수강 표를 아예 안 건드린다", () => {
    for (const table of ["attendance_records", "class_schedules", "enrollments"]) {
      expect(ACTIONS).not.toContain(table);
      expect(QUERY).not.toContain(table);
    }
  });

  it("수강 반이동 RPC를 부르지 않는다 — 자리 화면은 출결 전용이라는 상위 결정 그대로", () => {
    for (const src of [ACTIONS, QUERY, PURE, ALL_DAY]) {
      expect(src).not.toContain("move_enrollments_batch");
    }
  });

  it("🔴 명단에 없던 학생을 세우는 경로가 없다 — 규칙은 `filter`(빼기)뿐이다", () => {
    const apply = PURE.slice(PURE.indexOf("export function applySeatPeriodChoices"));
    expect(apply).toContain(".filter(");
    // push/concat/spread로 학생을 더하면 그 순간 "명단 밖 학생 끌어오기"가 된다.
    expect(apply).not.toContain("push(");
    expect(apply).not.toContain("concat(");
  });
});

describe("② 감사로그 — 기능 변동은 모두 남는다(원장 지시)", () => {
  it("이동·고정·해제가 전부 `logAction`을 남긴다", () => {
    expect(ACTIONS).toContain("logAction");
    for (const action of ["seat_period_move", "seat_period_pin", "seat_period_clear"]) {
      expect(ACTIONS).toContain(action);
    }
  });

  it("해제 로그는 **무엇을 지웠는지** 담는다 — 지정 로그와 짝지어 읽히게", () => {
    const clear = ACTIONS.slice(ACTIONS.indexOf("export async function clearSeatPeriodChoices"));
    expect(clear).toContain("removedMoves");
    expect(clear).toContain("removedPins");
  });
});

describe("③ 공개 PIN 화면은 **보기만** 한다", () => {
  it("공개 페이지는 교시 선택을 읽되 쓰기 액션을 import하지 않는다", () => {
    expect(PUBLIC_PAGE).toContain("getSeatPeriodChoices");
    expect(PUBLIC_PAGE).not.toContain("moveSeatStudentPeriod");
    expect(PUBLIC_PAGE).not.toContain("clearSeatPeriodChoices");
    expect(PUBLIC_PAGE).not.toContain("SeatAllDay");
  });

  it("🔴 두 화면이 **같은 명단**을 그린다 — 로그인 쪽에만 얹으면 서로 다른 사실을 말한다", () => {
    for (const page of [SHELL_PAGE, PUBLIC_PAGE]) {
      expect(page).toContain("resolveSeatPeriodChoices");
      expect(page).toContain("markedSlotsByCell");
    }
  });
});

describe("④ 표 모양 — 부분 유니크 금지([[#113]])와 고정 시작일", () => {
  it("유니크 인덱스에 `where` 술어가 없다 — upsert가 그 축으로 추론해야 한다", () => {
    // 유니크를 만드는 문장 안에 `where`가 있으면 부분 인덱스다 — on conflict 추론이 깨져 전건 42P10.
    const uniqueStatements = SQL.split(";").filter((s) => /unique/i.test(s));
    expect(uniqueStatements.length).toBeGreaterThan(0);
    for (const s of uniqueStatements) expect(s).not.toMatch(/where/i);
    expect(SQL).toContain("unique (tenant_id, seat, session_date, class_id, student_id)");
    expect(SQL).toContain("unique (tenant_id, seat, day_of_week, class_id, student_id)");
  });

  it("upsert의 `onConflict` 축이 유니크와 글자까지 같다", () => {
    expect(ACTIONS).toContain('onConflict: "tenant_id,seat,session_date,class_id,student_id"');
    expect(ACTIONS).toContain('onConflict: "tenant_id,seat,day_of_week,class_id,student_id"');
  });

  it("🔴 고정에는 시작일이 있고, 서버가 **그 화면의 날짜**를 넣는다 — 과거는 기록이다", () => {
    expect(SQL).toContain("effective_from date not null");
    expect(ACTIONS).toContain("effective_from: input.date");
    expect(PURE).toContain("effectiveFrom > v.date");
  });

  it("RLS 정책 0개 규약([[#104]]) — 앱은 admin + 명시 tenant_id로만 읽고 쓴다", () => {
    expect(SQL).toContain("enable row level security");
    expect(SQL).not.toMatch(/create policy/i);
    expect(QUERY).toContain("createAdminClient");
    expect(QUERY).toContain('.eq("tenant_id", tenantId)');
  });
});

describe("⑤ 화면 — 두 축을 섞지 않는다", () => {
  it("명단 필터는 순수 소스 한 벌을 부른다 — 화면이 제 조건을 새로 적지 않는다", () => {
    expect(BOARD).toContain("applySeatPeriodChoices(");
    expect(LAB).not.toContain("applySeatPeriodChoices");
  });

  it("🔴 '전체' 보기는 바깥 컨텍스트 하나뿐 — 교시 판은 제 `DndContext`를 끈다", () => {
    expect(ALL_DAY).toContain("externalDnd");
    expect(LAB).toContain("if (!draggable || externalDnd) return body;");
  });

  it("🔴 손잡이는 두 축 중 **하나만 열려 있어도** 잡힌다 — 0254a 미적용이 교시 이동을 죽이지 않게", () => {
    expect(BOARD).toContain("canDrag={canMove || canChoosePeriod}");
    expect(LAB).toContain("const draggable = canDrag ?? canMove;");
  });

  it("🔴 다른 교시의 **다른 반**으로는 못 옮긴다 — 한 드롭이 바꾸는 축은 하나다", () => {
    expect(ALL_DAY).toContain("validateSeatPeriodMove(");
    expect(PURE).toContain("SEAT_PERIOD_SAME_CLASS_ONLY");
  });

  it("🔴 출결이 찍힌 카드는 화면·서버 양쪽에서 막힌다(원장 *절대 불가*)", () => {
    expect(LAB).toContain("seatMoveBlockReason(cur)");
    expect(LAB).toContain("disabled: !canMove || moveBlocked !== null");
    expect(ACTIONS).toContain("seatMoveBlockReason(student.status)");
  });
});
