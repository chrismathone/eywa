import { describe, expect, it } from "vitest";
import { rosterTextCols } from "@/features/class-sheets/lib/roster-form";
import {
  JJ_MARK_FIELDS,
  jjSeatTextCols,
  parseJjMarkField,
  seatHasJjFields,
  seatOverlayKey,
} from "./jj-fields";

describe("JJ실 전용 칸", () => {
  it("로그인 JJ실만 전용 칸이 있다 — 랩실은 출결만", () => {
    expect(seatHasJjFields("jj")).toBe(true);
    expect(seatHasJjFields("lab")).toBe(false);
  });

  it("필드 이름은 듣기·단어 둘뿐 — 시험 점수를 슬쩍 넣지 않는다", () => {
    expect([...JJ_MARK_FIELDS]).toEqual(["listeningLevel", "memorizedWords"]);
    expect(parseJjMarkField("listeningLevel")).toBe("listeningLevel");
    expect(parseJjMarkField("memorizedWords")).toBe("memorizedWords");
    expect(parseJjMarkField("score")).toBeNull();
    expect(parseJjMarkField("status")).toBeNull();
  });

  it("열 라벨은 ECS JJ 폼과 같다", () => {
    expect(jjSeatTextCols()).toBe(rosterTextCols("selfStudy"));
    expect(jjSeatTextCols().map((c) => c.label)).toEqual(["듣기 레벨", "누적 암기 단어수"]);
  });

  it("오버레이 키에 교시가 들어간다 — 없으면 다른 교시 값이 묻는다", () => {
    expect(seatOverlayKey("c1", "s1", "16:20:00")).toBe("c1|s1|16:20");
    expect(seatOverlayKey("c1", "s1", "16:20")).not.toBe(seatOverlayKey("c1", "s1", "17:20"));
  });
});
