import { describe, expect, it } from "vitest";
import { emptyResume } from "./resume";
import { buildRosterRow, firstEmptyRowIndex, ROSTER_COLUMNS, topEducation } from "./resume-roster";

function sample() {
  const d = emptyResume();
  d.personal.name = "홍길동";
  d.personal.email = "hong@example.com";
  d.personal.residentId = "900101-1234567";
  d.personal.phone = "010-1234-5678";
  d.education[0] = { period: "2010.03 ~ 2014.02", school: "한국대학교", major: "수학과", gpa: "4.0", location: "서울" };
  d.education[3] = { period: "2007.03 ~ 2010.02", school: "한국고등학교", major: "", gpa: "", location: "서울" };
  d.contract.company = "EIE인재원";
  d.contract.division = "수학과";
  d.contract.manager = "김담당";
  d.contract.employmentType = "정규직";
  d.contract.startDate = "2026-08-01";
  d.contract.salaryMonthly = "2,800,000원";
  d.contract.bank = "국민은행";
  d.contract.account = "123-456-789";
  return d;
}

describe("topEducation", () => {
  it("맨 위 실입력 학력 1건을 고른다(시트엔 최상위 학력만)", () => {
    expect(topEducation(sample())?.school).toBe("한국대학교");
  });

  it("첫 행이 비어 있으면 아래에서 첫 실입력 행으로 내려간다", () => {
    const d = sample();
    d.education[0] = { period: "", school: "  ", major: "", gpa: "", location: "" };
    expect(topEducation(d)?.school).toBe("한국고등학교");
  });

  it("학력이 전부 비면 null", () => {
    expect(topEducation(emptyResume())).toBeNull();
  });
});

describe("firstEmptyRowIndex", () => {
  const H = ["No.", "회사명"];
  it("헤더만 있으면 2행(헤더 바로 아래)", () => {
    expect(firstEmptyRowIndex([H])).toBe(2);
  });

  it("실측 시나리오: 중간 안내 블록(12행 헤더·13행 데이터)이 있어도 위쪽 첫 빈 행(2행)을 고른다", () => {
    // 1행 헤더, 2~11행 빈 행, 12행 안내용 헤더, 13행 데이터 — append였으면 14행으로 밀렸다.
    const rows: string[][] = [H, [], [], [], [], [], [], [], [], [], [], ["No.", "회사명"], ["", "곰돌이"]];
    expect(firstEmptyRowIndex(rows)).toBe(2);
  });

  it("헤더 아래가 차례로 차 있으면 그 다음 행", () => {
    expect(firstEmptyRowIndex([H, ["", "A사"], ["", "B사"]])).toBe(4);
  });

  it("공백만 있는 셀은 빈 행으로 본다", () => {
    expect(firstEmptyRowIndex([H, ["  ", " "]])).toBe(2);
  });
});

describe("buildRosterRow", () => {
  // 열 순서 계약 — 어긋나면 주민번호가 옆 열로 밀리는 식의 조용한 오기입이 된다.
  // (실사고 2026-07-17: 원장이 '계약조건 history' 열을 삭제했는데 앱이 옛 20열로 기입 → 학력이 은행 열로.)
  it("시트 헤더(A~T)와 같은 20칸을 만든다", () => {
    expect(buildRosterRow(sample())).toHaveLength(ROSTER_COLUMNS.length);
    expect(ROSTER_COLUMNS).toHaveLength(20);
  });

  it("각 값이 제 열에 들어간다(회사명·소속부서·이름·계약구분·입사일·메일·주민번호·전화·학력·은행·계좌)", () => {
    const row = buildRosterRow(sample());
    const col = (name: (typeof ROSTER_COLUMNS)[number]) => row[ROSTER_COLUMNS.indexOf(name)];
    expect(col("회사명")).toBe("EIE인재원");
    expect(col("소속부서")).toBe("수학과");
    expect(col("이름")).toBe("홍길동");
    expect(col("계약구분")).toBe("정규직");
    expect(col("입사일")).toBe("2026-08-01");
    expect(col("구글 메일 주소")).toBe("hong@example.com");
    expect(col("주민번호")).toBe("900101-1234567");
    expect(col("전화번호")).toBe("010-1234-5678");
    expect(col("계약조건")).toBe("월급 2,800,000원");
    expect(col("학력")).toBe("한국대학교\n수학과"); // 기존 명부 표기: 학교명 줄바꿈 전공
    expect(col("은행")).toBe("국민은행");
    expect(col("계좌번호")).toBe("123-456-789");
    expect(col("담당자")).toBe("김담당"); // T열 — 폼 '담당자' 배선(2026-07-17)
    // 이력서 서식에 없는 열은 빈 칸(시트 수기 관리).
    expect(col("No.")).toBe("");
    expect(col("직급")).toBe("");
    expect(col("재직")).toBe("");
  });

  it("월급·연봉이 둘 다 있으면 '월급 … / 연봉 …'으로 합친다", () => {
    const d = sample();
    d.contract.salaryAnnual = "4,000만원";
    const row = buildRosterRow(d);
    expect(row[ROSTER_COLUMNS.indexOf("계약조건")]).toBe("월급 2,800,000원 / 연봉 4,000만원");
  });

  // 실사고(2026-07-20): 연봉 칸에 "연봉"이라는 라벨 글자만 입력돼 시트에 "연봉 연봉"으로 두 번 찍힘.
  it("값에 라벨('월급'/'연봉')이 이미 적혀 있으면 떼고 조립 — 라벨만 있으면 빈 값 취급", () => {
    const d = sample();
    d.contract.salaryAnnual = "연봉"; // 라벨만 → 무의미한 입력
    expect(buildRosterRow(d)[ROSTER_COLUMNS.indexOf("계약조건")]).toBe("월급 2,800,000원");

    d.contract.salaryAnnual = "연봉 4,000만원"; // 라벨+값 → 한 번만
    expect(buildRosterRow(d)[ROSTER_COLUMNS.indexOf("계약조건")]).toBe("월급 2,800,000원 / 연봉 4,000만원");

    d.contract.salaryMonthly = "월급 300만원"; // 월급도 동일 가드
    d.contract.salaryAnnual = "";
    expect(buildRosterRow(d)[ROSTER_COLUMNS.indexOf("계약조건")]).toBe("월급 300만원");
  });

  it("빈 이력서도 20칸 빈 행으로 안전 변환(전공만 있고 학교명 없으면 학력도 빈 칸)", () => {
    const row = buildRosterRow(emptyResume());
    expect(row).toHaveLength(20);
    expect(row.every((v) => v === "")).toBe(true);
  });
});
