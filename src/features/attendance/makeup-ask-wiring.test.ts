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

  it("🔴 칸을 먼저 열고 결석분을 연결한다 — 순서가 뒤집히면 링크가 '출석' 칸을 새로 만든다", () => {
    const cell = flow.indexOf("setAttendanceCell(");
    const link = flow.indexOf("linkMakeupToAbsence(");
    expect(cell).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(-1);
    expect(cell).toBeLessThan(link);
  });
});

describe("이월 보강 — 메모와 시수가 서로 다른 반에 간다", () => {
  const action = read("features/attendance/server/actions.ts");

  it("결석 칸 조회는 absentClassId, 시수 칸은 classId", () => {
    expect(action).toContain("latestCell(absentDate, absentClassId)");
    expect(action).toContain("latestCell(makeupDate, classId)");
  });

  it("absentClassId 미지정이면 같은 반으로 떨어진다(기존 동작 보존)", () => {
    expect(action).toContain("const absentClassId = input.absentClassId || classId");
  });
});
