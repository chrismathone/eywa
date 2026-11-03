import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTOR,
  EXPLORE_KINDS,
  SECTOR_DEFS,
  exploreHref,
  monthDayKo,
  nextTrail,
  oneLine,
  othersLabel,
  parseTrail,
  polar,
  sectorAngles,
  sectorOffset,
  sectorPath,
} from "./model";

describe("조각 표 — 시안의 수와 차례", () => {
  it("원생 8 · 수업 6 · 강사 6, 맨 위 조각이 기본 패널", () => {
    expect(SECTOR_DEFS.student.map((s) => s.label)).toEqual(["수업", "출결", "성적", "진도", "상담", "특이사항", "수납", "타임라인"]);
    expect(SECTOR_DEFS.class.map((s) => s.label)).toEqual(["수강 원생", "담임 강사", "시간표", "강의실", "출석부", "강사 시트"]);
    expect(SECTOR_DEFS.teacher.map((s) => s.label)).toEqual(["담당 수업", "수업 시간표", "담당 원생", "강사 시트", "수업보고서", "직원 정보"]);
    for (const kind of EXPLORE_KINDS) {
      const keys = SECTOR_DEFS[kind].map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      expect(keys[0]).toBe(DEFAULT_SECTOR[kind]);
    }
  });
});

describe("도넛 기하", () => {
  it("0번 조각은 맨 위 가운데를 품고 시계 방향으로 같은 크기", () => {
    const a = sectorAngles(8, 0);
    expect(a.mid).toBe(-90);
    expect(a.end - a.start).toBe(45);
    expect(sectorAngles(8, 2).mid).toBe(0); // 오른쪽
    expect(sectorAngles(6, 3).mid).toBe(90); // 아래
    expect(() => sectorAngles(0, 0)).toThrow();
  });

  it("돌출은 중심선 방향으로만 움직인다(모양은 그대로)", () => {
    expect(sectorOffset(-90, 16)).toEqual({ dx: expect.closeTo(0, 6), dy: -16 });
    const right = sectorOffset(0, 10);
    expect(right.dx).toBeCloseTo(10);
    expect(right.dy).toBeCloseTo(0);
  });

  it("조각 path는 닫힌 고리 조각이고 반지름이 커도 큰 호 플래그는 180도 넘을 때만", () => {
    const p = sectorPath(320, 320, 130, 300, -112.5, -67.5);
    expect(p.startsWith("M ")).toBe(true);
    expect(p.endsWith("Z")).toBe(true);
    expect(p).toContain("A 300 300 0 0 1");
    expect(p).toContain("A 130 130 0 0 0");
    expect(sectorPath(0, 0, 1, 2, 0, 200)).toContain("A 2 2 0 1 1");
    expect(polar(0, 0, 10, 90)).toEqual({ x: expect.closeTo(0, 6), y: 10 });
  });
});

describe("탐색 경로 주소", () => {
  const s = { kind: "student" as const, id: "11111111-1111-4111-8111-111111111111" };
  const c = { kind: "class" as const, id: "22222222-2222-4222-8222-222222222222" };
  const t = { kind: "teacher" as const, id: "33333333-3333-4333-8333-333333333333" };

  it("주소 ↔ 경로가 왕복하고, 모르는 종류·이상한 id·중복은 버린다", () => {
    const href = exploreHref(t, { trail: [s, c], sector: "classes", embed: true });
    expect(href).toBe(`/explore/teacher/${t.id}?t=student%3A${s.id}%2Cclass%3A${c.id}&sector=classes&embed=1`);
    expect(parseTrail(new URL(href, "https://x.invalid").searchParams.get("t"))).toEqual([s, c]);
    expect(parseTrail(`guardian:abc,student:${s.id},student:${s.id},class:bad id`)).toEqual([s]);
    expect(parseTrail(undefined)).toEqual([]);
    expect(exploreHref(s)).toBe(`/explore/student/${s.id}`);
  });

  it("다음 경로 — 앞으로 가면 지금 중심을 붙이고, 경로에 있던 대상으로 가면 거기까지 되감는다", () => {
    expect(nextTrail([], s, c)).toEqual([s]);
    expect(nextTrail([s], c, t)).toEqual([s, c]);
    expect(nextTrail([s, c], t, s)).toEqual([]);
    expect(nextTrail([s, c], t, c)).toEqual([s]);
    expect(nextTrail([s], c, c)).toEqual([s]);
  });

  it("경로는 8개까지 — 넘치면 오래된 것부터", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: "student" as const, id: `id-${i}` }));
    expect(parseTrail(many.map((m) => `${m.kind}:${m.id}`).join(",")).map((m) => m.id)[0]).toBe("id-1");
    expect(nextTrail(many.slice(0, 8), c, t)).toHaveLength(8);
  });
});

describe("요약 문구", () => {
  it("외 N명 · 월 일 · 한 줄", () => {
    expect(othersLabel(["김민준", "박서연", "이도윤"], "명")).toBe("김민준 외 2명");
    expect(othersLabel(["수학 심화 A"], "개")).toBe("수학 심화 A");
    expect(othersLabel([], "명")).toBe("");
    expect(monthDayKo("2025-11-01")).toBe("11월 1일");
    expect(monthDayKo("2025-11-01T10:00:00+09:00")).toBe("11월 1일");
    expect(oneLine("  줄1\n줄2  ", 5)).toBe("줄1 줄2");
    expect(oneLine("  줄1\n줄2  ", 4)).toBe("줄1 …");
    expect(oneLine(null)).toBe("");
  });
});
