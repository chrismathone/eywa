import { describe, expect, it } from "vitest";
import { selectSubjectView } from "./subject-view";
import { normalizeDashboard, roleItems } from "./normalize";
import { defaultItems } from "./defaults";
import { resolveView } from "./view";
import { MENU_KEYS } from "@/lib/permissions";
import { dashboardSchema } from "@/features/owner/settings-types";
import { subjectLabelRecord } from "@/features/owner/subjects";

const math = [{ id: "panel:repeatAbsence", w: 6, h: 1 }];
const english = [{ id: "panel:notices", w: 6, h: 1 }];
/** 옛 배치는 읽을 때 새 대시보드 모양으로 옮겨진다 — 비교는 카드만. */
const cards = (items: readonly { id: string }[] | undefined) => items?.filter((i) => i.id.startsWith("panel:")).map((i) => i.id);
describe("관리자 과목별 배치", () => {
  it("기존 공통 배치를 보존하면서 수학·영어 카드를 따로 저장·적용한다", () => {
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: english }, { role: "subject", subject: "math", items: math }] }, { dropDefaults: true });
    expect(dashboardSchema.safeParse(saved).success).toBe(true);
    expect(cards(roleItems(saved, "subject", "math"))).toEqual(cards(math));
    expect(cards(roleItems(saved, "subject", "english"))).toEqual(cards(english));
    const view = (subject: string) => resolveView({ stored: saved, bundle: "subject", subject, subjectLabels: [subject], menus: new Set(MENU_KEYS) }).items;
    expect(cards(view("math"))).toEqual(cards(math));
    expect(cards(view("english"))).toEqual(cards(english));
  });
  it("공통 배치와 다른 과목별 기본값은 저장에서 지우지 않는다", () => {
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: english }, { role: "subject", subject: "math", items: defaultItems("subject") }] }, { dropDefaults: true });
    expect(roleItems(saved, "subject", "math")).toEqual(defaultItems("subject"));
    expect(saved.layouts).toHaveLength(2);
  });
  it("옛 라벨이 앞에 붙은 운영실 표에서도 수학 묶음은 math 배치를 쓴다(2026-10-21 허주연 관리자 — highmath로 잡혀 공통 배치로 떨어졌다)", () => {
    const labels = subjectLabelRecord([
      { key: "math", label: "수학" }, { key: "english", label: "영어" }, { key: "science", label: "과학" },
    ] as Parameters<typeof subjectLabelRecord>[0]);
    expect(Object.keys(labels).indexOf("highmath")).toBeLessThan(Object.keys(labels).indexOf("math"));
    const picked = selectSubjectView(labels, ["math"]);
    expect(picked.active?.key).toBe("math");
    expect(picked.subjects).toEqual(["math"]);
    const saved = normalizeDashboard({ version: 1, layouts: [{ role: "subject", items: english }, { role: "subject", subject: "math", items: math }] }, { dropDefaults: true });
    expect(resolveView({ stored: saved, bundle: "subject", subject: picked.active?.key, subjectLabels: ["수학"], menus: new Set(MENU_KEYS) }).items).toEqual(expect.arrayContaining(math.map((m) => expect.objectContaining({ id: m.id }))));
    // 옛 키만 담당으로 가진 계정도 같은 수학 배치를 본다.
    expect(selectSubjectView(labels, ["highmath"]).active?.key).toBe("math");
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
