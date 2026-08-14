import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "./periods";
import { buildRichCardGroups, type GridSlot } from "./class-grid";

/**
 * 섹션 key는 **제목과 무관해야** 한다(2026-08-14).
 *
 * 🔴 커스텀 줄의 제목은 배치 편집에서 입력칸이다. key에 제목이 들어가 있으면 한 글자 칠 때마다 key가
 * 바뀌어 섹션이 통째로 리마운트되고, **입력칸이 포커스를 잃는다** — 원장이 겪은 "그룹 명 수정시에
 * 뒤로가기가 되어버림"(포커스가 body로 빠진 뒤의 백스페이스를 브라우저가 뒤로가기로 해석)의 원인이다.
 */
const slot = (classId: string, day: string, start: string, end: string): GridSlot =>
  ({
    classId,
    className: `반-${classId}`,
    subject: "english",
    dayOfWeek: day,
    startTime: start,
    endTime: end,
    teacherName: "김강사",
    classroomName: "301",
    slotTeacherLabel: null,
    slotRoomLabel: null,
    classBgColor: null,
    classTextColor: null,
    students: [],
  }) as unknown as GridSlot;

const SLOTS = [
  slot("c1", "mon", "14:20", "15:00"),
  slot("c2", "mon", "14:20", "15:00"),
  // 주말 **전용** 반 — 같은 줄 안에서 주말 하위 섹션이 갈려 나온다(혼합 반은 평일 행으로 얹혀서 안 갈린다).
  slot("c3", "sat", "09:00", "10:00"),
];

const customWith = (title: string) => ({
  groups: [{ id: "row-1", title, classIds: ["c1", "c2", "c3"] }],
  showOthers: true,
  othersTitle: "기타 수업",
});

describe("섹션 key 안정성", () => {
  it("줄 제목만 바꾸면 key는 그대로고 label만 바뀐다", () => {
    const before = buildRichCardGroups(SLOTS, DEFAULT_PERIODS_CONFIG, new Set(), customWith("오후 3:00"));
    const after = buildRichCardGroups(SLOTS, DEFAULT_PERIODS_CONFIG, new Set(), customWith("오후 3시"));
    expect(after.map((g) => g.key)).toEqual(before.map((g) => g.key));
    // 라벨은 따라 바뀌어야 한다(화면에 보이는 이름).
    expect(after.some((g) => g.label.includes("오후 3시"))).toBe(true);
  });

  // 빈 제목은 화면이 `줄 N`으로 채워 보내므로(편집 보드 `titled`) 여기선 다루지 않는다.
  it("한 글자씩 지워도(제목이 계속 바뀌어도) key가 흔들리지 않는다", () => {
    const keys = ["오후 3:00", "오후 3:0", "오후 3:", "오후 3", "오"].map((t) =>
      buildRichCardGroups(SLOTS, DEFAULT_PERIODS_CONFIG, new Set(), customWith(t)).map((g) => g.key),
    );
    for (const k of keys) expect(k).toEqual(keys[0]);
  });

  it("같은 줄의 평일·주말 섹션은 서로 다른 key를 갖는다(중복 key 금지)", () => {
    const groups = buildRichCardGroups(SLOTS, DEFAULT_PERIODS_CONFIG, new Set(), customWith("오후 3:00"));
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 주말 하위 섹션이 실제로 만들어졌는지(이 테스트의 전제)
    expect(groups.length).toBeGreaterThan(1);
  });

  it("커스텀 줄이 없을 때(자동 묶음)도 key는 유일하다", () => {
    const groups = buildRichCardGroups(SLOTS, DEFAULT_PERIODS_CONFIG);
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
