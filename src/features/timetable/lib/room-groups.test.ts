import { describe, expect, it } from "vitest";
import { groupRooms, roomGroupOf } from "./room-groups";

const R = (name: string) => ({ name });
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe("roomGroupOf", () => {
  it("호수 앞자리를 층으로 읽는다 — 이 학원의 실제 표기 규약", () => {
    expect(roomGroupOf("본원305")).toMatchObject({ building: "본원", floor: 3, label: "본원 3층", order: 305 });
    expect(roomGroupOf("고수801")).toMatchObject({ building: "고수", floor: 8, order: 801 });
  });

  it("본원SKY는 2층에 편입되고 그 층의 맨 끝(205호 아래)에 선다", () => {
    const g = roomGroupOf("본원SKY");
    expect(g).toMatchObject({ building: "본원", floor: 2, label: "본원 2층" });
    expect(g.order).toBeGreaterThan(roomGroupOf("본원205").order);
  });

  it("모르는 표기는 층 없이 건물로만 묶는다(정렬을 죽이지 않는다)", () => {
    expect(roomGroupOf("별관")).toMatchObject({ building: "별관", floor: null, label: "별관" });
  });
});

describe("groupRooms", () => {
  const ROOMS = [
    "고수801", "고수802", "바른602", "본원201", "본원205", "본원SKY",
    "본원301", "본원305", "본원601", "본원606",
  ].map(R);

  it("건물은 입력 순서, 층·호수는 숫자 순 — SKY는 205 바로 뒤", () => {
    expect(names(groupRooms(ROOMS))).toEqual([
      "고수801", "고수802",
      "바른602",
      "본원201", "본원205", "본원SKY",
      "본원301", "본원305",
      "본원601", "본원606",
    ]);
  });

  it("층이 바뀌는 첫 행에만 구분선 — 표 머리와 겹치는 첫 행은 제외", () => {
    const rows = groupRooms(ROOMS);
    const marked = rows.filter((r) => r.groupStart).map((r) => r.name);
    expect(marked).toEqual(["바른602", "본원201", "본원301", "본원601"]);
    expect(rows[0]!.groupStart).toBe(false);
  });

  it("SKY는 2층이라 그 앞에 구분선이 생기지 않는다(같은 묶음)", () => {
    const sky = groupRooms(ROOMS).find((r) => r.name === "본원SKY")!;
    expect(sky.groupStart).toBe(false);
    expect(sky.group.label).toBe("본원 2층");
  });

  it("호수를 못 읽는 방은 그 건물 맨 끝으로(앞자리에 두면 표가 어수선해진다)", () => {
    expect(names(groupRooms([R("본원301"), R("본원별관"), R("본원201")])).slice(-1)).toEqual(["본원별관"]);
  });
});
