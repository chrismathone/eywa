import { beforeEach, describe, expect, it } from "vitest";
import type { ScheduledGroupPlan } from "@/features/timetable/scheduled-groups";
import { applyScheduledGroupPlan } from "./scheduled-groups";

/**
 * 예약 그룹 반영(cron)의 쓰기 — **읽은 그대로일 때만** 쓴다(2026-10-05).
 * 🔴 충돌하면 같은 실행 안에서 새로 읽어 다시 판단한다: 호출부는 실패해도 그 예약의 완료 표식을 남겨
 *    다음 날 다시 오지 않는다(그 계약은 cron 라우트의 `route.groups-mark.test.ts`가 지킨다).
 */
const FROM = [{ id: "g0", title: "옛 줄", classIds: ["c1"] }];
const TO = [{ id: "g1", title: "새 줄", classIds: ["c1", "c2"] }];
const plan: ScheduledGroupPlan = { subject: "english", groups: TO, from: FROM };

type Row = { data: Record<string, unknown>; updated_at: string | null };
const db = {
  row: null as Row | null,
  reads: 0,
  writes: 0,
  /** n번째 읽기 직후 끼어드는 다른 저장. */
  afterRead: new Map<number, () => void>(),
  writeError: false,
};
const admin = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          db.reads += 1;
          const snapshot = db.row ? structuredClone(db.row) : null;
          db.afterRead.get(db.reads)?.();
          return { data: snapshot, error: null };
        },
      }),
    }),
    update: (value: { data: Record<string, unknown>; updated_at: string }) => {
      const conditions: Record<string, unknown> = {};
      const writer = {
        eq: (column: string, expected: unknown) => {
          conditions[column] = expected;
          return writer;
        },
        select: async () => {
          if (db.writeError) return { data: null, error: { message: "boom" } };
          if (!db.row || conditions.updated_at !== db.row.updated_at) return { data: [], error: null };
          db.writes += 1;
          db.row = { data: value.data, updated_at: value.updated_at };
          return { data: [{ tenant_id: "t" }], error: null };
        },
      };
      return writer;
    },
  }),
} as unknown as Parameters<typeof applyScheduledGroupPlan>[0];

const subjects = () => (db.row!.data.operations as { subjects: Record<string, unknown>[] }).subjects;
const english = () => subjects().find((s) => s.key === "english")!;
/** 화면 저장이 끼어든 것 — 다른 칸을 바꾸고 수정 표식을 갱신한다. */
const otherSave = (patch: (data: Record<string, unknown>) => void, stamp: string) => () => {
  patch(db.row!.data);
  db.row!.updated_at = stamp;
};

beforeEach(() => {
  db.reads = 0;
  db.writes = 0;
  db.afterRead = new Map();
  db.writeError = false;
  db.row = {
    data: {
      operations: {
        holidays: [],
        subjects: [
          { key: "math", label: "수학" },
          { key: "english", label: "영어", integrationGroups: FROM },
        ],
      },
    },
    updated_at: "2026-10-05T00:00:00Z",
  };
});

describe("applyScheduledGroupPlan", () => {
  it("그대로면 반영하고 수정 표식을 갱신한다 — 다른 칸은 건드리지 않는다", async () => {
    const result = await applyScheduledGroupPlan(admin, "t", plan);
    expect(result).toEqual({ status: "applied", groups: 1 });
    expect(english().integrationGroups).toEqual(TO);
    expect(english().integrationGroupsEnabled).toBe(true);
    expect(subjects()[0]).toEqual({ key: "math", label: "수학" });
    expect(db.row!.updated_at).not.toBe("2026-10-05T00:00:00Z");
    expect(Date.parse(db.row!.updated_at!)).toBeGreaterThan(Date.parse("2026-10-05T00:00:00Z"));
  });

  it("서버 시계가 저장돼 있던 표식보다 뒤처져 있어도 표식은 직전 값과 같아지지 않는다", async () => {
    db.row!.updated_at = "2099-01-01T00:00:00.000Z";
    await applyScheduledGroupPlan(admin, "t", plan);
    expect(db.row!.updated_at).toBe("2099-01-01T00:00:00.001Z");
  });

  it("🔴 운영 섹션을 다시 쓰므로 그 섹션의 저장 순번을 올린다 — 문서 최상위에는 새 키를 만들지 않는다", async () => {
    (db.row!.data.operations as Record<string, unknown>).rev = 4;
    const topLevelKeys = Object.keys(db.row!.data).sort();
    await applyScheduledGroupPlan(admin, "t", plan);
    expect((db.row!.data.operations as Record<string, unknown>).rev).toBe(5);
    expect(Object.keys(db.row!.data).sort()).toEqual(topLevelKeys);
  });

  it("🔴 읽은 뒤 화면 저장이 끼어들면 그 저장을 덮지 않고, 새로 읽어 다시 반영한다", async () => {
    db.afterRead.set(1, otherSave((data) => ((data.operations as { holidays: unknown[] }).holidays = [{ date: "2026-10-09", name: "한글날" }]), "S1"));
    const result = await applyScheduledGroupPlan(admin, "t", plan);
    expect(result.status).toBe("applied");
    expect(db.reads).toBe(2);
    expect(db.writes).toBe(1);
    expect((db.row!.data.operations as { holidays: unknown[] }).holidays).toEqual([{ date: "2026-10-09", name: "한글날" }]);
    expect(english().integrationGroups).toEqual(TO);
  });

  it("🔴 끼어든 저장이 그룹을 손봤으면 다시 읽은 뒤 건너뛴다(사람이 정한 값을 덮지 않는다)", async () => {
    const mine = [{ id: "gx", title: "사람이 정한 줄", classIds: ["c9"] }];
    db.afterRead.set(1, otherSave(() => (english().integrationGroups = mine), "S1"));
    const result = await applyScheduledGroupPlan(admin, "t", plan);
    expect(result.status).toBe("skipped");
    expect(english().integrationGroups).toEqual(mine);
    expect(db.writes).toBe(0);
  });

  it("세 번 내리 밀리면 그만두고 사유를 돌려준다 — 원문 오류를 싣지 않는다", async () => {
    for (const n of [1, 2, 3]) db.afterRead.set(n, otherSave(() => undefined, `S${n}`));
    const result = await applyScheduledGroupPlan(admin, "t", plan);
    expect(result).toEqual({ status: "error", reason: "설정이 동시에 바뀌어 그룹 배치를 반영하지 못했습니다" });
    expect(db.reads).toBe(3);
    expect(db.writes).toBe(0);
    expect(english().integrationGroups).toEqual(FROM);
  });

  it("쓰기 오류는 다시 시도하지 않는다", async () => {
    db.writeError = true;
    const result = await applyScheduledGroupPlan(admin, "t", plan);
    expect(result).toEqual({ status: "error", reason: "학원 설정을 저장하지 못했습니다" });
    expect(db.reads).toBe(1);
  });

  it("이미 같은 배치면 쓰지 않는다 · 없는 과목은 만들지 않는다", async () => {
    english().integrationGroups = TO;
    expect((await applyScheduledGroupPlan(admin, "t", { ...plan, from: TO })).status).toBe("applied");
    expect(db.writes).toBe(0);
    expect((await applyScheduledGroupPlan(admin, "t", { ...plan, subject: "nope" })).status).toBe("no-subject");
    expect(subjects()).toHaveLength(2);
  });
});
