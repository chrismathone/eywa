import { describe, expect, it } from "vitest";
import {
  canonicalEventTitle,
  consultationBasesInTitles,
  matchAdmissionsConsultation,
  type AdmissionsConsultationCandidate,
} from "./admissions-consultation-link";
import { schoolGradeKey } from "./admissions-class-link";

const c = (over: Partial<AdmissionsConsultationCandidate> & { id: string; name: string }): AdmissionsConsultationCandidate => ({
  school: null,
  grade: null,
  phoneDigits: null,
  studentId: null,
  studentName: null,
  consultedOn: "2026-09-12",
  ...over,
});
const notNames = ["영어", "수학", "과학", "국어"];

describe("matchAdmissionsConsultation — 일정 줄 ↔ 콜&상담", () => {
  it("전유솔: 상담이 나중에 생겨도 이름·날짜로 한 건이면 붙는다 — 보호자 번호가 제목과 달라도 떨어뜨리지 않는다(엄마·아빠 번호)", () => {
    const event = { title: "[대표] 영수입테 전유솔(달성초4) 010-3558-2749", startDate: "2026-09-12" };
    expect(matchAdmissionsConsultation(event, [], notNames)).toBeNull(); // 상담 전 — 링크 없음
    const later = [c({ id: "yusol", name: "전유솔", school: "달성초", grade: "초4", phoneDigits: "01000001232" })];
    expect(matchAdmissionsConsultation(event, later, notNames)).toEqual({ id: "yusol", name: "전유솔" });
  });
  it("김근우: 제목엔 접미사 없는 이름 · 상담·원생은 '김근우A' → 그 상담으로, 이름은 정식 이름", () => {
    const event = { title: "수학입테 김근우(일중1) 010-4666-2769", startDate: "2026-09-10" };
    const rows = [
      c({ id: "new", name: "김근우A", school: "대구일중", grade: "중1", phoneDigits: "01046662769", studentId: "sA", studentName: "김근우A", consultedOn: "2026-09-10" }),
      c({ id: "old", name: "김근우", school: "달산초", grade: "6", phoneDigits: "01000003798", studentId: "s0", studentName: "김근우", consultedOn: "2026-02-22" }), // 60일 밖
    ];
    expect(matchAdmissionsConsultation(event, rows, notNames)).toEqual({ id: "new", name: "김근우A" });
    const inWindow = [rows[0], { ...rows[1], consultedOn: "2026-08-20" }]; // 옛 상담이 창 안이어도 학교 모순·번호가 가른다
    expect(matchAdmissionsConsultation(event, inWindow, notNames)?.id).toBe("new");
  });
  it("🔴 동명이인(원생 표에 이 아이 말고 같은 이름)이면 창 안 상담이 한 명이어도 직접 증거(번호 또는 이 아이만 맞는 학교)가 있어야 붙는다", () => {
    const k = schoolGradeKey("대구일중", "중1");
    const families = new Map([["김근우", [{ studentId: "s0", key: k }, { studentId: "sA", key: k }]]]);
    const rows = [c({ id: "A", name: "김근우A", school: "대구일중", grade: "중1", phoneDigits: "01046662769", studentId: "sA", studentName: "김근우A", consultedOn: "2026-09-10" })];
    // 원래 원생 김근우의 레벨테스트 — 번호 없음, 학교·학년도 둘이 같다 → 김근우A로 바꾸면 거짓
    expect(matchAdmissionsConsultation({ title: "영어 레벨테스트 김근우 일중1", startDate: "2026-09-15" }, rows, notNames, { families })).toBeNull();
    // 제목 번호가 김근우A 상담 번호 → 붙는다
    expect(matchAdmissionsConsultation({ title: "수학입테 김근우(일중1) 010-4666-2769", startDate: "2026-09-10" }, rows, notNames, { families })?.name).toBe("김근우A");
    // 다른 동명이인이 다른 학교면 학교 힌트가 증거가 된다
    const split = new Map([["김근우", [{ studentId: "s0", key: schoolGradeKey("달산초", "초6") }, { studentId: "sA", key: k }]]]);
    expect(matchAdmissionsConsultation({ title: "영어 레벨테스트 김근우 일중1", startDate: "2026-09-15" }, rows, notNames, { families: split })?.id).toBe("A");
    // 원생 표에 이 아이뿐이면 동명이인이 아니다
    expect(matchAdmissionsConsultation({ title: "영어 레벨테스트 김근우 일중1", startDate: "2026-09-15" }, rows, notNames, { families: new Map([["김근우", [{ studentId: "sA", key: k }]]]) })?.id).toBe("A");
  });
  it("🔴 원생 연결 없는 아이는 원생 표에 없다 — 같은 이름 원생이 한 명만 있어도 동명이인이고, 그 원생과 같은 학교면 학교는 증거가 아니다", () => {
    const k = schoolGradeKey("대구일중", "중1");
    const qr = [c({ id: "qr", name: "김근우", school: "대구일중", grade: "중1", phoneDigits: "01055556666", consultedOn: "2026-09-11" })];
    const one = new Map([["김근우", [{ studentId: "s0", key: k }]]]);
    expect(matchAdmissionsConsultation({ title: "영어입테 김근우 일중1", startDate: "2026-09-12" }, qr, notNames, { families: one })).toBeNull();
    const two = new Map([["김근우", [{ studentId: "s0", key: k }, { studentId: "sB", key: schoolGradeKey("달산초", "초6") }]]]);
    expect(matchAdmissionsConsultation({ title: "입테 김근우 일중1", startDate: "2026-09-12" }, qr, notNames, { families: two })).toBeNull();
    expect(matchAdmissionsConsultation({ title: "영어입테 김근우 일중1 010-5555-6666", startDate: "2026-09-12" }, qr, notNames, { families: one })?.id).toBe("qr");
    // 같은 이름 원생이 없으면(전유솔처럼) 연결 없는 상담도 그대로 붙는다
    expect(matchAdmissionsConsultation({ title: "영어입테 김근우 일중1", startDate: "2026-09-12" }, qr, notNames, { families: new Map() })?.id).toBe("qr");
  });
  it("🔴 후보가 한 명이어도 제목의 학교·학년과 모순이면 안 붙인다 — 번호만 다른 건 모순이 아니다", () => {
    const event = { title: "수학입테 김근우(일중1) 010-4666-2769", startDate: "2026-09-10" };
    const other = [c({ id: "old", name: "김근우", school: "달산초", grade: "6", phoneDigits: "01000003798", studentId: "sB", studentName: "김근우B", consultedOn: "2026-08-20" })];
    expect(matchAdmissionsConsultation(event, other, notNames)).toBeNull();
    expect(matchAdmissionsConsultation(event, [c({ id: "blank", name: "김근우", phoneDigits: "01000003798" })], notNames)?.id).toBe("blank");
    // 실데이터 재현(리뷰): 7/28 '이태경 영수 레테 (침산초5)'가 다른 이태경(대구일중 중2) 상담에 붙던 것
    expect(
      matchAdmissionsConsultation(
        { title: "[정유진,허은진] 이태경 영수 레테 (침산초5)", startDate: "2026-07-28" },
        [c({ id: "other", name: "이태경", school: "대구일중", grade: "중2", studentId: "sT", studentName: "이태경", consultedOn: "2026-07-09" })],
        notNames,
      ),
    ).toBeNull();
  });
  it("모순으로 다른 아이를 뺐으면 남은 쪽도 번호나 학교가 실제로 맞아야 한다(학교 빈 칸은 증거가 아니다) · 학교급을 모르는 상담은 모순이 아니다", () => {
    const rows = [c({ id: "B", name: "김민준", school: "성남초", grade: "초2" }), c({ id: "C", name: "김민준", phoneDigits: "01012345678" })];
    expect(matchAdmissionsConsultation({ title: "영어입테 김민준(달성초4)", startDate: "2026-09-12" }, rows, notNames)).toBeNull();
    expect(matchAdmissionsConsultation({ title: "영어입테 김민준(달성초4) 010-1234-5678", startDate: "2026-09-12" }, rows, notNames)?.id).toBe("C");
    const noLevel = [c({ id: "L", name: "김지유", school: "칠성", grade: "5" })];
    expect(matchAdmissionsConsultation({ title: "수학입테 김지유 칠성초5", startDate: "2026-09-12" }, noLevel, notNames)?.id).toBe("L");
  });
  it("동명이인을 번호·학교로도 못 가르면 연결하지 않는다", () => {
    const event = { title: "영어입테 김민준", startDate: "2026-09-12" };
    const rows = [c({ id: "a", name: "김민준", school: "달산초", grade: "초1" }), c({ id: "b", name: "김민준", school: "성남초", grade: "초2" })];
    expect(matchAdmissionsConsultation(event, rows, notNames)).toBeNull();
    expect(matchAdmissionsConsultation({ ...event, title: "영어입테 김민준(성남초2)" }, rows, notNames)?.id).toBe("b");
  });
  it("같은 아이의 거듭 접수(연결 없음 · 이름·학교·학년 같음)는 한 사람 — 번호가 달라도 가장 최근 상담으로", () => {
    const event = { title: "수학입테 우지윤(달성초6)", startDate: "2026-09-12" };
    const rows = [
      c({ id: "first", name: "우지윤", school: "달성초", grade: "초6", phoneDigits: "01011112222", consultedOn: "2026-09-01" }),
      c({ id: "again", name: "우지윤", school: "달성초", grade: "초6", phoneDigits: "01033334444", consultedOn: "2026-09-05" }),
    ];
    expect(matchAdmissionsConsultation(event, rows, notNames)?.id).toBe("again");
  });
  it("같은 원생의 상담 둘은 학교 표기가 달라도 한 아이 · 🔴 연결 없는 상담은 같은 이름·학교·학년이어도 원생 쪽에 합치지 않는다(0258a가 일부러 남긴 동명이인일 수 있다)", () => {
    const event = { title: "수학입테 우지윤(달성초6)", startDate: "2026-09-12" };
    const sameStudent = [
      c({ id: "full", name: "우지윤", school: "달성초", grade: "초6", studentId: "s1", studentName: "우지윤", consultedOn: "2026-09-01" }),
      c({ id: "blank", name: "우지윤", studentId: "s1", studentName: "우지윤", consultedOn: "2026-09-03" }),
    ];
    expect(matchAdmissionsConsultation(event, sameStudent, notNames)?.id).toBe("blank");
    const withLoose = [...sameStudent, c({ id: "loose", name: "우지윤", school: "달성초", grade: "초6", consultedOn: "2026-09-05" })];
    expect(matchAdmissionsConsultation(event, withLoose, notNames)).toBeNull();
  });
  it("학교가 빈 연결 없는 상담끼리는 번호가 같을 때만 한 아이 — 빈 칸은 같음의 증거가 아니다", () => {
    const event = { title: "영어입테 김민준 010-1111-2222", startDate: "2026-09-12" };
    const rows = [
      c({ id: "match", name: "김민준", phoneDigits: "01011112222", consultedOn: "2026-09-01" }),
      c({ id: "newer", name: "김민준", phoneDigits: "01099998888", consultedOn: "2026-09-10" }),
    ];
    expect(matchAdmissionsConsultation(event, rows, notNames)?.id).toBe("match");
  });
  it("같은 이름·학교·학년 원생이 둘(중복 등록)이면 번호가 가른다", () => {
    const event = { title: "[대표님] 수학입테 김지유 칠성초5 01067684624", startDate: "2026-09-10" };
    const rows = [
      c({ id: "A", name: "김지유", school: "칠성", grade: "초5", phoneDigits: "01067684624", studentId: "sA", studentName: "김지유A" }),
      c({ id: "B", name: "김지유", school: "칠성", grade: "초5", phoneDigits: "01099990000", studentId: "sB", studentName: "김지유B" }),
      c({ id: "loose", name: "김지유", school: "칠성", grade: "초5" }),
    ];
    expect(matchAdmissionsConsultation(event, rows, notNames)).toEqual({ id: "A", name: "김지유A" });
  });
  it("제목 앞 [담당자] 괄호의 직원 이름·과목 낱말·'어머니·영어문의' 같은 칸·부분 일치·취소 일정은 걸리지 않는다", () => {
    const staff = [c({ id: "staff", name: "정유진" }), c({ id: "kid", name: "우다인", school: "달성초", grade: "초3" })];
    expect(matchAdmissionsConsultation({ title: "[정유진] 영어입테 우다인(달성초3)", startDate: "2026-09-12" }, staff, notNames)?.id).toBe("kid");
    const junk = [c({ id: "q", name: "영어문의" }), c({ id: "s", name: "영어" }), c({ id: "m", name: "어머니" }), c({ id: "t", name: "첫수업" }), c({ id: "u", name: "미정" }), c({ id: "v", name: "영수입테" }), c({ id: "w", name: "박지율동생" })];
    expect(matchAdmissionsConsultation({ title: "영어 입테 어머니 영어문의 첫수업 미정 영수입테 박지율동생 상담", startDate: "2026-09-12" }, junk, notNames)).toBeNull();
    expect(matchAdmissionsConsultation({ title: "수학입테 김지우현", startDate: "2026-09-12" }, [c({ id: "x", name: "김지우" })], notNames)).toBeNull();
    expect(matchAdmissionsConsultation({ title: "취소 수학입테 우다인", startDate: "2026-09-12" }, staff, notNames)).toBeNull();
  });
  it("상담 이름은 접미사 없이 적혔고 원생·제목이 '김근우A'여도 잇는다", () => {
    const rows = [c({ id: "k", name: "김근우", studentId: "sA", studentName: "김근우A" })];
    expect(matchAdmissionsConsultation({ title: "수학 첫 수업 김근우A 일중1", startDate: "2026-09-14" }, rows, notNames)).toEqual({ id: "k", name: "김근우A" });
  });
  it("창 하한은 서버가 받아 온 첫날(since)보다 앞으로 넓어지지 않는다", () => {
    const rows = [c({ id: "x", name: "우다인", consultedOn: "2026-07-20" })];
    const event = { title: "영어입테 우다인", startDate: "2026-09-01" }; // 일정 기준 60일 전 = 7/3
    expect(matchAdmissionsConsultation(event, rows, notNames)?.id).toBe("x");
    expect(matchAdmissionsConsultation(event, rows, notNames, { since: "2026-08-01" })).toBeNull();
  });
});

