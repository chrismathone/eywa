import { describe, expect, it } from "vitest";
import { buildDutyCards, classChips, countByKind, dutyHref, groupCardsByClass, lastDays } from "./view";
import type { DutyItemView } from "./kinds";

const NOW = Date.parse("2026-11-09T12:00:00+09:00");
const it_ = (over: Partial<DutyItemView>): DutyItemView => ({ id: Math.random().toString(36).slice(2), kind: "attendance", period: "daily", cycle: "2026-11-09", status: "open",
  dueAt: "2026-11-09T15:00:00.000Z", doneAt: null, voidReason: null, school: null, grade: null, studentId: "s1", studentName: "김하준", classId: "c1", className: "중2 A", subject: "math", escalation: 0, ...over });

describe("buildDutyCards", () => {
  it("학생 단위로 묶고 기한 초과 → 아직 → 완료 순 · 종류는 출결 → 보고서 → 발송 순 · 최근 7일 띠", () => {
    const items = [
      it_({ studentId: "s2", studentName: "이서아", status: "done" }),
      it_({ studentId: "s1", kind: "report_write" }),
      it_({ studentId: "s1" }),
      it_({ studentId: "s3", studentName: "박시우", dueAt: "2026-11-08T15:00:00.000Z" }),
    ];
    const days = lastDays("2026-11-09", 7);
    const cards = buildDutyCards(items, [{ day: "2026-11-08", studentKey: "s1", total: 2, done: 1 }], days, NOW);
    expect(cards.map((c) => c.title)).toEqual(["박시우", "김하준", "이서아"]);
    expect(cards[0]!.worst).toBe("late");
    expect(cards[1]!.items.map((i) => i.kind)).toEqual(["attendance", "report_write"]);
    expect(cards[1]!.week).toEqual([null, null, null, null, null, 0.5, null]);
  });
  it("반 알림장(학생 없음)은 반 이름 카드", () => {
    const cards = buildDutyCards([it_({ studentId: null, studentName: null, className: "LE2", kind: "report_write" })], [], lastDays("2026-11-09", 7), NOW);
    expect(cards[0]).toMatchObject({ title: "LE2", sub: "반 알림장", key: "class:c1" });
  });
});

describe("groupCardsByClass", () => {
  it("반별로 묶고 늦은 반 → 아직 있는 반 → 다 한 반 · 반 알림장도 그 반에 · 반 없음은 맨 뒤", () => {
    const items = [
      it_({ studentId: "s1", classId: "c1", className: "중2 A", status: "done" }),
      it_({ studentId: "s2", classId: "c2", className: "중3 B", dueAt: "2026-11-08T15:00:00.000Z" }),
      it_({ studentId: "s3", classId: "c3", className: "중1 C" }),
      it_({ studentId: null, studentName: null, classId: "c3", className: "중1 C", kind: "report_write" }),
      it_({ studentId: "s4", classId: null, className: null }),
    ];
    const groups = groupCardsByClass(buildDutyCards(items, [], lastDays("2026-11-09", 7), NOW), NOW);
    expect(groups.map((g) => g.name)).toEqual(["중3 B", "중1 C", "중2 A", "반 없음"]);
    expect(groups[1]).toMatchObject({ total: 2, open: 2, cards: expect.any(Array) });
    expect(groups[1]!.cards).toHaveLength(2);
  });
});

describe("countByKind · classChips · dutyHref · lastDays", () => {
  it("종류별 전체·완료·늦음 · 반 칩은 늦음 많은 순", () => {
    const items = [it_({ status: "done" }), it_({ dueAt: "2026-11-08T15:00:00.000Z" }), it_({ classId: "c2", className: "중3 B", kind: "report_write", status: "void" })];
    expect(countByKind(items, NOW)).toEqual([{ kind: "attendance", total: 2, done: 1, late: 1 }, { kind: "report_write", total: 0, done: 0, late: 0 }]);
    expect(classChips(items, NOW).map((c) => c.name)).toEqual(["중2 A", "중3 B"]);
  });
  it("칸 링크 = 원스크린 그 날짜·반·학생 · 반 알림장은 ECS", () => {
    expect(dutyHref({ studentId: "s1", classId: "c1", cycle: "2026-11-09", subject: "math" })).toBe("/onescreen?date=2026-11-09&class=c1&student=s1");
    expect(dutyHref({ studentId: null, classId: "c1", cycle: "2026-11-09", subject: "english" })).toBe("/ecs");
    expect(lastDays("2026-11-09", 3)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09"]);
  });
});
