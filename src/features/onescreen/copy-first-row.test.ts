import { describe, expect, it } from "vitest";
import { copyableFields, isCopyTargetRow, planCopyFirstRow, rowClassName, type CopyRowTarget } from "./grid";
import type { Subject } from "./types";

const src = { subjectKey: "math", today: "지수·로그함수 3차시", textbook: "개념원리 -89", homeworkToday: "p.90~95" };

const t = (over: Partial<CopyRowTarget> & { studentId: string }): CopyRowTarget => ({
  subjectName: "수학",
  subjectIndex: 0,
  subjectKey: "math",
  today: "",
  textbook: "",
  homeworkToday: "",
  actionable: true,
  ...over,
});

describe("copyableFields", () => {
  it("빈 값은 복사 대상이 아니다(지우기가 아님)", () => {
    expect(copyableFields({ subjectKey: "math", today: "  ", textbook: "개념원리", homeworkToday: "" })).toEqual({
      textbook: "개념원리",
    });
  });
});

describe("planCopyFirstRow — 같은 반만(원장 2026-10-15 · PS3A ← MS1A)", () => {
  it("🔴 다른 반 행은 건너뛰고 센다 · 반을 모르는 행도 넣지 않는다", () => {
    const r = planCopyFirstRow({ ...src, classKey: "MS1A" }, [
      t({ studentId: "a", classKey: "MS1A" }),
      t({ studentId: "b", classKey: "PS3A" }),
      t({ studentId: "c", classKey: null }),
    ], { overwrite: false });
    expect(r.plan.map((p) => p.studentId)).toEqual(["a"]);
    expect(r.skippedClass).toBe(1);
    expect(r.skippedNoClass).toBe(1);
  });
  it("🔴 맨 위 행의 반을 몰라도 반을 아는 다른 행엔 넣지 않는다(보강 학생이 위로 온 이름순 '전체' 보기)", () => {
    const r = planCopyFirstRow({ ...src, classKey: null }, [t({ studentId: "a", classKey: "X" }), t({ studentId: "b", classKey: "Y" })], { overwrite: false });
    expect(r.plan).toHaveLength(0);
    expect(r.skippedClass).toBe(2);
  });
  it("반 정보가 아예 없는 표는 종전대로 과목만 본다", () => {
    const r = planCopyFirstRow({ ...src, classKey: null }, [t({ studentId: "a" }), t({ studentId: "b", classKey: null })], { overwrite: false });
    expect(r.plan).toHaveLength(2);
  });
});

describe("rowClassName — 반 필터와 같은 열쇠", () => {
  const base = { makeup: false, classId: "c1", className: "MS1A", makeupClassName: null } as const;
  it("정규 행은 반 이름 · 반 없는 보강 행은 보강을 넣은 수업(앵커) · 둘 다 없으면 모름", () => {
    expect(rowClassName(base)).toBe("MS1A");
    // 🔴 같은 반 수업에 온 보강 행 — 맨 위 행 복사가 "다른 반"으로 빼면 안 된다(원장 2026-08-13 "보강만 적용 안 된다는건 일괄 적용이 아님").
    expect(rowClassName({ makeup: true, classId: null, className: null, makeupClassName: "MS1A" })).toBe("MS1A");
    expect(rowClassName({ makeup: true, classId: null, className: null, makeupClassName: null })).toBeNull();
    // 정규 행에 켠 '보강' 토글은 그 반 소속 그대로.
    expect(rowClassName({ ...base, makeup: true })).toBe("MS1A");
  });
});

