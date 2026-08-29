import { describe, expect, it } from "vitest";
import {
  groupLayoutSignature,
  readScheduledGroupPlan,
  shouldApplyGroups,
  type ScheduledGroup,
} from "./scheduled-groups";

const g = (id: string, title: string, classIds: string[]): ScheduledGroup => ({ id, title, classIds });

describe("groupLayoutSignature", () => {
  it("키 순서가 달라도 같은 서명이다(jsonb는 키를 재정렬해 돌려준다)", () => {
    const a = [{ id: "1", title: "오후 2:20", classIds: ["c1", "c2"] }];
    const b = [{ classIds: ["c1", "c2"], title: "오후 2:20", id: "1" }] as ScheduledGroup[];
    expect(groupLayoutSignature(a)).toBe(groupLayoutSignature(b));
  });

  it("🔴 줄 순서와 줄 안 반 순서는 화면에 보이므로 서명에 든다", () => {
    expect(groupLayoutSignature([g("1", "A", ["c1"]), g("2", "B", [])])).not.toBe(
      groupLayoutSignature([g("2", "B", []), g("1", "A", ["c1"])]),
    );
    expect(groupLayoutSignature([g("1", "A", ["c1", "c2"])])).not.toBe(
      groupLayoutSignature([g("1", "A", ["c2", "c1"])]),
    );
  });

  it("제목이 바뀌면 다른 서명이다(원장이 줄 이름을 손본 것)", () => {
    expect(groupLayoutSignature([g("1", "오후 2:20", [])])).not.toBe(
      groupLayoutSignature([g("1", "저학년", [])]),
    );
  });

  it("🔴 제목 없는 줄은 양쪽에서 똑같이 버린다 — 화면이 이미 버리는 값이다", () => {
    // 안 맞추면 `from`(파서를 거친 값)과 현재 배치(raw jsonb)의 서명이 영영 어긋나 예약이 안 돈다.
    expect(groupLayoutSignature([g("1", "A", ["c1"]), g("2", "   ", ["c9"])])).toBe(
      groupLayoutSignature([g("1", "A", ["c1"])]),
    );
  });

  it("배열이 아닌 값도 던지지 않는다(jsonb엔 무엇이든 들어 있을 수 있다)", () => {
    expect(groupLayoutSignature({ nope: 1 })).toBe(groupLayoutSignature([]));
    expect(groupLayoutSignature("x")).toBe(groupLayoutSignature([]));
  });

  it("null·undefined·빈 배열은 모두 같다(설정 전 상태)", () => {
    expect(groupLayoutSignature(null)).toBe(groupLayoutSignature([]));
    expect(groupLayoutSignature(undefined)).toBe(groupLayoutSignature([]));
  });
});

describe("shouldApplyGroups", () => {
  const from = [g("1", "오후 2:20", ["c1", "c2"])];

  it("현재가 예약 시점 그대로면 적용한다", () => {
    expect(shouldApplyGroups({ from }, [g("1", "오후 2:20", ["c1", "c2"])])).toBe(true);
  });

  it("🔴 그 사이 사람이 손댔으면 건너뛴다 — 예약이 사람을 덮지 않는다", () => {
    expect(shouldApplyGroups({ from }, [g("1", "오후 2:20", ["c1"])])).toBe(false);
    expect(shouldApplyGroups({ from }, [g("1", "저학년", ["c1", "c2"])])).toBe(false);
  });

  it("아직 배치가 없던 상태로 예약했으면(from 비어 있음) 지금도 비어 있을 때만 적용한다", () => {
    expect(shouldApplyGroups({ from: [] }, [])).toBe(true);
    expect(shouldApplyGroups({ from: [] }, null)).toBe(true);
    expect(shouldApplyGroups({ from: [] }, [g("1", "A", [])])).toBe(false);
  });

  it("두 번 돌아도 안전하다 — 적용 뒤엔 현재 ≠ from이라 false", () => {
    const groups = [g("1", "오후 2:20", ["c1", "c2", "c3"])];
    expect(shouldApplyGroups({ from }, groups)).toBe(false);
  });
});

describe("readScheduledGroupPlan — 방어적 파싱", () => {
  const plan = {
    subject: "english",
    groups: [{ id: "sheet-1", title: "오후 2:20", classIds: ["c1"] }],
    from: [{ id: "sheet-1", title: "오후 2:20", classIds: ["c2"] }],
  };

  it("정상 payload를 읽는다", () => {
    expect(readScheduledGroupPlan(plan)).toEqual({ ...plan });
  });

  it("🔴 옛 스냅샷엔 키가 없다 — null/누락/배열은 전부 null(있는 척하면 전 스냅샷이 깨진다)", () => {
    expect(readScheduledGroupPlan(null)).toBeNull();
    expect(readScheduledGroupPlan(undefined)).toBeNull();
    expect(readScheduledGroupPlan([])).toBeNull();
    expect(readScheduledGroupPlan("english")).toBeNull();
  });

  it("🔴 줄이 하나도 없으면 null — 빈 배치를 적용하면 통합뷰가 '기타' 한 줄이 된다", () => {
    expect(readScheduledGroupPlan({ subject: "english", groups: [] })).toBeNull();
    expect(readScheduledGroupPlan({ subject: "english", groups: [{ id: "1", title: "  " }] })).toBeNull();
  });

  it("과목이 없으면 null(어느 과목 배치인지 모르면 못 쓴다)", () => {
    expect(readScheduledGroupPlan({ groups: plan.groups })).toBeNull();
  });

  it("classIds의 잡값은 버리고 문자열만 남긴다", () => {
    const out = readScheduledGroupPlan({
      subject: "english",
      groups: [{ id: "1", title: "A", classIds: ["c1", 7, null, "", "c2"] }],
    });
    expect(out?.groups[0]?.classIds).toEqual(["c1", "c2"]);
  });

  it("from이 없으면 빈 배열 — '아직 배치가 없던 상태'와 같게 다룬다", () => {
    expect(readScheduledGroupPlan({ subject: "english", groups: plan.groups })?.from).toEqual([]);
  });

  it("showOthers는 boolean일 때만 싣는다(미지정이면 현재 설정 유지)", () => {
    expect(readScheduledGroupPlan({ ...plan, showOthers: "yes" })).not.toHaveProperty("showOthers");
    expect(readScheduledGroupPlan({ ...plan, showOthers: false })?.showOthers).toBe(false);
  });
});
