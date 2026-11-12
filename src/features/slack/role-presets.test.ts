import { describe, expect, it } from "vitest";
import { filterPresetNotifications, ROLE_PRESETS, withoutCoveredKeys } from "./role-presets";
import { FORWARD_EVENT_OPTIONS, forwardEventOptionsFor, sanitizeForwardEventTypes } from "./events";
import type { ActivityOption } from "./activity-catalog";

const OPTIONS: ActivityOption[] = [
  { key: "student_create", label: "원생 등록", category: "students", grade: "safe" },
  { key: "invoice_create", label: "청구 생성", category: "billing", grade: "opaque" },
  { key: "payroll_save", label: "급여", category: "payroll", grade: "forbid" },
  { key: "shuttle_trip_start", label: "운행 시작", category: "ops", grade: "safe" },
  { key: "attendance_cell", label: "출결", category: "attendance", grade: "safe" },
];

describe("슬랙 역할별 기본 세팅(원장 2026-09-28)", () => {
  it("모든 기능이 켜지면 프리셋을 보존하고, 꺼진 기능의 알림 종류만 뺀다", () => {
    const master = ROLE_PRESETS.find((preset) => preset.id === "master")!.build(OPTIONS);
    expect(filterPresetNotifications(master, FORWARD_EVENT_OPTIONS)).toEqual(master);

    const visible = forwardEventOptionsFor({ approvals: false, classnote: false, makeedu: false, todaysMath: false, videoReview: false });
    const filtered = filterPresetNotifications(master, visible);
    const keys = filtered.flatMap((rule) => rule.typeKeys);
    expect(keys).not.toContain("approval_requested");
    expect(keys).not.toContain("makeedu_login_failed");
    expect(keys).not.toContain("report_send_failed");
    expect(keys).toContain("grade_drop");
  });

  it("다섯 역할 — 원장·관리자·매니저·선생님·셔틀", () => {
    expect(ROLE_PRESETS.map((p) => p.id)).toEqual(["master", "admin", "manager", "teacher", "shuttle"]);
  });

  it("알림 규칙의 키는 전부 보낼 수 있는 알림이고, 대상은 받는 사람 본인(1:1)", () => {
    for (const p of ROLE_PRESETS) {
      for (const r of p.build(OPTIONS).filter((r) => r.source === "notification")) {
        expect([...sanitizeForwardEventTypes(r.typeKeys)].sort()).toEqual([...r.typeKeys].sort());
        expect(r.typeKeys.length).toBeGreaterThan(0);
        if (p.id !== "shuttle") expect(r.targets).toEqual([{ kind: "recipient_dm" }]);
      }
    }
  });

  it("활동 피드는 보낼 수 없는(forbid) 키를 넣지 않는다 · 셔틀은 셔틀 키만", () => {
    const master = ROLE_PRESETS.find((p) => p.id === "master")!.build(OPTIONS).find((r) => r.source === "activity")!;
    expect(master.typeKeys).toEqual(["student_create", "invoice_create"]);
    const shuttle = ROLE_PRESETS.find((p) => p.id === "shuttle")!.build(OPTIONS).find((r) => r.source === "activity")!;
    expect(shuttle.typeKeys).toEqual(["shuttle_trip_start"]);
  });

  it("묶음을 여럿 더해도 같은 알림이 한 사람에게 두 번 가지 않는다 — 이미 1:1로 보내는 키는 뺀다", () => {
    const build = (id: string) => ROLE_PRESETS.find((p) => p.id === id)!.build(OPTIONS);
    const first = withoutCoveredKeys(build("master"), []);
    expect(first.dropped).toBe(0);
    first.rules = first.rules.map((r, i) => ({ ...r, id: `saved-${i}` })); // 저장된 규칙이라야 키를 가린다
    const second = withoutCoveredKeys(build("teacher"), first.rules);
    const teacherNotif = second.rules.find((r) => r.source === "notification")!;
    expect(teacherNotif.typeKeys).not.toContain("absence_alert");
    expect(teacherNotif.typeKeys).toContain("enrollment_assigned");
    expect(second.dropped).toBeGreaterThan(0);
    // 전부 겹치면 1:1 규칙은 아예 안 생긴다(활동 피드는 그대로)
    const again = withoutCoveredKeys(build("master"), first.rules);
    expect(again.rules.map((r) => r.source)).toEqual(["activity"]);
  });

  it("꺼 둔 규칙·저장 전 줄은 키를 가리지 않는다", () => {
    const master = ROLE_PRESETS.find((p) => p.id === "master")!.build(OPTIONS);
    const off = master.map((r, i) => ({ ...r, id: `saved-${i}`, enabled: false }));
    expect(withoutCoveredKeys(master, off).dropped).toBe(0);
    expect(withoutCoveredKeys(master, master).dropped).toBe(0); // id 없음 = 저장 전
  });
});
