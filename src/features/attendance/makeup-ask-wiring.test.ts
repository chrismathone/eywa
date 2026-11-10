import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "../onescreen/components/onescreen-screen-source.test-util";

/**
 * 구조 가드 — **모든 보강 추가가 확인창을 거친다**(원장 2026-08-19: *"이름 검색하고 누르면 그냥 추가되고
 * 끝이야. 뭐 아무것도 안나와"*). 예전엔 세 경로 중 둘이 곧장 추가해서, 보강의 대다수인 "다른 반 학생·
 * 결석 보충"에서 결석분·시수를 물을 자리가 아예 없었다. 그 조용한 되돌림을 여기서 막는다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/** 주석 속 예시 문자열을 빼고 **실행되는 줄**만 본다(문서에 적힌 이름이 가드를 속이지 않게). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("원스크린 보강 추가는 항상 묻는다", () => {
  const client = readOnescreenScreen();
  // P3-O batch C: 예전 창(보강 추가 → 결석 조회 앞)은 한 파일에서 수업 후보 판정·수업 바꾸기 본문까지 덮었다 — 나뉜 세 조각을 이어 같은 범위를 본다.
  const hostStart = client.indexOf("export function hostChoicesOfAsk(");
  const fn = [
    client.slice(client.indexOf("async function addMakeupStudent"), client.indexOf("async function loadAbsences")),
    client.slice(hostStart, client.indexOf("\n}\n", hostStart)),
    client.slice(client.indexOf("async function pickMakeupClass"), client.indexOf("async function removeMakeupRow")),
  ].join("\n");

  it("세 갈래(목록에 없음 · 합칠 후보 있음 · 후보 없음)가 전부 확인창으로 간다", () => {
    expect(fn).toContain("setMakeupAsk(");
    // 확인 전에는 카드를 만들지 않는다 — 예전 즉시 추가 경로의 흔적이 남으면 안 된다.
    expect(code(fn)).not.toContain("(보강) 추가됨");
  });

  it("확인창을 거치지 않는 즉시 추가 경로가 없다", () => {
    // addSeparateMakeupRows·setStudents 직접 호출은 resolve(확인 뒤)에서만 일어나야 한다.
    expect(code(fn)).not.toContain("addSeparateMakeupRows(");
    expect(code(fn)).not.toContain("setStudents(");
  });

  it("결석 후보를 불러온다(이월 보강 선택지)", () => {
    expect(client).toContain("fetchMakeupAbsences");
  });
});

describe("영어(ECS)도 같은 확인창을 쓴다", () => {
  const ecs = read("features/class-sheets/components/ecs-makeup-adder.tsx");
  const flow = read("features/attendance/components/makeup-add-flow.tsx");

  it("ECS 어댑터가 공용 흐름(MakeupAddFlow)을 쓴다 — 자체 즉시 저장 경로가 없다", () => {
    expect(ecs).toContain("MakeupAddFlow");
    expect(code(ecs)).not.toContain("setAttendanceCell");
  });

  it("🔴 칸을 먼저 열고 결석분을 잇는다 — 순서 비교는 **주석을 지운 코드**에서(주석이 가드를 속인다)", () => {
    const body = code(flow);
    const cell = body.indexOf("setAttendanceCell(");
    const note = body.indexOf("noteMakeupAgainstAbsence(");
    expect(cell).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(-1);
    expect(cell).toBeLessThan(note);
  });

  it("🔴 시수를 두 번 더하지 않는다 — 합산 액션(linkMakeupToAbsence)을 이 흐름에서 쓰지 않는다", () => {
    // 칸을 열며 units를 적어 놓고 합산 액션을 부르면 그 액션이 자기 값을 current로 읽어 1.5→3.0이 된다.
    expect(code(flow)).not.toContain("linkMakeupToAbsence");
    expect(code(readOnescreenScreen())).toContain(
      "noteMakeupAgainstAbsence(",
    );
  });
});

describe("이월 보강 — 메모와 시수가 서로 다른 반에 간다", () => {
  const action = read("features/attendance/server/actions.ts");
  const note = read("features/attendance/server/makeup-note-action.ts");
  /** 결석 칸 찾기 규약의 단일 소스 — 두 액션이 공유한다. */
  const cellHelper = read("features/attendance/server/absence-cell.ts");

  it("합산 액션도 결석 칸은 absentClassId, 시수 칸은 classId로 본다(정규 행 있는 경로)", () => {
    expect(action).toContain("fetchAbsenceCells(supabase, { studentId, classId: absentClassId, date: absentDate })");
    expect(action).toContain("latestCell(makeupDate, classId)");
    expect(action).toContain("const absentClassId = input.absentClassId || classId");
  });

  it("🔴 메모 전용 액션은 **수강 여부를 묻지 않는다** — 보강생은 정의상 그 반 수강생이 아니다", () => {
    const body = code(note);
    expect(body).toContain("teaching.has(makeupClassId)");
    expect(body).not.toContain("이 반 수강생이 아닙니다");
  });

  it("메모는 실제 결석/공결 칸에만 붙는다 — **두 경로가 같은 조회**를 쓴다(한쪽만 고쳐지지 않게)", () => {
    // 🔑 판정은 쿼리가 상태로 좁히는지로 잠근다. "최신 1건을 집고 결석인지 나중에 확인"으로 되돌아가면
    //    ① 그 1건이 출석이어도 메모가 붙고 ② 하루 여러 교시를 도는 반에서 결석을 못 찾는다.
    // 상태 판정은 **정정 이력을 걷어낸 뒤** JS에서 한다(SQL에 걸면 정정 판정에 필요한 행이 안 온다).
    expect(code(cellHelper)).toContain("ABSENT.has(r.status)");
    expect(code(note)).toContain("fetchAbsenceCells(");
    expect(code(action)).toContain("fetchAbsenceCells(");
  });

  it("🔴🔴 정정 이력을 **먼저** 걷어낸다 — 죽은 결석 행에 메모를 붙이고 성공이라 답하면 안 된다", () => {
    const body = code(cellHelper);
    // attendance_records는 append-only라 정정이 새 행으로 남는다. 상태로만 좁히고 이 축약을 건너뛰면
    // 이미 출석으로 정정된 행을 집는다(그 메모는 어느 화면에도 안 뜬다 — 전부 effective로 걸러진다).
    expect(body).toContain("effectiveAttendanceRecords(");
    // 🔑 순서가 생명 — status를 SQL에 걸면 정정 판정에 필요한 행이 애초에 안 온다.
    expect(body).not.toContain('.in("status"');
    expect(body.indexOf("effectiveAttendanceRecords(")).toBeLessThan(body.indexOf("ABSENT.has("));
  });

  it("조회 실패를 **빈 목록으로 위장하지 않는다** — 실패는 그대로 호출부로 간다", () => {
    const body = code(cellHelper);
    expect(body).toContain("return { ok: false, error:");
    expect(code(note)).toContain("if (!absentRes.ok) return { error: absentRes.error };");
    expect(code(action)).toContain("if (!absentRes.ok) return { error: absentRes.error };");
  });

  it("🔴 결석 칸은 **최신 1건**으로 고르지 않는다 — 그 반이 하루 여러 교시를 돌면 그 1건이 출석이다", () => {
    // 실측 2026-08-19: 최근 120일 21건이 "결석은 있는데 최신 행은 출석"이었다.
    expect(code(cellHelper)).not.toContain("limit(1)");
    // 정렬은 **최근 기록순** — 반별 출석부 폼이 그날 note를 최신 행에서 읽어 전 교시에 되쓰므로,
    // 대상을 그 행과 맞춰 두지 않으면 나중 저장 한 번에 붙여 둔 메모가 조용히 지워진다.
    expect(code(cellHelper)).toContain("a.recorded_at < b.recorded_at");
  });

  it("교시가 여럿이어도 메모는 한 칸에만 붙는다(보강 1회가 결석 3교시를 다 메운 것처럼 보이지 않게)", () => {
    // 우선순위 셋: 이미 이 줄이 적힌 칸 → 아직 어떤 보강도 안 적힌 칸 → 최신 칸.
    // 가운데가 없으면 두 번째 보강이 같은 칸에 쌓여 "한 교시를 두 번 보강"처럼 보인다.
    expect(code(cellHelper)).toContain("rows.find((r) => hasMemoLine(r.note, memo))");
    expect(code(cellHelper)).toContain("rows.find((r) => !MADE_UP_RE.test(r.note ?? \"\"))");
    expect(code(note)).toContain("pickAbsenceNoteTarget(absentRows,");
    expect(code(action)).toContain("pickAbsenceNoteTarget(absentRows,");
  });

  it("메모 전용 액션은 시수를 건드리지 않는다", () => {
    expect(code(note)).not.toContain("session_units");
  });
});

