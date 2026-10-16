import { describe, expect, it } from "vitest";
import { DEFAULT_SATISFACTION_OPTIONS } from "../evaluation/options";
import { buildRecordOwners } from "./attribution";
import { buildSatisfaction, waitingByPeriod } from "./satisfaction";
import { judgeByRules, verdictPoints } from "./satisfaction-rules";
import type { SnapshotJudgment } from "./source-types";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

/** 학부모 만족도(문구 판정 · 가감 합) — 원장 2026-10-15 "계산 안된거 … 다 해결해". */
const o = DEFAULT_SATISFACTION_OPTIONS;
const w = { month: "2026-10", start: "2026-10-01", end: "2026-10-31", partial: false };

describe("만족도 문구 판정", () => {
  it("인사('감사합니다')만 있는 글은 판정 없음 · 가점 문구 하나면 바로 가점 · 감점 문구 하나면 바로 감점(센 문구 하나로)", () => {
    expect(judgeByRules("오늘도 감사합니다", o)).toEqual({ kind: "none" });
    expect(judgeByRules("선생님 덕분에 수학이 좋아졌어요 감사합니다", o)).toEqual({ kind: "plus", phrase: "덕분" });
    expect(judgeByRules("수업이 불만이고 환불 받고 싶어요", o)).toEqual({ kind: "minus", phrase: "환불" });
    expect(judgeByRules("그만 두려고 합니다", o)).toEqual({ kind: "minus", phrase: "그만두" }); // 띄어쓰기 무시
  });
  it("가점·감점이 함께 · 감점에 완곡어 · 문구 없이 긴 글 = 애매(확인 대기) · 짧고 문구 없으면 없음", () => {
    expect(judgeByRules("덕분에 좋아졌지만 숙제가 많아 불만이에요", o)).toMatchObject({ kind: "ambiguous", reason: "가점·감점 문구가 함께 있음" });
    expect(judgeByRules("혹시 반을 옮기려고 하는데 가능할까요", o)).toMatchObject({ kind: "ambiguous", phrase: "옮기려" });
    expect(judgeByRules("가".repeat(80), o)).toMatchObject({ kind: "ambiguous", reason: "문구 없이 긴 글", phrase: null });
    expect(judgeByRules("내일 몇 시에 끝나나요?", o)).toEqual({ kind: "none" });
  });
  it("점수 = 그 달 설정의 근거 문구 점수, 문구가 없거나 목록에서 빠졌으면 가점·감점 기본 점수", () => {
    expect(verdictPoints("minus", "환불", o)).toBe(-2);
    expect(verdictPoints("plus", "덕분", o)).toBe(1);
    expect(verdictPoints("plus", null, { ...o, plusPoints: 3 })).toBe(3);
    expect(verdictPoints("minus", "없는 문구", o)).toBe(-1);
  });
});

const cls = (id: string, subject: string, teacher: string): SnapshotClass => ({
  id, class_name: id, subject, english_track: null, teacher_id: teacher, is_active: true, closed_at: null, report_optout: null, is_makeup_pool: null,
});
const classes = new Map([cls("m1", "math", "t1"), cls("e1", "english", "t2")].map((c) => [c.id, c]));
const enr = (student: string, classId: string): SnapshotEnrollment => ({
  id: `${student}|${classId}`, student_id: student, class_id: classId, start_date: "2026-09-01", end_date: null, on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false,
});
const ownersOf = buildRecordOwners({ enrollments: [enr("a", "m1"), enr("a", "e1")], classes, owner: (c) => c.teacher_id });
const j = (id: string, over: Partial<SnapshotJudgment>): SnapshotJudgment => ({
  id, student_id: "a", posted_on: "2026-10-05", class_id: null, subjects: ["math"], verdict: "plus", phrase: "덕분", method: "rule", state: "applied", ...over,
});

describe("만족도 가감 합", () => {
  it("반영한 글은 그 과목 반 담임에게 · 확인 대기는 근거에만(0점) · 클레임은 고른 강사에게 · 다른 달은 빼고", () => {
    const period = buildSatisfaction({
      ownersOf,
      source: {
        judgments: [j("j1", {}), j("j2", { verdict: "minus", phrase: "환불" }), j("j3", { state: "pending", verdict: "minus", phrase: null, method: "ai" }),
          j("j4", { subjects: ["english"] }), j("j5", { posted_on: "2026-09-30" })],
        claims: [{ id: "c1", teacher_id: "t1", student_id: null, occurred_on: "2026-10-10", points: -3, content: "전화 응대 항의" }],
      },
    })!;
    const r = period("t1", w, o);
    expect([r.raw, r.plus, r.minus, r.claims, r.waiting]).toEqual([1 - 2 - 3, 1, 1, 1, 1]);
    expect(r.detail.find((x) => x.key === "j3")).toMatchObject({ points: null, waiting: true, how: "확인 대기 · 감점 제안" });
    expect(period("t2", w, o).raw).toBe(1); // 영어 보드 글은 영어 반 담임
    // 글 줄엔 이 선생님에게 온 반 이름(2026-10-16) — 클레임 줄엔 없다.
    const named = period("t1", w, o, (id) => `반-${id}`).detail;
    expect(named.find((x) => x.key === "j1")?.className).toBe("반-m1");
    expect(named.find((x) => x.key === "c1")?.className).toBeUndefined();
    expect(named.find((x) => x.key === "j1")?.sharedWith).toBeUndefined();
  });
  it("두 과목 글이 두 담임 몫이면 서로를 적는다 — 판정 줄은 하나다", () => {
    const period = buildSatisfaction({ ownersOf, source: { judgments: [j("j8", { subjects: ["math", "english"] })], claims: [] } })!;
    expect(period("t1", w, o).detail[0]).toMatchObject({ key: "j8", sharedWith: ["t2"] });
    expect(period("t2", w, o).detail[0]).toMatchObject({ key: "j8", sharedWith: ["t1"] });
  });
  it("과목을 모르는 글은 그날 담임이 한 명일 때만 — 여럿이면 아무에게도 잇지 않는다", () => {
    const period = buildSatisfaction({ ownersOf, source: { judgments: [j("j6", { subjects: [] })], claims: [] } })!;
    expect([period("t1", w, o).raw, period("t2", w, o).raw]).toEqual([0, 0]);
    const one = buildRecordOwners({ enrollments: [enr("b", "m1")], classes, owner: (c) => c.teacher_id });
    expect(buildSatisfaction({ ownersOf: one, source: { judgments: [j("j7", { student_id: "b", subjects: [] })], claims: [] } })!("t1", w, o).raw).toBe(1);
  });
  it("판정 표가 없으면(SQL 적용 전) 만들지 않는다 — 그 지표는 계산 전", () => {
    expect(buildSatisfaction({ ownersOf, source: null })).toBeNull();
  });
});

describe("확인 대기가 남은 달 = 마감 미룸 대상(원장 2026-10-16 '9월을 이달 말까지 열어 두기')", () => {
  it("켠 만족도 항목의 확인 대기 수만 — 끈 항목·0건은 빼고", () => {
    const period = (month: string, waiting: number, off = false) => ({ month, items: [{ id: "satisfaction", waiting, off }, { id: "report" }] });
    const got = waitingByPeriod([
      { id: "t1", periods: [period("2026-09", 3), period("2026-10", 0)] },
      { id: "t2", periods: [period("2026-09", 2, true)] },
    ]);
    expect([...got]).toEqual([["t1|2026-09", 3]]);
  });
});
