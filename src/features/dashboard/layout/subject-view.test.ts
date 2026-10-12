import { describe, expect, it } from "vitest";
import { selectSubjectView } from "./subject-view";
import { normalizeDashboard, roleItems } from "./normalize";
import { defaultItems } from "./defaults";
import { resolveView } from "./view";
import { MENU_KEYS } from "@/lib/permissions";
import { dashboardSchema } from "@/features/owner/settings-types";

const math = [{ id: "panel:teacherWork", w: 24, h: 1 }];
const english = [{ id: "panel:notices", w: 6, h: 1 }];
describe("관리자 과목별 배치", () => {
  it("기존 공통 배치를 보존하면서 수학·영어 카드를 따로 저장·적용한다", () => {
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: english }, { role: "subject", subject: "math", items: math }] }, { dropDefaults: true });
    expect(dashboardSchema.safeParse(saved).success).toBe(true);
    expect(roleItems(saved, "subject", "math")).toEqual(math);
    expect(roleItems(saved, "subject", "english")).toEqual(english);
    const view = (subject: string) => resolveView({ stored: saved, bundle: "subject", subject, subjectLabels: [subject], menus: new Set(MENU_KEYS) }).items;
    expect(view("math")).toEqual(math);
    expect(view("english")).toEqual(english);
  });
  it("공통 배치와 다른 과목별 기본값은 저장에서 지우지 않는다", () => {
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: english }, { role: "subject", subject: "math", items: defaultItems("subject") }] }, { dropDefaults: true });
    expect(roleItems(saved, "subject", "math")).toEqual(defaultItems("subject"));
    expect(saved.layouts).toHaveLength(2);
  });
  it("URL로 담당 밖 과목을 요구해도 허용된 과목만 선택한다", () => {
    const labels = { math: "수학", advanced: "수학 심화", english: "영어", science: "과학" };
    expect(selectSubjectView(labels, ["math"], "english").active?.key).toBe("math");
    expect(selectSubjectView(labels, [], "math").subjects).toEqual([]);
    const both = selectSubjectView(labels, ["math", "advanced", "english"], "math");
    expect(both.subjects).toEqual(["math", "advanced"]);
    expect(both.choices.map((s) => s.key)).toEqual(["math", "english"]);
  });
  it("역할·과목 중복과 다른 역할의 과목 배치를 거절한다", () => {
    const layouts = [{ role: "subject", subject: "math", items: math }];
    expect(dashboardSchema.safeParse({ version: 1, layouts: [...layouts, ...layouts] }).success).toBe(false);
    expect(dashboardSchema.safeParse({ version: 1, layouts: [{ role: "owner", subject: "math", items: math }] }).success).toBe(false);
  });
});
