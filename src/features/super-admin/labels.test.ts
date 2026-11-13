import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { SYSTEM_ROLES } from "@/lib/permissions";
import {
  ASSIGNABLE_ROLES,
  AUDIT_ACTIONS,
  AUDIT_ACTION_OPTIONS,
  auditActionMeta,
  auditDetail,
  featureLabel,
  planLabel,
  planTone,
  userStatusMeta,
} from "./labels";

describe("슈퍼관리자 표시 어휘", () => {
  it("플랜: 알려진 키는 한글, 모르는 값은 적힌 그대로 · 유료만 positive", () => {
    expect(planLabel("free")).toBe("무료");
    expect(planLabel("PRO")).toBe("프로");
    expect(planLabel("custom-2026")).toBe("custom-2026");
    expect(planLabel("")).toBe("—");
    expect(planTone("free")).toBe("inert");
    expect(planTone("pro")).toBe("positive");
    expect(planLabel("demo")).toBe("데모");
    expect(planTone("demo")).toBe("inert");
    expect(planTone("custom-2026")).toBe("info");
  });

  it("계정 상태: 모르는 값이 원문으로 새지 않는다", () => {
    expect(userStatusMeta("active")).toEqual({ label: "활성", tone: "positive" });
    expect(userStatusMeta("weird").label).toBe("알 수 없음");
  });

  it("역할 선택지 = ROLE_LABEL과 같은 이름 · 학생 제외 · 직원 역할 전부", () => {
    for (const r of ASSIGNABLE_ROLES) expect(r.label).toBe(ROLE_LABEL[r.value]);
    expect(ASSIGNABLE_ROLES.map((r) => r.value).sort()).toEqual(SYSTEM_ROLES.filter((r) => r !== "student").sort());
  });

  it("감사 로그: audit.ts가 남기는 모든 조치에 라벨이 있고, 필터 선택지와 같다", () => {
    const src = readFileSync(join(process.cwd(), "src/features/super-admin/server/audit.ts"), "utf8");
    const union = src.match(/export type SuperAdminAction =([\s\S]*?);/)![1];
    const keys = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    expect(Object.keys(AUDIT_ACTIONS).sort()).toEqual(keys);
    expect(AUDIT_ACTION_OPTIONS.map((o) => o.value).sort()).toEqual(keys);
    expect(auditActionMeta("unknown_x")).toEqual({ label: "기타 조치", tone: "inert" });
  });

  it("감사 로그 상세는 한글 문장 — 영문 키·JSON·uuid가 새지 않는다", () => {
    const cases: [string, Record<string, unknown> | null][] = [
      ["create_tenant", { slug: "hanbit", masterEmail: "a@b.kr", plan: "free" }],
      ["update_tenant", { plan: "pro" }],
      ["impersonate_view", null],
      ["grant_license", { feature: "student_seats", maxSeats: 120 }],
      ["grant_license", { feature: "student_seats", maxSeats: null }],
      ["toggle_license", { feature: "ai_analysis", active: true }],
      ["change_user_role", { userId: "3f2a0c1e-0000-4000-8000-000000000000", role: "teacher" }],
      ["reset_user_password", { userId: "3f2a0c1e-0000-4000-8000-000000000000" }],
      ["set_user_active", { userId: "x", active: false }],
    ];
    for (const [action, meta] of cases) {
      const text = auditDetail(action, meta);
      expect(text, action).not.toMatch(/[{}"]|userId|maxSeats|student_seats|ai_analysis|teacher|3f2a0c1e/);
    }
    expect(auditDetail("grant_license", { feature: "student_seats", maxSeats: 120 })).toBe("재원생 좌석 최대 120석");
    expect(auditDetail("change_user_role", { role: "teacher" })).toBe("역할 → 강사");
    expect(auditDetail("toggle_license", { feature: "ai_analysis", active: false })).toBe("AI 분석 끔");
    expect(auditDetail("toggle_license", { feature: "slack", active: true, inboxSkipped: 3, outboxCancelled: 2, rulesReset: 4 })).toBe(
      "슬랙 알림 연결 켬 · 인박스 3건 건너뜀 · 발송 대기 2건 취소 · 규칙 4개 시작 시각 갱신",
    );
    expect(auditDetail("toggle_license", { feature: "slack", active: false })).toBe("슬랙 알림 연결 끔");
    expect(auditDetail("toggle_license", { feature: "slack", active: false, inboxSkipped: 0 })).toBe(
      "슬랙 알림 연결 끔 · 인박스 0건 건너뜀",
    );
    expect(featureLabel("nope")).toBe("기타 기능");
  });
});
