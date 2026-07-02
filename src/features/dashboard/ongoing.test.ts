import { describe, expect, it } from "vitest";
import { groupOngoingBySubject } from "./ongoing";
import type { PillColor } from "@/components/atoms/pill";

const subjects = {
  labelOf: (k: string) => ({ math: "수학", english: "영어", science: "과학" })[k] ?? k,
  colorOf: (k: string) =>
    (({ math: "primary", english: "blue", science: "purple" })[k] ?? "neutral") as PillColor,
};

type Slot = { subject: string; startTime: string; status: "done" | "ongoing" | "upcoming"; id: string };
const slot = (id: string, subject: string, startTime: string, status: Slot["status"]): Slot => ({
  id,
  subject,
  startTime,
  status,
});

describe("groupOngoingBySubject", () => {
  it("진행 중(ongoing)만 포함하고 done/upcoming은 제외", () => {
    const groups = groupOngoingBySubject(
      [
        slot("a", "math", "14:30", "ongoing"),
        slot("b", "math", "13:00", "done"),
        slot("c", "math", "16:00", "upcoming"),
      ],
      subjects,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].slots.map((s) => s.id)).toEqual(["a"]);
  });

  it("과목별로 묶고 라벨·색을 설정 소스에서 채운다", () => {
    const groups = groupOngoingBySubject(
      [slot("a", "math", "14:30", "ongoing"), slot("b", "english", "14:30", "ongoing")],
      subjects,
    );
    const byKey = Object.fromEntries(groups.map((g) => [g.subject, g]));
    expect(byKey.math.label).toBe("수학");
    expect(byKey.math.color).toBe("primary");
    expect(byKey.english.label).toBe("영어");
    expect(byKey.english.color).toBe("blue");
  });

  it("그룹은 수업 수 desc, 동수면 라벨 가나다순", () => {
    const groups = groupOngoingBySubject(
      [
        slot("m1", "math", "14:00", "ongoing"),
        slot("m2", "math", "15:00", "ongoing"),
        slot("e1", "english", "14:00", "ongoing"), // 영어 1건
        slot("s1", "science", "14:00", "ongoing"), // 과학 1건 → 동수면 가나다순(과학 < 영어)
      ],
      subjects,
    );
    expect(groups.map((g) => g.label)).toEqual(["수학", "과학", "영어"]);
  });

  it("그룹 내 수업은 시작시각 오름차순", () => {
    const groups = groupOngoingBySubject(
      [
        slot("late", "math", "16:00", "ongoing"),
        slot("early", "math", "14:00", "ongoing"),
        slot("mid", "math", "15:00", "ongoing"),
      ],
      subjects,
    );
    expect(groups[0].slots.map((s) => s.id)).toEqual(["early", "mid", "late"]);
  });

  it("진행 중이 없으면 빈 배열", () => {
    expect(
      groupOngoingBySubject([slot("a", "math", "14:00", "done")], subjects),
    ).toEqual([]);
  });

  it("미등록 과목 key는 raw key 라벨 + neutral 색 폴백", () => {
    const groups = groupOngoingBySubject([slot("x", "unknown_sub", "14:00", "ongoing")], subjects);
    expect(groups[0].label).toBe("unknown_sub");
    expect(groups[0].color).toBe("neutral");
  });
});
