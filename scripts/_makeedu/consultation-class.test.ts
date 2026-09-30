import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 워커가 CommonJS라 판정 원천이 .cjs다(앱도 같은 파일을 import한다).
const require_ = createRequire(import.meta.url);
const { resolveConsultationClass, keepManualClass, tallyClassReasons, CLASS_REASON_LABEL } =
  require_("./consultation-class.cjs");

const labels = { math: "수학", english: "영어", science: "과학" };
const mathA = { classId: "c-math-a", className: "M1", subject: "math", teacherIds: ["t-kim"] };
const engB = { classId: "c-eng-b", className: "E1", subject: "english", teacherIds: ["t-lee", "t-kim"] };
const engC = { classId: "c-eng-c", className: "E2", subject: "english", teacherIds: ["t-park"] };

describe("원생상담 반 매핑 판정", () => {
  it("상담사가 없으면 미매핑", () => {
    expect(resolveConsultationClass({ counselorId: null, candidates: [mathA], labels })).toEqual({ classId: null, reason: "no_counselor" });
  });

  it("그날 수강 반이 없으면 미매핑", () => {
    expect(resolveConsultationClass({ counselorId: "t-kim", candidates: [], labels })).toEqual({ classId: null, reason: "no_enrollment" });
  });

  it("상담사가 가르치는 반이 없으면(관리자 등) 미매핑", () => {
    expect(resolveConsultationClass({ counselorId: "admin-1", candidates: [mathA, engC], labels }).reason).toBe("not_teaching");
  });

  it("가르치는 반이 하나면 그 반", () => {
    expect(resolveConsultationClass({ counselorId: "t-park", candidates: [mathA, engC], labels })).toEqual({ classId: "c-eng-c", reason: "matched" });
  });

  it("가르치는 반이 둘이면 미매핑, 상담 과목으로 하나가 되면 그 반", () => {
    expect(resolveConsultationClass({ counselorId: "t-kim", candidates: [mathA, engB], labels }).reason).toBe("ambiguous");
    expect(resolveConsultationClass({ counselorId: "t-kim", subject: "수학", candidates: [mathA, engB], labels }).classId).toBe("c-math-a");
    // 키로 적혀 있어도 같다(저장값은 라벨·키가 섞여 있다).
    expect(resolveConsultationClass({ counselorId: "t-kim", subject: "english", candidates: [mathA, engB], labels }).classId).toBe("c-eng-b");
  });

  it("상담 과목과 맞는 반이 없으면 미매핑(가르치는 반이 있어도 과목이 다르면 붙이지 않는다)", () => {
    expect(resolveConsultationClass({ counselorId: "t-park", subject: "수학", candidates: [mathA, engC], labels }).reason).toBe("subject_mismatch");
    expect(resolveConsultationClass({ counselorId: "t-park", subject: "과학", candidates: [engC], labels }).reason).toBe("subject_mismatch");
  });

  it("설정 과목이 아닌 자유 입력 과목은 좁히지 않는다", () => {
    expect(resolveConsultationClass({ counselorId: "t-park", subject: "진로", candidates: [engC], labels }).classId).toBe("c-eng-c");
  });

  it("같은 반 후보가 두 번 와도 하나로 센다(수강 두 줄)", () => {
    expect(resolveConsultationClass({ counselorId: "t-park", candidates: [engC, { ...engC }], labels }).classId).toBe("c-eng-c");
  });

  it("담당 목록이 비었거나 없는 후보는 가르치는 사람이 없는 반이다", () => {
    expect(resolveConsultationClass({ counselorId: "t-park", candidates: [{ classId: "x", subject: "math", teacherIds: null }], labels }).reason).toBe("not_teaching");
  });

  it("사람이 고른 값(manual)은 자동 판정이 덮지 않는다 — '미매핑'을 고른 것도", () => {
    expect(keepManualClass({ stored: { classId: null, source: "manual" }, judged: { classId: "c-eng-c" } })).toEqual({ classId: null, source: "manual" });
    expect(keepManualClass({ stored: { classId: "c-math-a", source: "manual" }, judged: { classId: null } })).toEqual({ classId: "c-math-a", source: "manual" });
    expect(keepManualClass({ stored: { classId: "c-math-a", source: "auto" }, judged: { classId: null } })).toEqual({ classId: null, source: "auto" });
    expect(keepManualClass({ stored: null, judged: { classId: "c-eng-c" } })).toEqual({ classId: "c-eng-c", source: "auto" });
  });

  it("이유별 건수는 한글 라벨로 센다", () => {
    expect(tallyClassReasons([{ reason: "matched" }, { reason: "matched" }, { reason: "not_teaching" }])).toEqual({
      [CLASS_REASON_LABEL.matched]: 2,
      [CLASS_REASON_LABEL.not_teaching]: 1,
    });
  });
});

/**
 * 후보를 읽는 SQL은 두 벌이다 — 워커·백필(consultation-class.cjs `loadClassCandidates`)과 앱(0318a RPC).
 * 한쪽만 고치면 같은 상담이 화면과 동기화에서 다른 반으로 붙는다. 조건 줄을 공백만 무시하고 대조한다.
 */
describe("반 후보 SQL 두 벌이 같은 조건을 쓴다", () => {
  const squash = (s: string) => s.replace(/\$\{tenantId\}|auth_tenant_id\(\)/g, "T").replace(/\s+/g, " ");
  const worker = squash(readFileSync(join(process.cwd(), "scripts/_makeedu/consultation-class.cjs"), "utf8"));
  const rpc = squash(
    readFileSync(join(process.cwd(), "supabase/migrations/0318a_student_consultation_class.sql"), "utf8"),
  );
  const conditions = [
    "cs.tenant_id = T and cs.class_id = cl.id and cs.teacher_id is not null",
    "cs.valid_from <= x.d and (cs.valid_to is null or cs.valid_to >= x.d)",
    "join enrollments e on e.tenant_id = T and e.student_id = x.sid",
    "and e.start_date <= x.d",
    "(e.end_date is null or e.end_date > x.d or (e.end_date = x.d and not coalesce(e.is_transferred, false)))",
    "join classes cl on cl.id = e.class_id and cl.tenant_id = T",
    "and (cl.closed_at is null or cl.closed_at >= x.d)",
    "array_remove(array_cat(array[cl.teacher_id],",
  ];
  for (const c of conditions) {
    it(c, () => {
      expect(worker).toContain(c);
      expect(rpc).toContain(c);
    });
  }
});
