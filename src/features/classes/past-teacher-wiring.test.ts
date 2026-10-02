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
 *    (그게 지금 고치는 거짓말이다). 근거 기록이 없는 구간이 여기 해당한다.
 *
 * **되살리는 방식(2026-10-02 변경 · 원장 2026-10-03 승인 *"지난 강사 가드도 새 방식에 맞춰서"*)**
 * 종전엔 시간표의 `resolveTeacherAsOf`(인수인계 로그 → **그 달** 보고서 작성자)를 그대로 불렀다.
 * 지금은 학생 상세 전용 [`getPastClassTeachers`](../students/server/past-class-teachers.ts)다:
 *  ① 종료일 당시 **담임 이력**(인수인계 로그) — 시간표와 같은 기록(`teacher-as-of`)을 읽는다. 사실.
 *  ② 이력이 없으면 **그 수강 기간 안의 마지막 수업보고서** 작성자 → ③ 없으면 강사가 찍은 **출결** 기록. 추정.
 *  달 단위가 아니라 **이 학생이 다닌 기간**으로 좁혀, 반이동 전날까지만 보고 같은 날 강사가 여럿이면 확정하지 않는다.
 * 두 원장 지시(종료 시점의 강사 · 못 살리면 `—`)와 `(추정)` 꼬리표 금지·마우스 오버 근거는 그대로 지킨다.
 * ⚠️ 마지막 인계 로그와 지금 담임이 어긋나면(로그 없이 담임이 바뀐 경우) 그 **마지막 구간**은 지금 담임으로
 *    읽는다(`homeroomTeacherOnDate`의 규약). 로그로 닫힌 과거 구간은 영향이 없다.
 * ⚠️ 시간표의 지난 주 담임은 여전히 `resolveTeacherAsOf`다 — 추정 규칙이 달라, 이력이 없는 구간에서는
 *    두 화면의 이름이 다를 수 있다(시간표 = 그 달에 가장 많이 쓴 사람 · 학생 상세 = 그 학생 수강 기간의 마지막 작성자).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHomeroomHistoryIndex, buildTeacherAsOfIndex, homeroomTeacherOnDate, resolveTeacherAsOf } from "./teacher-as-of";
import { resolvePastClassTeacher } from "@/features/students/lib/past-class-teacher";

const src = readFileSync(
  join(process.cwd(), "src", "app", "(shell)", "students", "[id]", "_tabs", "classes-tab.tsx"),
  "utf8",
);
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const code = codeOnly(src);
/** 되살리는 조회 본체(server-only라 import할 수 없어 글자로 읽는다). */
const server = codeOnly(
  readFileSync(join(process.cwd(), "src", "features", "students", "server", "past-class-teachers.ts"), "utf8"),
);

describe("지난 수업의 강사 — 종료 시점으로 되살린다", () => {
  it("🔴 지난 줄만 갈아끼운다 — 진행 중·예정은 현재 담임이 정답이다", () => {
    expect(code).toContain("const pastRows = past.map(");
    expect(code).toContain('rows={pastRows} kind="past"');
    expect(code).toContain('rows={current}');
    expect(code).toContain('rows={scheduled}');
  });

  it("🔴 종료 시점으로 묻는다 — 반이동은 이동 전날까지가 그 반의 수업이다", () => {
    expect(src).toContain('from "@/features/students/server/past-class-teachers"');
    expect(code).toContain("await getPastClassTeachers(");
    expect(code).toContain("enrollmentLastDate(r.endDate, r.isTransferred)");
  });

  it("🔴 담임 이력(사실)은 시간표와 **같은 기록**을 읽는다 — 이력이 없으면 지금 담임으로 메우지 않는다", () => {
    expect(server).toContain('from "@/features/classes/teacher-as-of"');
    expect(server).toContain("getHomeroomHistoryIndex()");
    // `homeroomTeacherOnDate`는 이력이 비면 **현재 담임**을 돌려준다(출석부용 규약). 그래서 이력이 있을 때만
    // 부르고 없으면 null이어야 한다 — 이 가드를 떼면 9/1 부임자가 5월 수강의 강사로 되돌아온다.
    expect(server).toMatch(/history\.get\(t\.classId\)\?\.length\s*\?\s*homeroomTeacherOnDate\([\s\S]*?t\.lastDate\)\s*:\s*null/);
  });

  it("🔴 못 살리면 `—` — 현재 담임으로 메우지 않는다", () => {
    // `at?.name ?? null`이어야 한다. `?? r.teacherName`이면 고치기 전으로 되돌아간다.
    expect(code).toContain("teacherName: at?.name ?? null");
    expect(code).not.toMatch(/at\?\.name \?\? r\.teacherName/);
  });

  it("지난 수강이 없으면 조회 자체를 안 한다(왕복 0) · 담임 이력으로 다 풀리면 보고서·출결도 안 읽는다", () => {
    const early = server.indexOf("if (!targets.length) return result");
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(server.indexOf("await createClient()"));
    expect(early).toBeLessThan(server.indexOf("getHomeroomHistoryIndex()"));
    const evidence = server.indexOf("if (missing.length)");
    expect(evidence).toBeGreaterThan(-1);
    expect(evidence).toBeLessThan(server.indexOf('.from("lesson_reports")'));
    expect(evidence).toBeLessThan(server.indexOf('.from("attendance_records")'));
  });

  it("🔴 화면 글자는 **이름만** — `(추정)` 꼬리표 금지(원장 2026-09-07)", () => {
    expect(src).not.toContain("(추정)");
  });

  it("⚠️ 그래도 근거 등급은 남는다 — 마우스 오버로 무엇으로 되살렸는지 말한다([[#93]])", () => {
    // 화면에서 글자를 뗀 것이지 사실을 지운 게 아니다. 데이터까지 지우면 되돌릴 수 없다.
    expect(code).toContain("teacherInferred");
    // 추정이면 **어느 날의 어떤 기록**으로 되살렸는지까지 말한다(수업보고서 / 출결).
    expect(src).toContain("기록 기준으로 추정한 담당입니다");
    expect(code).toMatch(/r\.teacherInferred\s*\?\s*r\.teacherEvidence/);
    expect(src).toContain("인수인계 기록에 남은 이름입니다");
  });
});

