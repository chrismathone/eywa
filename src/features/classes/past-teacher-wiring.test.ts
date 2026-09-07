/**
 * **지난 수업의 '강사' = 그 수업이 끝날 때의 담임** — 회귀 방지.
 *
 * 원장 제보 2026-09-07: *"허주연 선생님은 9/1에 직원등록을 했는데 어떻게 사진과같은 일이 가능하지?"*
 * — 학생 상세 '지난 수업' 표가 5월·7월에 끝난 수강의 강사로 **9/1 부임한 사람**을 찍고 있었다.
 * 원인은 그 열이 `classes.teacher_id`(**지금** 담임)라서다. 담임은 반 단위라 시간 축이 없다.
 *
 * 실측(초등M 초6 BS2P·개별 BS2G): 인수인계 로그 09-01 → 허주연 / 월별 작성자 8월 허은진 · 7월 이유정.
 * 즉 **되살릴 근거가 실제로 있다.**
 *
 * 원장 지시 두 줄:
 *  · *"종료된 수업은 종료될 타이밍의 강사가 말이 되는거 아닌가?"* → 종료일 시점 담임으로.
 *  · *"살릴 수 없는 부분은 그냥 'ㅡ'로 전부 미입력 상태로 냅둬"* → 🔴 **현재 담임으로 메우지 않는다**
 *    (그게 지금 고치는 거짓말이다). 창(최근 2개월) 밖·기록 없는 구간이 여기 해당한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTeacherAsOfIndex, resolveTeacherAsOf } from "./teacher-as-of";

const src = readFileSync(
  join(process.cwd(), "src", "app", "(shell)", "students", "[id]", "_tabs", "classes-tab.tsx"),
  "utf8",
);
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const code = codeOnly(src);

describe("지난 수업의 강사 — 종료 시점으로 되살린다", () => {
  it("🔴 지난 줄만 갈아끼운다 — 진행 중·예정은 현재 담임이 정답이다", () => {
    expect(code).toContain("const pastRows = past.map(");
    expect(code).toContain('rows={pastRows} kind="past"');
    expect(code).toContain('rows={current}');
    expect(code).toContain('rows={scheduled}');
  });

  it("🔴 되살리기는 시간표와 **같은 단일 소스**를 쓴다(두 벌로 적으면 화면마다 다른 이름이 뜬다)", () => {
    expect(code).toContain("resolveTeacherAsOf(asOfIndex, r.classId, r.endDate)");
    expect(src).toContain('from "@/features/classes/teacher-as-of"');
  });

  it("🔴 못 살리면 `—` — 현재 담임으로 메우지 않는다", () => {
    // `at?.name ?? null`이어야 한다. `?? r.teacherName`이면 고치기 전으로 되돌아간다.
    expect(code).toContain("teacherName: at?.name ?? null");
    expect(code).not.toMatch(/at\?\.name \?\? r\.teacherName/);
  });

  it("지난 수강이 없으면 조회 자체를 안 한다(왕복 0)", () => {
    expect(code).toContain("past.length > 0 ? await getTeacherAsOfIndex() : null");
  });

  it("⚠️ 추정이면 화면이 밝힌다 — 작성자는 담임이 아니다([[#93]])", () => {
    expect(code).toContain("teacherInferred");
    expect(src).toContain("(추정)");
  });
});

describe("판정 자체 — 실데이터 모양으로", () => {
  // 실측 모양: 09-01 인수인계(허주연) · 8월 작성자 허은진 · 7월 작성자 이유정.
  const index = buildTeacherAsOfIndex({
    today: "2026-09-07",
    transitions: [{ classId: "c1", date: "2026-09-01", teacherName: "허주연" }],
    writers: [
      { classId: "c1", month: "2026-08", teacherName: "허은진", count: 25 },
      { classId: "c1", month: "2026-07", teacherName: "이유정", count: 9 },
    ],
  });

  it("인계 뒤에 끝난 수강 = 인계받은 사람(사실)", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-09-02")).toEqual({ name: "허주연", inferred: false });
  });

  it("🔴 인계 전에 끝난 수강은 그 시기 작성자(추정) — 9/1 부임자가 8월 줄에 안 뜬다", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-08-27")).toEqual({ name: "허은진", inferred: true });
    expect(resolveTeacherAsOf(index, "c1", "2026-07-01")).toEqual({ name: "이유정", inferred: true });
  });

  it("🔴 창 밖(5월)은 null — 화면이 `—`로 비운다", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-05-08")).toBeNull();
  });
});
