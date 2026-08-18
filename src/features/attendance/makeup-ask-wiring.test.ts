import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
  const client = read("features/onescreen/components/onescreen-client.tsx");
  const fn = client.slice(
    client.indexOf("async function addMakeupStudent"),
    client.indexOf("async function loadAbsences"),
  );

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
    expect(code(read("features/onescreen/components/onescreen-client.tsx"))).toContain(
      "noteMakeupAgainstAbsence(",
    );
  });
});

describe("이월 보강 — 메모와 시수가 서로 다른 반에 간다", () => {
  const action = read("features/attendance/server/actions.ts");
  const note = read("features/attendance/server/makeup-note-action.ts");

  it("합산 액션도 결석 칸은 absentClassId, 시수 칸은 classId로 본다(정규 행 있는 경로)", () => {
    expect(action).toContain("latestCell(absentDate, absentClassId)");
    expect(action).toContain("latestCell(makeupDate, classId)");
    expect(action).toContain("const absentClassId = input.absentClassId || classId");
  });

  it("🔴 메모 전용 액션은 **수강 여부를 묻지 않는다** — 보강생은 정의상 그 반 수강생이 아니다", () => {
    const body = code(note);
    expect(body).toContain("teaching.has(makeupClassId)");
    expect(body).not.toContain("이 반 수강생이 아닙니다");
  });

  it("메모는 실제 결석/공결 칸에만 붙는다(아무 날짜에 한 줄 쓰는 표면을 열지 않는다)", () => {
    expect(code(note)).toContain('absentStatus === "absent" || absentStatus === "excused"');
  });

  it("메모 전용 액션은 시수를 건드리지 않는다", () => {
    expect(code(note)).not.toContain("session_units");
  });
});
