import { describe, expect, it } from "vitest";
import { buildDayRecap } from "./digest";
import { buildRecapPrompt, recapFactLines, validateRecapBrief } from "./prompt";

const recap = buildDayRecap({
  date: "2026-08-18",
  slots: [
    {
      classId: "c1",
      className: "중2 A",
      subject: "math",
      slotStart: "16:20",
      saveSlot: null,
      teacherName: "김강사",
      slotTeacherLabel: null,
      hasAnyRecord: true,
      students: [
        {
          studentId: "s1",
          studentName: "이학생",
          schoolGrade: "경명여중2",
          status: "absent",
          note: "감기로 결석",
        },
        { studentId: "s2", studentName: "박학생", schoolGrade: "경명여중2", status: "present", note: null },
      ],
    },
  ],
  recentAbsenceOf: (id) => (id === "s1" ? 3 : null),
});

const labelOf = (k: string) => (k === "math" ? "수학" : k);

describe("recapFactLines", () => {
  it("집계 수치와 명단을 결정론으로 싣는다", () => {
    const lines = recapFactLines(recap, labelOf).join("\n");
    expect(lines).toContain("결석 1건");
    expect(lines).toContain("이학생(경명여중2)");
    expect(lines).toContain("최근 14일 결석 3회");
    expect(lines).toContain("감기로 결석");
    expect(lines).toContain("조치 미완료");
    // 과목은 학원설정 라벨로 — raw 키를 프롬프트에도 화면에도 흘리지 않는다.
    expect(lines).toContain("수학");
  });
});

describe("buildRecapPrompt", () => {
  it("사실 근거 규칙과 출력 형식을 담는다", () => {
    const prompt = buildRecapPrompt(recap, labelOf);
    expect(prompt).toContain("자료에 있는 숫자만");
    expect(prompt).toContain("headline");
    expect(prompt).toContain("2026-08-18");
  });
});

describe("validateRecapBrief", () => {
  const ok = {
    headline: "어제 결석 1건이 조치 미완료입니다.",
    points: ["이학생은 최근 14일 결석 3회로 확인이 필요합니다.", "출결 입력은 2칸 중 2칸으로 마감됐습니다."],
  };

  it("근거 있는 숫자만 있으면 통과", () => {
    const result = validateRecapBrief(ok, recap, labelOf);
    expect(result.ok).toBe(true);
  });

  it("자료에 없는 숫자는 폐기", () => {
    const result = validateRecapBrief(
      { ...ok, points: ["결석률이 37%로 올랐습니다."] },
      recap,
      labelOf,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("숫자");
  });

  it("자료에 없는 영문 토큰은 폐기", () => {
    const result = validateRecapBrief({ ...ok, points: ["absent 상태를 확인하세요."] }, recap, labelOf);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("영문");
  });

  it("형식이 어긋나면 폐기", () => {
    expect(validateRecapBrief(null, recap, labelOf).ok).toBe(false);
    expect(validateRecapBrief({ headline: "짧", points: ["x"] }, recap, labelOf).ok).toBe(false);
    expect(validateRecapBrief({ headline: ok.headline, points: [] }, recap, labelOf).ok).toBe(false);
  });
});
