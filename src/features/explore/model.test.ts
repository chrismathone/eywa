import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECTOR,
  EXPLORE_KINDS,
  SECTOR_DEFS,
  buildGroupModel,
  encodeTrail,
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
  splitSelKey,
  wedgesOf,
  zoomPlan,
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

describe("쐐기 — 같은 과목의 반은 조각 안에서 다시 n분할", () => {
  const base = { icon: "graduationCap" as const, tone: "blue" as const, state: "ready" as const };
  const target = (id: string) => ({ kind: "class" as const, id, label: id.toUpperCase() });
  it("parts가 둘 이상인 조각만 쪼개지고, 각도는 그 조각 안에서 등분", () => {
    const sectors = [
      { key: "subject:math", label: "수학", summary: "2개 반", ...base, parts: [{ key: "a", label: "A", summary: "", target: target("a") }, { key: "b", label: "B", summary: "", target: target("b") }] },
      { key: "attendance", label: "출결", summary: "100%", ...base },
      { key: "grades", label: "성적", summary: "—", ...base, parts: [{ key: "x", label: "X", summary: "", target: target("x") }] },
    ];
    const w = wedgesOf(sectors);
    expect(w.map((x) => x.selKey)).toEqual(["subject:math#a", "subject:math#b", "attendance", "grades#x"]);
    expect(w[0].angles.end - w[0].angles.start).toBeCloseTo(60);
    expect(w[0].angles.start).toBeCloseTo(-150);
    expect(w[1].angles.start).toBeCloseTo(-90);
    expect(w[2].angles.end - w[2].angles.start).toBeCloseTo(120);
    expect(w[0].eyebrow).toBe("수학");
    expect(w[2].eyebrow).toBeNull();
    // 반이 하나인 과목도 같은 꼴(작게 과목 · 굵게 반 이름) — 각도는 조각 그대로.
    expect(w[3]).toMatchObject({ eyebrow: "성적", label: "X" });
    expect(w[3].angles.end - w[3].angles.start).toBeCloseTo(120);
    expect(splitSelKey("subject:math#a")).toEqual({ sectorKey: "subject:math", partKey: "a" });
    expect(splitSelKey("attendance")).toEqual({ sectorKey: "attendance", partKey: null });
  });

  it("조각이 하나면 고리 전체(두 호)로 그린다", () => {
    const p = sectorPath(320, 320, 130, 300, -270, 90);
    expect((p.match(/A /g) ?? []).length).toBe(4);
    expect(p.endsWith("Z")).toBe(true);
  });

  it("영역 중심 모델 — 작은 조각·묶음·읽기 줄이 조각이 되고, 12개를 넘으면 '나머지'가 패널을 맡는다", () => {
    const parent = {
      center: { kind: "student" as const, id: "s1", name: "김민준", subtitle: null, status: null, icon: "user" as const, detailHref: "/students/s1", detailLabel: "원생 상세 열기" },
      sectors: [
        { key: "subject:math", label: "수학", summary: "2개 반", ...base, parts: [{ key: "a", label: "A", summary: "", target: target("a") }, { key: "b", label: "B", summary: "", target: target("b") }], targets: [target("a"), target("b")], groups: [{ label: "지난 수업", targets: [target("old")] }], links: [{ href: "/students/s1?tab=classes", label: "수업 탭 열기" }] },
        { key: "attendance", label: "출결", summary: "100%", ...base, rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: `줄 ${i}`, right: `${i}` })) },
      ],
      defaultSector: "subject:math",
      asOf: "2026-11-03",
    };
    const g = buildGroupModel(parent, "subject:math")!;
    expect(g.center.name).toBe("김민준 · 수학");
    expect(g.center.group).toBe("subject:math");
    expect(g.sectors.map((s) => s.label)).toEqual(["A", "B", "OLD"]);
    expect(g.sectors[2].focus?.meta).toBe("지난 수업");
    expect(g.sectors[0].targets).toBeUndefined();
    expect(g.panelDefault?.key).toBe("subject:math");
    const a = buildGroupModel(parent, "attendance")!;
    expect(a.sectors).toHaveLength(12);
    expect(a.sectors[11].label).toBe("나머지 3");
    expect(buildGroupModel(parent, "nope")).toBeNull();
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

  it("영역 중심(kind:id:sector)도 경로에 실린다 — 과목 조각 key의 ':'까지 그대로", () => {
    const g = { ...s, sector: "subject:math" };
    // `:`는 인코딩해 보낸다 — Next 16이 경로 매개변수를 `subject%3Amath`로 넘기므로 받는 쪽(page)이 푼다.
    expect(exploreHref(g)).toBe(`/explore/student/${s.id}/subject%3Amath`);
    expect(parseTrail(encodeTrail([s, g, c]))).toEqual([s, g, c]);
    expect(parseTrail(`student:${s.id}:bad key`)).toEqual([]);
    expect(nextTrail([s], g, c)).toEqual([s, g]);
    expect(nextTrail([s, g], c, g)).toEqual([s]);
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

describe("흡수 계획 — 더블클릭이 갈 곳과 한 번 클릭이 미리 받을 주소가 같은 함수에서 나온다", () => {
  const base = { icon: "graduationCap" as const, tone: "blue" as const, state: "ready" as const };
  const target = (id: string) => ({ kind: "class" as const, id, label: id.toUpperCase() });
  const model = {
    center: { kind: "student" as const, id: "s1", name: "김민준", subtitle: null, status: null, icon: "user" as const, detailHref: "/students/s1", detailLabel: "원생 상세 열기" },
    sectors: [
      { key: "subject:math", label: "수학", summary: "2개 반", ...base, parts: [{ key: "a", label: "A", summary: "", target: target("a") }, { key: "b", label: "B", summary: "", target: target("b") }], targets: [target("a"), target("b")] },
      { key: "subject:english", label: "영어", summary: "E", ...base, targets: [target("e")] },
      { key: "attendance", label: "출결", summary: "100%", ...base, icon: "calendarCheck" as const, rows: [{ id: "r1", title: "줄", right: "1" }], links: [{ href: "/students/s1?tab=attendance", label: "출결 탭 열기" }] },
    ],
    defaultSector: "subject:math",
    asOf: "2026-11-03",
  };

  it("작은 조각 → 그 반이 중심 · 경로엔 지금 중심 · 떠나는 쐐기 key는 고른 것", () => {
    expect(zoomPlan(model, "subject:math#b", [], false)).toEqual({
      go: "/explore/class/b?t=student%3As1",
      to: { kind: "class", id: "b" },
      leaving: { key: "subject:math#b", kind: "class", label: "B" },
    });
  });

  it("대상이 하나인 조각 → 그 대상 · 대상이 없는 조각(1단계) → 영역 중심(조각 그림을 든다) · 창 안이면 embed", () => {
    expect(zoomPlan(model, "subject:english", [], false)).toMatchObject({ go: "/explore/class/e?t=student%3As1", to: { kind: "class", id: "e" } });
    expect(zoomPlan(model, "attendance", [{ kind: "class", id: "c0" }], true)).toEqual({
      go: "/explore/student/s1/attendance?t=class%3Ac0%2Cstudent%3As1&embed=1",
      to: { kind: "student", id: "s1", sector: "attendance" },
      leaving: { key: "attendance", kind: "student", label: "출결", icon: "calendarCheck" },
    });
  });

  it("영역 중심(2단계) — 대상 조각은 그 대상, 통계 줄 조각은 그 영역의 업무 화면 링크 · 모르는 조각은 null", () => {
    const g = buildGroupModel(model, "subject:math")!;
    expect(zoomPlan(g, g.sectors[0].key, [], false)).toMatchObject({ go: "/explore/class/a?t=student%3As1%3Asubject%3Amath", to: { kind: "class", id: "a" } });
    const a = buildGroupModel(model, "attendance")!;
    expect(zoomPlan(a, a.sectors[0].key, [], false)).toEqual({ link: "/students/s1?tab=attendance" });
    expect(zoomPlan(model, "nope", [], false)).toBeNull();
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
