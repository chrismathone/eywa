import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ before: {} as Record<string, unknown>, written: null as Record<string, unknown> | null, assignedCount: 0, allowed: true, conflict: false, log: vi.fn(), filters: [] as unknown[][] }));
vi.mock("./assigned-classes", () => ({ countAssignedClasses: async () => m.assignedCount }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "u1", tenantId: "t1", displayName: "직원", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
 let writing = false;
 const q = { select: () => q, eq: (...args: unknown[]) => { m.filters.push(args); return q; },
  update: (row: Record<string, unknown>) => { writing = true; m.written = row; return q; },
  single: async () => ({ data: m.before, error: null }),
  maybeSingle: async () => ({ data: writing ? (m.conflict ? null : { id: "c1" }) : m.before, error: null }),
 };
 return q;
} }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: (...args: unknown[]) => m.log(...args) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { schoolSaveAliases: [], subjects: [] } }) }));
vi.mock("@/features/schools/server/complete-kind", () => ({ completeSchoolKind: async (_c: unknown, _t: unknown, school: unknown) => school }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/assemblyai", () => ({ submitTranscript: vi.fn() }));
vi.mock("@/features/enrollment/server/consultation-analysis", () => ({ runConsultationAnalysis: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyClassAssignment: vi.fn() }));
import { buildConsultationRow } from "../consultation-form-row";
import { updateEnrollmentConsultation } from "./actions";

// 수정 화면을 연 때의 폼 값(editBase) — 화면이 마운트 직후 잡아 저장 때 함께 보낸다.
const opened = { id: "c1", prospectName: "김재윤", counselor: "", careerGoal: "", followUpDate: "", subjectDetails: "{}" };
const save = (changes: Record<string, string>, base: Record<string, string> | null = opened) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...opened, ...changes })) fd.set(k, v);
  if (base) fd.set("editBase", JSON.stringify(base));
  return updateEnrollmentConsultation(undefined, fd);
};
beforeEach(() => {
  // DB의 지금 값 = 화면을 연 뒤 다른 사람이 상담자·다음 상담일·영어 결과를 저장했다(김재윤 상담 10-26 16:01).
  m.before = {
    ...buildConsultationRow({ prospectName: "김재윤" }, []),
    counselor: "박소선", follow_up_date: "2026-10-26", subject_details: { english: { aiGradeLevel: "1111" } },
    from_public_intake: true, outcome: "consulted", updated_at: "2026-10-26T07:01:39Z", learning_history: null,
  };
  m.written = null; m.assignedCount = 0; m.allowed = true; m.conflict = false; m.log.mockReset(); m.filters = [];
});

describe("동시 수정 — 이 사람이 바꾼 칸만 저장(원장 2026-10-26)", () => {
  it("먼저 열어 둔 화면으로 저장해도 다른 사람이 저장한 상담자·다음 상담일·과목 상담을 덮지 않는다", async () => {
    expect(await save({ careerGoal: "의사", followUpResult: "consulted" })).toEqual({ ok: true });
    expect(m.written).toMatchObject({ career_goal: "의사" });
    for (const col of ["counselor", "follow_up_date", "subject_details", "prospect_name", "parent_request", "outcome"]) {
      expect(m.written).not.toHaveProperty(col);
    }
  });

  it("과목 상담은 과목·칸 단위로 합친다 — 남이 넣은 영어 결과 + 내가 넣은 수학 메모", async () => {
    await save({ followUpResult: "consulted", subjectDetails: JSON.stringify({ math: { consultationHistory: "메모" } }) });
    expect(m.written?.subject_details).toEqual({ english: { aiGradeLevel: "1111" }, math: { consultationHistory: "메모" } });
  });

  it("내가 비운 칸은 비운다 — 바꾼 것이니까", async () => {
    await save({ counselor: "", followUpResult: "consulted" }, { ...opened, counselor: "박소선" });
    expect(m.written).toHaveProperty("counselor", null);
  });

  it("후속 조치를 안 바꿨는데 그사이 다른 사람이 등록 완료로 옮겼으면 되돌리지 않고 저장한다", async () => {
    m.before = { ...m.before, outcome: "enrolled" };
    const base = { ...opened, followUpResult: "consulted", followUpDate: "2026-10-30" };
    expect(await save({ careerGoal: "의사", followUpResult: "consulted", followUpDate: "2026-10-30" }, base)).toEqual({ ok: true });
    expect(m.written).not.toHaveProperty("outcome");
    expect(m.written).not.toHaveProperty("follow_up_date");
  });

  it("안 바꾼 지난 날짜는 '지났다'로 막지 않는다 — 그사이 다른 사람이 옮긴 날짜를 본다", async () => {
    const base = { ...opened, followUpResult: "consulted", followUpDate: "2026-10-01" };
    expect(await save({ careerGoal: "의사", followUpResult: "consulted", followUpDate: "2026-10-01" }, base)).toEqual({ ok: true });
    expect(m.written).not.toHaveProperty("follow_up_date");
  });

  it("editBase가 없으면(배포 전에 열린 화면) 종전처럼 전체를 쓴다", async () => {
    await save({ careerGoal: "의사", followUpResult: "consulted" }, null);
    expect(m.written).toHaveProperty("counselor", null);
    expect(m.written).toHaveProperty("subject_details", {});
  });
});
