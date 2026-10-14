import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { resolveSettings } from "./resolve";
import { prepareSectionForSave } from "./preset";
import { permissionsCanonical } from "./permissions-canonical";
import { permissionsSchema } from "./settings-types";
import { specialAccessTargets } from "./special-access";
import { diffSettingsSection } from "./settings-diff";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const resolve = (specialAccess: unknown, preset?: string) => resolveSettings({ preset, permissions: { specialAccess } }, { name: "" });

describe.each([undefined, "generic"])("payslip raw normalization (%s)", (preset) => {
  it("inherits only absent manager field and clones arrays without mutating presets or input", () => {
    const before = JSON.stringify([DEFAULT_SETTINGS, GENERIC_SETTINGS]);
    const raw = { payslipViewerIds: [A] };
    const settings = resolve(raw, preset);
    expect(settings.permissions.specialAccess.payslipManagerIds).toEqual([A]);
    settings.permissions.specialAccess.payslipManagerIds!.push(B);
    expect(raw).toEqual({ payslipViewerIds: [A] });
    expect(JSON.stringify([DEFAULT_SETTINGS, GENERIC_SETTINGS])).toBe(before);
    expect(resolve(raw, preset).permissions.specialAccess.payslipManagerIds).toEqual([A]);
  });

  it.each([[], [B], null, "bad", {}, [A, 7], ["bad"], [A, A]].map((value) => ({ value })))("explicit $value never falls back to viewers", ({ value }) => {
    const p = resolve({ payslipViewerIds: [A], payslipManagerIds: value }, preset).permissions;
    expect(p.specialAccess.payslipManagerIds).toEqual(Array.isArray(value) && value[0] === B ? [B] : []);
  });

  it("new tenant and both preset defaults start with no managers", () => {
    expect(resolveSettings({ version: 1, preset }, { name: "" }).permissions.specialAccess.payslipManagerIds).toEqual([]);
    expect(DEFAULT_SETTINGS.permissions.specialAccess.payslipManagerIds).toEqual([]);
    expect(GENERIC_SETTINGS.permissions.specialAccess.payslipManagerIds).toEqual([]);
  });

  it("explicit revoke survives viewer changes, unrelated section save and repeated resolution", () => {
    const raw = { preset, permissions: { specialAccess: { payslipViewerIds: [A], payslipManagerIds: [] } } };
    const next = { ...raw, profile: { name: "changed" }, permissions: { specialAccess: { payslipViewerIds: [B], payslipManagerIds: [] } } };
    expect(resolveSettings(next, { name: "" }).permissions.specialAccess.payslipManagerIds).toEqual([]);
    expect(resolveSettings(raw, { name: "" }).permissions.specialAccess.payslipManagerIds).toEqual([]);
  });
});

it("canonical uses the same effective capability before and after legacy materialization", () => {
  const legacy = permissionsSchema.parse({ overrides: [], specialAccess: { payslipViewerIds: [A] } });
  const materialized = { ...legacy, specialAccess: { ...legacy.specialAccess, payslipManagerIds: [A] } };
  const revoked = { ...legacy, specialAccess: { ...legacy.specialAccess, payslipManagerIds: [] } };
  expect(permissionsCanonical(legacy)).toBe(permissionsCanonical(materialized));
  expect(diffSettingsSection("permissions", legacy, materialized).changes).toEqual([]);
  expect(permissionsCanonical(legacy)).not.toBe(permissionsCanonical(revoked));
  expect(permissionsCanonical(revoked)).not.toBe(permissionsCanonical({ ...revoked, specialAccess: { ...revoked.specialAccess, payslipManagerIds: [B] } }));
});

it("old form freezes pre-save viewers and preserves explicit empty and future unknown fields", () => {
  const input = { overrides: [] };
  for (const manager of [undefined, [], [B], null]) {
    const special = { payslipViewerIds: [A], futureIds: [B], ...(manager === undefined ? {} : { payslipManagerIds: manager }) };
    const stored = { specialAccess: special };
    const result = prepareSectionForSave("generic", "permissions", input, permissionsSchema.parse(input), stored);
    expect(result).toMatchObject({ specialAccess: { ...special, payslipManagerIds: manager === undefined ? [A] : manager } });
    expect(stored.specialAccess).toEqual(special);
  }
});

it("only newly granted management is subject to active staff validation", () => {
  const next = permissionsSchema.parse({ overrides: [], specialAccess: { payslipViewerIds: [A], payslipManagerIds: [A, B] } });
  expect(specialAccessTargets(next.specialAccess, { payslipViewerIds: [A] }).userIds).toEqual([B]);
  expect(specialAccessTargets(next.specialAccess, { payslipViewerIds: [A], payslipManagerIds: [] }).userIds).toEqual([A, B]);
});

it("schema accepts old forms, validates explicit IDs and denies duplicates and >80", () => {
  expect(permissionsSchema.parse({ overrides: [] }).specialAccess).not.toHaveProperty("payslipManagerIds");
  for (const value of [null, {}, "bad", ["bad"], [A, A], Array.from({ length: 81 }, () => A)]) {
    expect(permissionsSchema.safeParse({ overrides: [], specialAccess: { payslipManagerIds: value } }).success).toBe(false);
  }
});

it("management changes get a Korean audit label without salary data", () => {
  const change = diffSettingsSection("permissions", { specialAccess: { payslipManagerIds: [] } }, { specialAccess: { payslipManagerIds: [A] } });
  expect(change.changes.some((row) => row.label.includes("급여명세서 관리"))).toBe(true);
});