describe("판정 자체 — 학생 상세가 쓰는 방식(실데이터 모양으로)", () => {
  // 실측 모양(초등M 초6 BS2P): 09-01 인수인계 → 허주연. 그 전 담임은 로그에 없다(옛 로그엔 이전 담당이 안 남았다).
  // 8월엔 허은진, 7월엔 이유정이 보고서를 썼다.
  const history = buildHomeroomHistoryIndex([
    { classId: "c1", date: "2026-09-01", teacherName: "허주연", teacherId: "heo-juyeon" },
  ]);
  const nameOf: Record<string, string> = { "heo-juyeon": "허주연" };
  const reports = [
    { classId: "c1", date: "2026-07-29", name: "이유정" },
    { classId: "c1", date: "2026-08-27", name: "허은진" },
    { classId: "c1", date: "2026-09-03", name: "허주연" },
  ];
  /** 서버 조회와 같은 순서 — 이력이 있을 때만 그날의 담임을 묻고, 그 이름이 없으면 근거로 추정한다. */
  const restore = (startDate: string, lastDate: string, classId = "c1") => {
    const periods = history.get(classId);
    const assignedId = periods?.length ? homeroomTeacherOnDate(periods, "heo-juyeon", lastDate) : null;
    return resolvePastClassTeacher(
      { enrollmentId: "e", classId, startDate, lastDate },
      assignedId ? (nameOf[assignedId] ?? null) : null,
      reports,
      [],
    );
  };

  it("인계 뒤에 끝난 수강 = 인계받은 사람(사실)", () => {
    expect(restore("2026-06-01", "2026-09-10")).toMatchObject({ name: "허주연", inferred: false });
  });

  it("🔴 인계 전에 끝난 수강은 그 기간의 마지막 보고서 작성자(추정) — 9/1 부임자가 8월·7월 줄에 안 뜬다", () => {
    expect(restore("2026-06-01", "2026-08-28")).toMatchObject({ name: "허은진", inferred: true, source: "report", date: "2026-08-27" });
    expect(restore("2026-06-01", "2026-07-31")).toMatchObject({ name: "이유정", inferred: true, date: "2026-07-29" });
  });

  it("🔴 근거가 없으면 null — 화면이 `—`로 비운다(지금 담임으로 메우지 않는다)", () => {
    // 수강 기간 안에 보고서도 출결도 없다.
    expect(restore("2026-05-01", "2026-05-30")).toBeNull();
    // 담임 이력이 아예 없는 반 — `homeroomTeacherOnDate`를 그대로 부르면 지금 담임이 나오므로 부르지 않는다.
    expect(restore("2026-05-01", "2026-05-30", "no-history")).toBeNull();
  });
});

// 아래는 **시간표의 지난 주 담임**이 쓰는 판정이다(학생 상세는 2026-10-02부터 위 방식). 같은 실측 모양으로 남겨 둔다.
describe("판정 자체 — 시간표의 지난 주 담임(실데이터 모양으로)", () => {
  // 실측 모양: 09-01 인수인계(허주연) · 8월 작성자 허은진 · 7월 작성자 이유정.
  const index = buildTeacherAsOfIndex({
    since: "2025-10-01", // historyWindowStart("2026-09-07") = 12개월 창의 시작(2026-09-07 확대)
    transitions: [{ classId: "c1", date: "2026-09-01", teacherName: "허주연" }],
    writers: [
      { classId: "c1", month: "2026-08", teacherName: "허은진", count: 25 },
      { classId: "c1", month: "2026-07", teacherName: "이유정", count: 9 },
      // 2026-09-07 창 확대(2→12개월)로 **되살아난** 구간 — 이관분 반 백필이 만든 근거다.
      { classId: "c1", month: "2026-05", teacherName: "김윤하", count: 36 },
    ],
  });

  it("인계 뒤에 끝난 수강 = 인계받은 사람(사실)", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-09-02")).toEqual({ name: "허주연", inferred: false });
  });

  it("🔴 인계 전에 끝난 수강은 그 시기 작성자(추정) — 9/1 부임자가 8월 줄에 안 뜬다", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-08-27")).toEqual({ name: "허은진", inferred: true });
    expect(resolveTeacherAsOf(index, "c1", "2026-07-01")).toEqual({ name: "이유정", inferred: true });
  });

  it("🔴 창을 12개월로 넓혀 5월도 되살아난다(2026-09-07) — 종전엔 창 밖이라 `—`였다", () => {
    expect(resolveTeacherAsOf(index, "c1", "2026-05-08")).toEqual({ name: "김윤하", inferred: true });
  });

  it("🔴 그래도 창 밖이면 null — 화면이 `—`로 비운다(없는 걸 지어내지 않는다)", () => {
    // since=2025-10-01 이전. 창을 넓힌 것이지 없앤 게 아니다.
    expect(resolveTeacherAsOf(index, "c1", "2025-06-01")).toBeNull();
  });
});
