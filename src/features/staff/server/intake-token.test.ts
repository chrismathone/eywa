import { beforeEach, describe, expect, it, vi } from "vitest";

// 직원 등록 QR 공개 조회 — 🔴 역할은 행에 적힌 값을 믿지 않는다(보안 감사 2026-09-29).
// academy_documents는 학원 구성원이 PostgREST로 직접 insert할 수 있어, 강사·학생이 role:'master' 토큰 행을
// 스스로 만들어 원장 계정을 찍어낼 수 있었다.

let row: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/admin", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { createAdminClient: () => ({ from: () => chain }) };
});

import { findIntakeTokenByToken, STAFF_INTAKE_ROLE } from "../intake/server/intake-token";

const TOKEN = "a".repeat(32);

describe("findIntakeTokenByToken", () => {
  beforeEach(() => {
    row = null;
  });

  it("행에 role:'master'가 적혀 있어도 강사 역할로 돌려준다", async () => {
    row = {
      id: "doc-1",
      tenant_id: "tenant-1",
      created_at: "2026-09-29T00:00:00Z",
      form_data: { token: TOKEN, role: "master", active: true },
    };
    const tok = await findIntakeTokenByToken(TOKEN);
    expect(tok?.role).toBe(STAFF_INTAKE_ROLE);
    expect(tok?.role).toBe("teacher");
    expect(tok?.tenantId).toBe("tenant-1");
  });

  it("짧은 토큰·없는 행은 null", async () => {
    expect(await findIntakeTokenByToken("short")).toBeNull();
    expect(await findIntakeTokenByToken(TOKEN)).toBeNull();
  });
});
