import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 반 후보 RPC는 **집합을 돌려주는 함수**라 PostgREST max-rows(1,000)에 에러 없이 잘린다([[#54]]) — 잘린 꼬리의 상담은
 * "그날 수강 반 없음"으로 판정돼 '미매핑(자동)'으로 굳고 다시는 판정되지 않는다. 그래서 쌍을 나눠 묻고, 그래도 한도에 닿으면 쪼갠다.
 */
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

const pairsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ studentId: `s${i}`, date: "2026-09-30" }));
const rowFor = (studentId: string, k = 0) => ({
  student_id: studentId,
  on_date: "2026-09-30",
  class_id: `c-${studentId}-${k}`,
  class_name: "반",
  subject: "math",
  teacher_ids: ["t1"],
});

async function load() {
  vi.resetModules();
  return import("./class-support");
}

describe("loadClassCandidatesRpc — 1,000행 절단 방지", () => {
  // 🔴 값을 돌려주지 말 것 — beforeEach가 함수를 돌려주면 vitest가 그걸 **뒷정리 함수로 부른다**(목이 인자 없이 한 번 더 불린다).
  beforeEach(() => {
    rpc.mockReset();
  });

  it("쌍이 많으면 120쌍씩 나눠 묻고 결과를 합친다", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_student_ids: string[] }) => ({
      data: args.p_student_ids.map((id) => rowFor(id)),
      error: null,
    }));
    const { loadClassCandidatesRpc } = await load();
    const out = await loadClassCandidatesRpc(pairsOf(300));
    expect(rpc).toHaveBeenCalledTimes(3);
    for (const call of rpc.mock.calls) expect((call[1] as { p_student_ids: string[] }).p_student_ids.length).toBeLessThanOrEqual(120);
    expect(out?.size).toBe(300);
    expect(out?.get("s299|2026-09-30")?.[0]?.classId).toBe("c-s299-0");
  });

  it("한 번의 응답이 1,000행에 닿으면 쌍을 반으로 쪼개 다시 묻는다(잘린 채 쓰지 않는다)", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_student_ids: string[] }) => {
      // 쌍마다 10행 — 120쌍이면 1,200행이라 서버가 1,000행에서 자른다.
      const rows = args.p_student_ids.flatMap((id) => Array.from({ length: 10 }, (_, k) => rowFor(id, k)));
      return { data: rows.slice(0, 1000), error: null };
    });
    const { loadClassCandidatesRpc } = await load();
    const out = await loadClassCandidatesRpc(pairsOf(120));
    expect(rpc).toHaveBeenCalledTimes(3); // 120쌍(잘림) → 60 + 60
    expect(out?.size).toBe(120);
    // 꼬리 학생도 열 줄을 다 받았다.
    expect(out?.get("s119|2026-09-30")).toHaveLength(10);
  });

  it("함수가 아직 없으면(0318a 전) null — 빈 Map으로 '전부 미매핑'을 만들지 않는다", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.consultation_class_candidates(p_dates, p_student_ids) in the schema cache" },
    });
    const { loadClassCandidatesRpc } = await load();
    expect(await loadClassCandidatesRpc(pairsOf(3))).toBeNull();
  });

  it("함수는 있는데 실패하면 던진다(조용히 빈 결과를 주지 않는다)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const { loadClassCandidatesRpc } = await load();
    await expect(loadClassCandidatesRpc(pairsOf(3))).rejects.toThrow("반 후보 조회 실패");
  });
});

describe("isMissingClassSchema — 0318a가 없을 때의 오류만 삼킨다", () => {
  it("실제 PostgREST 오류 모양(2026-09-30 운영 실측)을 알아본다", async () => {
    const { isMissingClassSchema } = await load();
    expect(isMissingClassSchema({ code: "42703", message: "column student_consultations.class_id does not exist" })).toBe(true);
    expect(
      isMissingClassSchema({
        code: "PGRST200",
        message: "Could not find a relationship between 'student_consultations' and 'classes' in the schema cache",
        details: "Searched for a foreign key relationship between 'student_consultations' and 'classes' using the hint 'student_consultations_class_id_fkey'",
      }),
    ).toBe(true);
    expect(isMissingClassSchema({ code: "PGRST202", message: "Could not find the function public.consultation_stats(p_category, p_counselor) in the schema cache" })).toBe(true);
  });

  it("남의 칸이 없다는 오류는 이 칸 탓으로 삼키지 않는다", async () => {
    const { isMissingClassSchema } = await load();
    expect(isMissingClassSchema({ code: "42703", message: "column student_consultations.some_other_column does not exist" })).toBe(false);
    expect(isMissingClassSchema({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingClassSchema(null)).toBe(false);
  });
});