describe("consultationBasesInTitles — 동명이인 가족을 조회할 이름", () => {
  it("일정 제목에 걸린 상담의 접미사 뗀 이름만(취소 일정·직원 괄호 제외)", () => {
    const rows = [c({ id: "1", name: "김근우A", studentName: "김근우A" }), c({ id: "2", name: "정유진" }), c({ id: "3", name: "우다인" })];
    const bases = consultationBasesInTitles(
      [{ title: "수학 첫 수업 김근우 일중1" }, { title: "[정유진] 영어입테" }, { title: "취소 영어입테 우다인" }],
      rows,
      notNames,
    );
    expect(bases).toEqual(["김근우"]);
  });
});

describe("canonicalEventTitle — 제목의 이름 하나만 정식 이름으로", () => {
  it("접미사 없는 이름을 연결된 원생의 정식 이름으로 바꾼다(괄호·공백 뒤 모두)", () => {
    expect(canonicalEventTitle("수학 첫 수업 김근우 일중1 (월, 수, 목 6:20 ~ 윤하T)", "김근우A")).toBe(
      "수학 첫 수업 김근우A 일중1 (월, 수, 목 6:20 ~ 윤하T)",
    );
    expect(canonicalEventTitle("수학입테 김근우(일중1) 010-0000-0000", "김근우A")).toBe("수학입테 김근우A(일중1) 010-0000-0000");
  });
  it("[담당자] 괄호 안의 같은 이름은 건드리지 않고 그 밖의 첫 낱말만 바꾼다", () => {
    expect(canonicalEventTitle("[김근우] 수학 첫 수업 김근우 일중1", "김근우A")).toBe("[김근우] 수학 첫 수업 김근우A 일중1");
    // 괄호 바로 뒤에 붙은 이름은 괄호 밖이다(앞 글자가 ']')
    expect(canonicalEventTitle("[대표]김근우 수학 첫 수업", "김근우A")).toBe("[대표]김근우A 수학 첫 수업");
  });
  it("이미 정식 이름이거나, 정식 이름에 접미사가 없거나, 모르면 원문 그대로 · 부분 일치는 안 바꾼다", () => {
    expect(canonicalEventTitle("수학 첫 수업 김근우A", "김근우A")).toBe("수학 첫 수업 김근우A");
    expect(canonicalEventTitle("[대표] 영수입테 전유솔(달성초4)", "전유솔")).toBe("[대표] 영수입테 전유솔(달성초4)");
    expect(canonicalEventTitle("수학 첫 수업 김근우", null)).toBe("수학 첫 수업 김근우");
    expect(canonicalEventTitle("수학 첫 수업 김지우현", "김지우A")).toBe("수학 첫 수업 김지우현");
  });
});
