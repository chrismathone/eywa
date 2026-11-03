import { describe, expect, it } from "vitest";
import { billingWriters, type DeskStaffRow } from "./desk-staff";
import type { TenantSettings } from "@/features/owner/settings-types";

const row = (id: string, role: string, name = id): DeskStaffRow => ({ id, display_name: name, system_role: role });
const settings = (over: { overrides?: unknown[]; userOverrides?: unknown[]; disabled?: string[] } = {}) =>
  ({ permissions: { overrides: over.overrides ?? [], userOverrides: over.userOverrides ?? [] }, modules: { disabled: over.disabled ?? [] } }) as unknown as Pick<TenantSettings, "permissions" | "modules">;
const ids = (list: { id: string }[]) => list.map((u) => u.id);

describe("데스크 담당자 후보 = 수납 쓰기 권한이 있는 직원(리뷰 2026-11-03)", () => {
  const staff = [row("boss", "master"), row("adm", "admin"), row("acc", "accountant"), row("mgr", "manager"), row("cns", "counselor"), row("tch", "teacher"), row("noname", "admin", " ")];
  it("기본 권한표 — 원장·관리자·회계만(매니저는 수납 읽기만 · 상담사는 없음 · 이름 없는 계정 제외)", () => {
    expect(ids(billingWriters(staff, new Set(), settings()))).toEqual(["boss", "adm", "acc"]);
  });
  it("지점 역할 덮어쓰기 · 개인별 권한이 반영된다", () => {
    expect(ids(billingWriters(staff, new Set(), settings({ overrides: [{ menu: "billing", role: "manager", access: "full" }] })))).toContain("mgr");
    expect(ids(billingWriters(staff, new Set(), settings({ userOverrides: [{ userId: "cns", menu: "billing", access: "full" }] })))).toContain("cns");
    expect(ids(billingWriters(staff, new Set(), settings({ userOverrides: [{ userId: "acc", menu: "billing", access: "readonly" }] })))).not.toContain("acc");
  });
  it("운영자 계정은 낮추는 개인 예외를 무시한다(권한 게이트와 같은 병합)", () => {
    expect(ids(billingWriters(staff, new Set(["adm"]), settings({ userOverrides: [{ userId: "adm", menu: "billing", access: "none" }] })))).toContain("adm");
  });
});