describe("planCopyFirstRow", () => {
  it("빈 행에 진도·교재·오늘 과제를 복사한다", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a" }), t({ studentId: "b" })], { overwrite: false });
    expect(r.plan).toHaveLength(2);
    expect(r.plan[0].set).toEqual({ today: src.today, textbook: src.textbook, homeworkToday: src.homeworkToday });
  });

  it("원본이 비어 있으면 아무것도 하지 않는다", () => {
    const empty = { subjectKey: "math", today: "", textbook: "", homeworkToday: "" };
    expect(planCopyFirstRow(empty, [t({ studentId: "a" })], { overwrite: true }).plan).toEqual([]);
  });

  it("🔴 발송 완료 행은 건너뛴다 — 발송분 수정 금지", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", actionable: false })], { overwrite: true });
    expect(r.plan).toEqual([]);
    expect(r.skippedSent).toBe(1);
  });

  it("🔴 다른 과목 행에는 복사하지 않는다 — 수학 진도가 영어 행에 들어가면 학부모에게 그대로 나간다", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", subjectKey: "english", subjectName: "영어" })], {
      overwrite: true,
    });
    expect(r.plan).toEqual([]);
    expect(r.skippedSubject).toBe(1);
  });

  it("과목 키 미지정은 math로 간주(기존 규칙과 동일)", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", subjectKey: "" })], { overwrite: false });
    expect(r.plan).toHaveLength(1);
  });

  it("덮어쓰기 꺼짐 = 이미 입력된 칸은 보존하고 빈 칸만 채운다", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", today: "직접 쓴 진도" })], { overwrite: false });
    expect(r.plan[0].set).toEqual({ textbook: src.textbook, homeworkToday: src.homeworkToday });
    expect(r.plan[0].set.today).toBeUndefined();
  });

  it("덮어쓰기 켜짐 = 입력된 칸도 원본 값으로 교체", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", today: "직접 쓴 진도" })], { overwrite: true });
    expect(r.plan[0].set.today).toBe(src.today);
  });

  it("모든 칸이 이미 차 있으면(덮어쓰기 꺼짐) 그 행은 계획에서 빠지고 건너뜀으로 센다", () => {
    const full = t({ studentId: "a", today: "x", textbook: "y", homeworkToday: "z" });
    const r = planCopyFirstRow(src, [full], { overwrite: false });
    expect(r.plan).toEqual([]);
    expect(r.skippedFilled).toBe(1);
  });

  it("행 식별자(subjectIndex)를 그대로 전달한다 — 진도 setter가 인덱스 기반이라 이름만으론 못 쓴다", () => {
    const r = planCopyFirstRow(src, [t({ studentId: "a", subjectIndex: 2 })], { overwrite: false });
    expect(r.plan[0]).toMatchObject({ studentId: "a", subjectName: "수학", subjectIndex: 2 });
  });
});

// ── 복사 대상 판정 — 여기서 진도를 요구하면 기능이 통째로 죽는다(2026-07-23 실사고) ──────────────
describe("isCopyTargetRow — 제외 사유는 '발송 완료' 하나뿐", () => {
  const su = (over: Partial<Subject> = {}): Subject =>
    ({ name: "수학", today: "", textbook: "", homeworkToday: "", ...over }) as Subject;

  it("🔴 진도가 비어 있어도 **대상이다** — 그 빈 칸을 채우려고 쓰는 기능이다", () => {
    expect(isCopyTargetRow(su({ today: "" }))).toBe(true);
  });

  it("발송 완료(success) 행은 제외 — ClassNote는 수정이 없어 학부모가 본 것과 갈라진다", () => {
    expect(isCopyTargetRow(su({ classnoteStatus: "success" }))).toBe(false);
  });

  it("실패·대기 상태는 아직 학부모에게 안 갔으므로 대상이다", () => {
    for (const st of ["failed", "queued", "processing", "too_old", "name_conflict", undefined])
      expect(isCopyTargetRow(su({ classnoteStatus: st }))).toBe(true);
  });

  it("세션 중 방금 보낸 건은 live 상태(statusOverride)가 스냅샷을 이긴다", () => {
    expect(isCopyTargetRow(su({ classnoteStatus: undefined }), "success")).toBe(false);
  });

  // 🔴 2026-08-07 뒤집힘: 예전엔 "결석 행도 대상"이었다(기록은 언제든 보존). 그런데 같은 날 결석 행의
  //    **입력이 잠기면서**, 복사가 값을 넣으면 강사가 지울 수 없는 값이 남게 됐다(잠근 문 옆 뒷문).
  //    되돌리는 법은 그대로다 — 출결을 되돌리면 이 판정도 함께 열린다(아래 두 번째 단언).
  it("결석 행은 제외 — 입력이 잠긴 행에 값을 밀어 넣지 않는다", () => {
    const absent = su({ attendanceRaw: "absent" } as Partial<Subject>);
    expect(isCopyTargetRow(absent)).toBe(false);
    expect(isCopyTargetRow({ ...absent, attendanceRaw: "present" })).toBe(true);
  });
});
