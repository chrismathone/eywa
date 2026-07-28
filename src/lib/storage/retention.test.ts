import { describe, expect, it } from "vitest";
import { groupPathsByBucket, retentionCutoffISO, RETENTION_TABLES } from "./retention";

describe("retentionCutoffISO", () => {
  it("기준일에서 90일을 뺀다", () => {
    expect(retentionCutoffISO(new Date("2026-07-28T00:00:00Z"))).toBe("2026-04-29T00:00:00.000Z");
  });
  it("일수 지정 가능", () => {
    expect(retentionCutoffISO(new Date("2026-07-28T00:00:00Z"), 120)).toBe("2026-03-30T00:00:00.000Z");
  });
});

describe("RETENTION_TABLES", () => {
  it("registration은 consultation 버킷을 공유한다(교차 삭제 방지 매핑 확인)", () => {
    const reg = RETENTION_TABLES.find((t) => t.table === "enrollment_consultations");
    expect(reg?.kind).toBe("registration");
  });
  it("이전분 함정: meeting은 created_at이 아니라 held_at 기준", () => {
    const m = RETENTION_TABLES.find((t) => t.table === "meeting_minutes");
    expect(m?.dateColumn).toBe("held_at");
  });
});

describe("groupPathsByBucket", () => {
  it("kind 버킷으로 경로를 묶고 null은 제외", () => {
    const g = groupPathsByBucket(
      [{ audio_path: "meeting-recordings/a.webm" }, { audio_path: null }],
      "meeting",
    );
    expect(g).toEqual({ "meeting-recordings": ["meeting-recordings/a.webm"] });
  });
  it("registration 경로는 consultation-recordings 버킷으로", () => {
    const g = groupPathsByBucket([{ audio_path: "t/x.webm" }], "registration");
    expect(Object.keys(g)).toEqual(["consultation-recordings"]);
  });
  it("빈 입력 = 빈 객체", () => {
    expect(groupPathsByBucket([], "meeting")).toEqual({});
  });
});