describe("반별 출석부(월간 → 반 입력폼)도 같은 질문을 한다", () => {
  const form = read("app/(shell)/attendance/[date]/[classId]/input-form.tsx");
  const action = read("features/attendance/server/actions.ts");

  it("검색 결과를 곧장 명단에 넣지 않고 확인창을 연다", () => {
    const body = code(form);
    expect(body).toContain("onAdd={openMakeupConfirm}");
    expect(body).toContain("MakeupConfirmDialog");
    // 예전처럼 어댑터가 addMakeup을 직접 받으면 질문 자리가 다시 사라진다.
    expect(body).not.toContain("onAdd={addMakeup}");
  });

  it("🔴 고른 결석분은 폼과 함께 보낸다 — 이 화면은 제출 한 번에 저장하는 모델이다", () => {
    // 저장이 redirect로 끝나 클라가 뒤이어 부를 기회가 없다. hidden으로 실어 서버가 잇는다.
    expect(code(form)).toContain("makeupLink:");
    expect(code(action)).toContain('key.startsWith("makeupLink:")');
    expect(code(action)).toContain("noteMakeupAgainstAbsence({");
  });

  it("🔴 폼에 실린 학생만 잇는다 — 명단 밖 id가 오면 쓰기 표면이 넓어진다(#77)", () => {
    expect(code(action)).toContain("if (!rowStudentIds.has(studentId)) continue;");
  });

  it("연결 실패를 삼키지 않는다 — 못 붙은 건수를 화면으로 돌려준다", () => {
    expect(code(action)).toContain("unlinked");
    expect(code(read("app/(shell)/attendance/[date]/page.tsx"))).toContain("unlinked");
  });
});

