// 퇴원·재원 복구가 공유하는 수강 정리의 DB 오류가 "이유"로 보이는지([[#137]]).
// 예전엔 원문(`conflicting key value violates exclusion constraint "enrollments_no_overlap"`)이 학생 상세에 그대로 떴다.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeActiveEnrollmentsClamped, reopenEnrollmentsClosedByWithdrawal } from "./enrollment-sync";
import { toKoreanDbError } from "@/features/enrollments/db-errors";

/** update(...).eq(...).eq(...)/is(...)/lte(...) 어디서 끝나도 같은 결과를 돌려주는 가짜 빌더. */
function fakeSupabase(result: { error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const k of ["update", "eq", "is", "lte", "gt", "select", "in"]) q[k] = () => q;
  q.then = (resolve: (v: unknown) => void) => resolve({ data: [], ...result });
  return { from: () => q } as never;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("재원 복구가 겹침(23P01)에 막히면 겹치는 수강이라고 말한다", async () => {
  const err = await reopenEnrollmentsClosedByWithdrawal(
    fakeSupabase({
      error: { code: "23P01", message: 'conflicting key value violates exclusion constraint "enrollments_no_overlap"' },
    }),
    "s1",
    "2026-09-01",
  );
  expect(err).toContain("기간이 겹치는 수강");
  expect(err).not.toMatch(/conflicting|exclusion|enrollments_no_overlap/);
  expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("students.enrollmentSync.reopen");
});

it("퇴원 수강 종료의 모르는 오류는 일반 문구(원문 비노출) + 에러 로그", async () => {
  const err = await closeActiveEnrollmentsClamped(
    fakeSupabase({ error: { code: "XX000", message: "could not serialize access" } }),
    "s1",
    "2026-09-01",
  );
  expect(err).toBe("수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  expect(JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0])).scope).toBe("students.enrollmentSync.closeActive");
});

it("수강 번역기: 특수 문구는 그대로, 나머지는 공용 판정(삭제된 반 23503) + scope 로그", () => {
  expect(toKoreanDbError({ code: "23P01", message: "x" }, "실패", "enrollments.assign")).toBe(
    "이미 이 반에 기간이 겹치는 수강이 있습니다.",
  );
  const missing = toKoreanDbError(
    { code: "23503", message: 'insert or update on table "enrollments" violates foreign key constraint "enrollments_class_id_classes_id_fk"' },
    "수강 배정에 실패했습니다.",
    "enrollments.assign",
  );
  expect(missing).toContain("연결하려는 항목을 찾을 수 없습니다");
  expect(String(vi.mocked(console.warn).mock.calls.at(-1)?.[0])).toContain("enrollments.assign");
  expect(toKoreanDbError({ code: "XX000", message: "boom" }, "수강 배정에 실패했습니다.")).toBe("수강 배정에 실패했습니다.");
});
