import { describe, expect, it } from "vitest";
import {
  CAREER_ROWS,
  EDU_ROWS,
  emptyResume,
  normalizeResume,
  parseResumeForm,
  RESUME_DRAFT_EXCLUDE,
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

  it("회사 구분·소속부서는 선택지만 통과, 담당자는 자유입력(trim)", () => {
    const fd = new FormData();
    fd.set("c_company", "EIE인재원");
    fd.set("c_division", "영어과");
    fd.set("c_manager", " 김담당 ");
    const d = parseResumeForm(fd);
    expect(d.contract.company).toBe("EIE인재원");
    expect(d.contract.division).toBe("영어과");
    expect(d.contract.manager).toBe("김담당");

    const bad = new FormData();
    bad.set("c_company", "없는회사");
    bad.set("c_division", "없는부서");
    expect(parseResumeForm(bad).contract.company).toBe("");
    expect(parseResumeForm(bad).contract.division).toBe("");
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

  it("회사 구분·소속부서는 선택지 화이트리스트, 옛 데이터(필드 없음)는 빈 값으로 보정", () => {
    const d = normalizeResume({
      contract: { company: "파라엑스", division: "경영지원", manager: "김담당" },
    });
    expect(d.contract.company).toBe("파라엑스");
    expect(d.contract.division).toBe("경영지원");
    expect(d.contract.manager).toBe("김담당");

    const legacy = normalizeResume({ contract: { department: "수학팀" } }); // 신 필드 없는 기존 저장본
    expect(legacy.contract.company).toBe("");
    expect(legacy.contract.division).toBe("");
    expect(legacy.contract.manager).toBe("");

    const tampered = normalizeResume({ contract: { company: "없는회사", division: 7 } });
    expect(tampered.contract.company).toBe("");
    expect(tampered.contract.division).toBe("");
  });
});

describe("RESUME_DRAFT_EXCLUDE", () => {
  // 이 목록은 **보안 계약**이다 — 초안(IndexedDB)에 남으면 안 되는 폼 필드 이름.
  // 오타가 나면 조용히 아무것도 제외되지 않아 주민번호가 평문으로 디스크에 남는다.
  it("나열된 이름이 전부 실제 폼 필드다(오타 = 제외 실패)", () => {
    const fd = new FormData();
    for (const name of RESUME_DRAFT_EXCLUDE) fd.set(name, `채움-${name}`);
    const d = parseResumeForm(fd);

    // 각 필드가 파싱 결과 어딘가에 실제로 들어갔는지 = 그 name이 폼 계약에 존재한다는 증거.
    const parsedValues = JSON.stringify(d);
    for (const name of RESUME_DRAFT_EXCLUDE) {
      expect(parsedValues, `${name}은 parseResumeForm이 읽지 않는다 — 오타이거나 폐기된 필드`).toContain(
        `채움-${name}`,
      );
    }
  });

  it("민감 필드(주민번호·계좌·급여)를 빠짐없이 담는다", () => {
    for (const name of ["p_residentId", "c_account", "c_bank", "c_salaryMonthly", "c_salaryAnnual"]) {
      expect(RESUME_DRAFT_EXCLUDE).toContain(name);
    }
    // 경력 급여도 행마다 전부(행 수가 늘면 자동 확장돼야 한다).
    expect(RESUME_DRAFT_EXCLUDE).toContain("car_0_salary");
    expect(RESUME_DRAFT_EXCLUDE.filter((n) => n.endsWith("_salary"))).toHaveLength(CAREER_ROWS);
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
