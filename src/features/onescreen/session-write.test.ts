import { describe, expect, it } from "vitest";
import {
  sameSessionRevision,
  sessionContentBits,
  sessionSaveDecision,
  type SessionContent,
} from "./session-write";

const CLASS = "8ad5678e-2a8f-4ab1-9c20-74488b844051";

const filled: SessionContent = {
  subjectProgress: {
    [CLASS]: {
      today: "삼각비의 활용",
      textbook: "중3-1-4 인재원",
      attitude: "매우 좋음",
      homework: "60%",
      homeworkToday: "유형의 나무 끝까지, 수력충전 ~59p",
      draft: "오늘 일일테스트에서 25문제 중 2개를 맞혔습니다.",
      autoDraft: "오늘 일일테스트에서 25문제 중 2개를 맞혔습니다.",
    },
  },
};

const partial: SessionContent = {
  subjectProgress: {
    [CLASS]: {
      today: "삼각비의 활용",
      textbook: "중3-1-4 인재원",
      attitude: "매우 좋음",
      homework: "60%",
      homeworkToday: "",
      draft: "",
      autoDraft: "",
    },
  },
};

const empty: SessionContent = {
  subjectProgress: {
    [CLASS]: { today: "", homeworkToday: "", draft: "", textbook: "" },
  },
};

describe("sessionContentBits", () => {
  it("문항수 기본값·빈 문자열은 안 센다", () => {
    expect(sessionContentBits(empty).size).toBe(0);
    expect(sessionContentBits({ dailyScore: null })).toEqual(new Set());
  });
  it("0점도 입력으로 센다", () => {
    expect(sessionContentBits({ dailyScore: 0 }).has("dailyScore")).toBe(true);
  });
});

describe("sameSessionRevision", () => {
  it("둘 다 있을 때만 같다", () => {
    expect(sameSessionRevision(undefined, "2026-09-04T08:06:12.730Z")).toBe(false);
    expect(sameSessionRevision("2026-09-04T08:06:12.730Z", "2026-09-04T08:06:12.730Z")).toBe(true);
    expect(sameSessionRevision("2026-09-04T08:06:12.730Z", "2026-09-04T08:06:12.730+00:00")).toBe(true);
    expect(sameSessionRevision("2026-09-04T08:06:12.730Z", "2026-09-04T08:06:12.731Z")).toBe(false);
  });
});

describe("sessionSaveDecision — 빈 창이 잘 쓴 창을 덮지 않음", () => {
  it("행이 없으면 반영", () => {
    expect(sessionSaveDecision(null, filled, false)).toBe("apply");
  });

  it("같은 리비전(이 창이 마지막 저장)이면 칸을 비워도 반영", () => {
    expect(sessionSaveDecision(filled, partial, true)).toBe("apply");
    expect(sessionSaveDecision(filled, empty, true)).toBe("apply");
  });

  it("정지우 사고: 멘트·오늘 과제가 있는 행을 진도·태도만 있는 창이 덮지 못함", () => {
    expect(sessionSaveDecision(filled, partial, false)).toBe("ignore");
    expect(sessionSaveDecision(filled, empty, false)).toBe("ignore");
  });

  it("잘 쓴 창이 빈 행보다 늦게 저장되면 반영", () => {
    expect(sessionSaveDecision(partial, filled, false)).toBe("apply");
    expect(sessionSaveDecision(empty, filled, false)).toBe("apply");
    expect(sessionSaveDecision({ subjectProgress: {} }, filled, false)).toBe("apply");
  });

  it("리비전만 다르고 칸 수가 같으면(옛 값) 무시 — 같은 칸을 옛 창이 되돌리지 않음", () => {
    const oldToday: SessionContent = {
      subjectProgress: {
        [CLASS]: { ...filled.subjectProgress![CLASS], today: "삼각비의 뜻" },
      },
    };
    expect(sessionSaveDecision(filled, oldToday, false)).toBe("ignore");
  });
});
