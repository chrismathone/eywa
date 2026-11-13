import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ adminCalls: 0 }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({
    id: "user",
    tenantId: "tenant",
    displayName: "담당자",
    systemRole: "teacher",
  }),
}));
vi.mock("@/features/owner/server/modules", () => ({ isModuleOnForTenant: async () => false }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => false }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    m.adminCalls += 1;
    throw new Error("꺼진 모듈에서 DB를 열면 안 됩니다");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addApprovalComment,
  confirmDeferredStep,
  decideDocument,
  deleteApprovalComment,
  withdrawDocument,
} from "./actions";

describe("전자결재 처리 액션의 모듈 게이트", () => {
  it("모듈이 꺼지면 결재·확인·회수·댓글을 DB 접근 전에 거절한다", async () => {
    const actions = [
      decideDocument,
      confirmDeferredStep,
      withdrawDocument,
      addApprovalComment,
      deleteApprovalComment,
    ];
    const results = await Promise.all(actions.map((action) => action(undefined, new FormData())));

    expect(results).toEqual(actions.map(() => ({ error: "전자결재 기능을 사용할 수 없습니다" })));
    expect(m.adminCalls).toBe(0);
  });
});
