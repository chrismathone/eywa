// explainDbError·logDbError의 로그(등급·scope·값 가림) — 2026-10-01, [[#138]].
import { afterEach, describe, expect, it, vi } from "vitest";
import { explainDbError, maskDbDetails } from "./db-error";

const FALLBACK = "저장에 실패했습니다. 잠시 후 다시 시도해주세요.";
const pg = (code: string, message: string, details = "") => ({ code, message, details, hint: "" });

describe("explainDbError — 로그", () => {
  afterEach(() => vi.restoreAllMocks());

  it("모르는 오류는 error로, scope·코드를 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = explainDbError(pg("XX000", "internal error"), { fallback: FALLBACK, scope: "students.create" });
    expect(info.message).toBe(FALLBACK);
    const line = JSON.parse(String(spy.mock.calls[0][0]));
    expect(line.scope).toBe("students.create");
    expect(line.supabase.code).toBe("XX000");
    expect(line.message).toBe("internal error");
  });

  it("입력 때문인 오류는 warn으로, details의 값(이름 등)은 가린다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    explainDbError(
      pg(
        "23505",
        'duplicate key value violates unique constraint "ux_students_active_natural_key"',
        "Key (tenant_id, name_normalized)=(t1, 홍길동) already exists.",
      ),
      { fallback: FALLBACK, scope: "students.update" },
    );
    expect(err).not.toHaveBeenCalled();
    const out = String(warn.mock.calls[0][0]);
    expect(out).toContain("ux_students_active_natural_key");
    expect(out).toContain("students.update");
    expect(out).not.toContain("홍길동");
  });

  it("오류 객체가 없으면(0행) 로그를 지어 남기지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(explainDbError(null, { fallback: FALLBACK, scope: "x" }).message).toBe(FALLBACK);
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("형식 오류는 에러 등급 + 원문 속 입력값을 가린다 · level:error는 입력 원인도 에러로", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    explainDbError(pg("22P02", 'invalid input syntax for type uuid: "홍길동"'), { fallback: FALLBACK, scope: "x.format" });
    const line = String(err.mock.calls[0]?.[0]);
    expect(line).toContain("x.format");
    expect(line).not.toContain("홍길동");
    explainDbError(pg("23503", 'update or delete on table "users" violates foreign key constraint "help_posts_author_id_fkey"'), {
      fallback: FALLBACK, scope: "staff.delete.users", op: "delete", level: "error",
    });
    expect(String(err.mock.calls[1]?.[0])).toContain("staff.delete.users");
  });

  it("maskDbDetails — 실패 행·키 값을 가리고 컬럼 이름은 남긴다", () => {
    expect(maskDbDetails("Failing row contains (1, 홍길동, 010-1234-5678).")).toBe("Failing row contains (…).");
    // 23P01 실제 모양 — daterange 값의 `[..)`가 괄호 짝을 깬다.
    expect(
      maskDbDetails(
        "Key (student_id, class_id, daterange(start_date, end_date))=(a, b, [2026-01-01,infinity)) conflicts with existing key (student_id, class_id, daterange(start_date, end_date))=(a, b, [2025-03-01,2026-02-01)).",
      ),
    ).toBe(
      "Key (student_id, class_id, daterange(start_date, end_date))=(…) conflicts with existing key (student_id, class_id, daterange(start_date, end_date))=(…).",
    );
    expect(maskDbDetails("Key (tenant_id, email)=(t1, a@b.c) already exists.")).toBe("Key (tenant_id, email)=(…) already exists.");
    expect(maskDbDetails('Key (id)=(u1) is still referenced from table "invoices".')).toBe(
      'Key (id)=(…) is still referenced from table "invoices".',
    );
    // 모르는 모양이면 값이 새지 않게 통째로 버린다.
    expect(maskDbDetails("Key (name)=(홍길동) something new")).toBe("(값 생략)");
  });
});