describe("영어(ECS)는 **어느 교시**인지도 묻는다", () => {
  const dialog = read("features/attendance/components/makeup-confirm-dialog.tsx");
  const flow = read("features/attendance/components/makeup-add-flow.tsx");
  const adder = read("features/class-sheets/components/ecs-makeup-adder.tsx");

  it("🔴 교시를 안 고르면 확인이 막힌다 — 첫 교시로 조용히 밀어 넣지 않는다", () => {
    // 영어는 하루 한 교시인 반이 **없다**(실측 2026-08-19: 활성 반-요일 115개가 전부 2~4교시).
    // 교시를 안 넘기면 저장이 "그날 전체"가 되고 주간 시트가 그 칸을 첫 교시에 붙인다.
    expect(code(dialog)).toContain("const slotUnpicked =");
    expect(code(dialog)).toContain("|| slotUnpicked");
  });

  it("고른 교시가 저장 축까지 간다(setAttendanceCell slotStart)", () => {
    expect(code(flow)).toContain("...(choice.slotStart ? { slotStart: choice.slotStart } : {})");
  });

  it("ECS 세 진입점이 그날 교시를 넘긴다 — 한 곳만 빠지면 거기서만 첫 교시로 밀린다", () => {
    expect(code(adder)).toContain("buildMakeupSlotOptions(slots)");
    // ⚠️ 느슨하게 "slots={"만 찾으면 **옆 컴포넌트(DayBulk 등)의 같은 prop**에 걸려 어댑터에서 떼도 통과한다.
    //    어댑터 호출부의 실제 표현으로 좁힌다.
    expect(code(read("features/class-sheets/components/today-board.tsx"))).toContain("slots={card.slots}");
    expect(code(read("features/class-sheets/components/today-class-sheet.tsx"))).toContain("slots={day.slots.map(");
    expect(code(read("features/class-sheets/components/sheet-toolbar.tsx"))).toContain("periodLabelBySlot[");
  });

  it("🔴 자리(LAB·JJ) 교시는 보강 선택지가 아니다 — 거기 넣은 보강은 자리 화면에 영영 안 보인다", () => {
    expect(code(read("features/attendance/makeup-slot.ts"))).toContain("isSpecialSlotLabel(s.teacherLabel)");
  });

  it("교시 이름은 화면 카드 머리와 **같은 값**을 쓴다(한쪽만 시각으로 부르지 않게)", () => {
    expect(code(read("features/class-sheets/components/today-class-sheet.tsx"))).toContain("periodLabelBySlot[");
  });

  it("교시 축이 **없는** 화면(원스크린·반별 출석부)은 묻지 않는다 — 없는 질문을 만들지 않는다", () => {
    expect(code(readOnescreenScreen())).not.toContain("slotOptions=");
    expect(code(read("app/(shell)/attendance/[date]/[classId]/input-form.tsx"))).not.toContain("slotOptions=");
  });
});
