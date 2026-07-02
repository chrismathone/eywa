import { describe, expect, it } from "vitest";
import {
  EDU_ROWS,
  emptyResume,
  normalizeResume,
  parseResumeForm,
  resumeTitle,
} from "./resume";

describe("parseResumeForm", () => {
  it("FormData 필드를 구조화 데이터로 파싱한다(요일 체크박스·근무형태 화이트리스트 포함)", () => {
    const fd = new FormData();
    fd.set("p_name", " 홍길동 ");
    fd.set("p_residentId", "900101-1234567");
    fd.set("edu_0_school", "한국대학교");
    fd.set("car_1_company", "이전학원");
    fd.set("c_department", "수학팀");
    fd.set("c_workday_mon", "1");
    fd.set("c_workday_thu", "1");
    fd.set("c_employmentType", "정규직");
    fd.set("c_startDate", "2026-08-01");
    const d = parseResumeForm(fd);
    expect(d.personal.name).toBe("홍길동");
    expect(d.personal.residentId).toBe("900101-1234567");
    expect(d.education[0].school).toBe("한국대학교");
    expect(d.education).toHaveLength(EDU_ROWS);
    expect(d.career[1].company).toBe("이전학원");
    expect(d.contract.workDays).toEqual(["mon", "thu"]);
    expect(d.contract.employmentType).toBe("정규직");
    expect(d.contract.startDate).toBe("2026-08-01");
  });

  it("근무형태가 허용 목록 밖이면 빈 값으로 떨어진다", () => {
    const fd = new FormData();
    fd.set("c_employmentType", "해커");
    expect(parseResumeForm(fd).contract.employmentType).toBe("");
  });
});

describe("normalizeResume", () => {
  it("null/비객체 입력은 빈 이력서로 정규화한다", () => {
    expect(normalizeResume(null)).toEqual(emptyResume());
    expect(normalizeResume("junk")).toEqual(emptyResume());
  });

  it("누락 섹션·짧은 배열을 행 수에 맞게 패딩하고 무효 요일을 거른다", () => {
    const d = normalizeResume({
      personal: { name: "김철수", residentId: 123 }, // 숫자=무효 → ""
      education: [{ school: "A대", bogus: "x" }],
      contract: { workDays: ["mon", "없는요일"], employmentType: "아르바이트" },
    });
    expect(d.personal.name).toBe("김철수");
    expect(d.personal.residentId).toBe("");
    expect(d.education).toHaveLength(EDU_ROWS);
    expect(d.education[0].school).toBe("A대");
    expect(d.education[1].school).toBe("");
    expect(d.contract.workDays).toEqual(["mon"]);
    expect(d.contract.employmentType).toBe("아르바이트");
  });
});

describe("resumeTitle", () => {
  it("이름 포함 제목, 이름 없으면 미입력 표기", () => {
    const d = emptyResume();
    expect(resumeTitle(d)).toBe("직원 이력서 — (이름 미입력)");
    d.personal.name = "홍길동";
    expect(resumeTitle(d)).toBe("직원 이력서 — 홍길동");
  });
});
