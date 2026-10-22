import { describe, expect, it } from "vitest";
import { judgeBackfill, type BackfillConsultation, type ReferrerCandidate } from "./backfill";
const candidate = (overrides: Partial<ReferrerCandidate> = {}): ReferrerCandidate => ({ id: "referrer", name: "김민서", school: "가람초", grade: "초5",
  parentPhone: "01012345678", makeeduNo: "100", excluded: false, billMonths: ["2026-09"], enrollments: [], ...overrides });
const consultation = (overrides: Partial<BackfillConsultation> = {}): BackfillConsultation => ({ id: "consult", student_id: "new",
  prospect_name: "박서준", day: "2026-10-10", referrerName: "김민서", path: null, body: null, referrerStudentId: null, referrerStaffId: null, ...overrides });
describe("지난 소개 백필 가드", () => {
  it("유일한 이름·상담일 재원·소개 문맥·충돌 없음 모두 통과해야 자동", () => {
    const result = judgeBackfill(consultation(), [candidate()], []);
    expect(result.state).toBe("automatic");
    expect(result.guards).toHaveLength(5);
    expect(result.evidence).toBe("김민서");
  });
  it("알파벳까지 있어도 서로 다른 메이크에듀 번호면 자동 금지", () => {
    const result = judgeBackfill(consultation({ referrerName: "김민서A" }), [candidate({ name: "김민서A" }), candidate({ id: "other", name: "김민서B", makeeduNo: "200" })], []);
    expect(result.state).toBe("review");
    expect(result.reasons).toContain("동명이인 원생번호 충돌");
  });
  it("번호 충돌이 없어도 접미사 없는 이름은 동명이인을 고르지 않는다", () => {
    expect(judgeBackfill(consultation(), [candidate({ name: "김민서A", makeeduNo: null }), candidate({ id: "other", name: "김민서B", makeeduNo: null })], []).state).toBe("review");
  });
  it("본문 이름만·형제 이름만으로 연결하지 않는다", () => {
    expect(judgeBackfill(consultation({ referrerName: null, path: "인터넷", body: "김민서 형제" }), [candidate()], []).reasons).toContain("소개 문맥 확인 필요");
    expect(judgeBackfill(consultation({ referrerName: null, path: "지인 소개", body: "김민서 소개로 방문" }), [candidate()], []).state).toBe("automatic");
  });
  it("상담일 재원 근거, 본인, 직원 겹침, 명시된 학교·학년을 각각 막는다", () => {
    expect(judgeBackfill(consultation(), [candidate({ billMonths: [] })], []).reasons).toContain("상담일 재원 근거 없음");
    expect(judgeBackfill(consultation({ student_id: "referrer" }), [candidate()], []).reasons).toContain("본인 소개");
    expect(judgeBackfill(consultation(), [candidate()], ["김민서"]).reasons).toContain("직원 이름과 겹침");
    expect(judgeBackfill(consultation({ mentionedSchool: "다른초" }), [candidate()], []).reasons).toContain("소개자 학교·학년 불일치");
  });
  it("여러 후보, 기존 연결, 시험 학생을 자동으로 덮어쓰지 않는다", () => {
    expect(judgeBackfill(consultation({ referrerName: "김민서 이서연" }), [candidate(), candidate({ id: "other", name: "이서연" })], []).state).toBe("review");
    expect(judgeBackfill(consultation({ referrerStaffId: "teacher" }), [candidate()], []).state).toBe("linked");
    expect(judgeBackfill(consultation(), [candidate({ excluded: true })], []).state).toBe("review");
  });
  it("본문의 소개자 학교·학년이 다르면 자동 연결하지 않는다", () => {
    expect(judgeBackfill(consultation({ referrerName: "가람초 5학년 김민서" }), [candidate()], []).state).toBe("automatic");
    expect(judgeBackfill(consultation({ referrerName: "다른초 5학년 김민서" }), [candidate()], []).state).toBe("review");
    expect(judgeBackfill(consultation({ referrerName: "가람초 4학년 김민서" }), [candidate()], []).state).toBe("review");
  });
  it("긴 이름의 앞부분을 다른 원생 이름으로 연결하지 않는다", () => {
    expect(judgeBackfill(consultation({ referrerName: "김민서진 추천" }), [candidate()], []).state).toBe("review");
    expect(judgeBackfill(consultation({ referrerName: "김민서엄마" }), [candidate()], []).state).toBe("automatic");
  });
});
