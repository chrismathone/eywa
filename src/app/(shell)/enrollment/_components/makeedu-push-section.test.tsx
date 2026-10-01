import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnpushedIntakeConsultation } from "@/features/integrations/server/makeedu-sync";

/**
 * 머리글 'makeedu 보내기'의 서버 섹션 — 게이트(`canPushToMakeedu`)를 못 지나면 **아무것도 그리지 않고 후보 조회도 안 한다**.
 * 페이지가 이미 같은 게이트로 걸렀지만, 이 섹션을 다른 자리에 꽂아도 조회가 새지 않게 여기서 한 번 더 본다.
 */
const g = vi.hoisted(() => ({
  user: { id: "u-1", tenantId: "t-1", systemRole: "master" } as null | { id: string; tenantId: string; systemRole: string },
  allowed: true,
  candidates: [] as UnpushedIntakeConsultation[],
}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => g.user }));
vi.mock("@/features/integrations/server/makeedu-push-access", () => ({ canPushToMakeedu: async () => g.allowed }));
vi.mock("@/features/integrations/server/makeedu-sync", () => ({
  getUnpushedIntakeConsultations: (...a: unknown[]) => query(...a),
}));
vi.mock("@/features/integrations/server/actions", () => ({ enqueueConsultationPush: vi.fn() }));

import { MakeeduPushSection } from "./makeedu-push-section";

afterEach(cleanup);
beforeEach(() => {
  g.user = { id: "u-1", tenantId: "t-1", systemRole: "master" };
  g.allowed = true;
  g.candidates = [];
  query.mockReset();
  query.mockImplementation(async () => g.candidates);
});

describe("MakeeduPushSection", () => {
  it("게이트를 못 지나면(권한 없음·모듈 꺼짐) 버튼도 조회도 없다", async () => {
    g.allowed = false;
    expect(await MakeeduPushSection()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("로그인이 없으면 아무것도 없다", async () => {
    g.user = null;
    expect(await MakeeduPushSection()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("통과하면 기존 후보 조회 결과로 버튼을 세운다", async () => {
    g.candidates = [
      {
        id: "a",
        prospectName: "가",
        prospectSchool: null,
        prospectGrade: null,
        parentName: null,
        parentPhone: null,
        subject: null,
        consultationPath: null,
        createdAt: "2026-09-28T03:00:00.000Z",
        outcome: "pending",
        pushStatus: null,
        pushError: null,
        note: null,
      },
    ];
    const el = await MakeeduPushSection();
    expect(query).toHaveBeenCalledOnce();
    render(el!);
    expect(screen.getByRole("button", { name: "makeedu 보내기 — 보낼 상담 1건" })).toBeEnabled();
  });
});
