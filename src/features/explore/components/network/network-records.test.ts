import { describe, expect, it } from "vitest";
import { buildNetGraph, fullGraphOf, netHeadOf, netNeighbors, summaryGraph } from "./graph";
import { placeLabels } from "./labels";
import { isGroupOpen, netFitView, netLayout, netRadius } from "./layout";
import { hoverText, visibleOf } from "./node-actions";
import { buildGroupModel } from "../../model";
import { CENTERS, CLASS } from "./testing/fixture";
import { groupTitle, netDateText, recordYmd } from "./time-tree";

/**
 * 원장 2026-11-06 네트워크 '개별 기록' 검수 — 날짜 묶음(연도 → 월 → 일자) · 같은 기록 한 번 · 되풀이 점 접기 · hover 카드의 날짜.
 * 표본 = 서버 조회와 같은 줄 모양([`testing/fixture-records.ts`](./testing/fixture-records.ts)).
 */

const recIds = (id: string) => buildNetGraph(CENTERS[id]).nodes.filter((n) => n.kind === "record");

describe("날짜 묶음 — 연도 → 월 → (같은 날 여럿이면) 일자", () => {
  it("상담 5건(2025·2026) = 연도 2 → 월 4 → 기록 · 최근 먼저 · 이름에 기간과 건수", () => {
    const g = fullGraphOf(CENTERS["student:s1"]);
    const groups = g.nodes.filter((n) => n.kind === "group" && n.hub === "hub:consultations");
    expect(groups.map((n) => n.label)).toEqual(["2026년 · 4건", "10월 · 2건", "9월 · 1건", "4월 · 1건", "2025년 · 1건", "12월 · 1건"]);
    expect(groups.map((n) => n.title)).toContain("2026년 9월");
    const cs3 = g.nodes.find((n) => n.id === "rec:consultations:cs3")!;
    expect([cs3.parent, cs3.label]).toEqual(["grp:consultations:2026-09", "30일 · 30일 날 결석한다고 해서 이날 MT치는 날이라 따로 와서 시험치면 된다고 함"]);
    // 영역 → 연도 → 월 → 기록으로만 잇는다(영역에서 기록으로 바로 가는 선 없음)
    expect(g.edges.some((e) => e.from === "hub:consultations" && e.to === "rec:consultations:cs3")).toBe(false);
    expect(g.edges.filter((e) => e.to === "rec:consultations:cs3" && e.rel !== "근거").map((e) => e.from)).toEqual(["grp:consultations:2026-09"]);
  });

  it("같은 날 기록이 둘 이상이면 일자 묶음(수업 출석부 = 하루 12명) · 하루 한 건이면 기록이 곧 일자", () => {
    const g = fullGraphOf(CENTERS["class:c1"]);
    const days = g.nodes.filter((n) => n.level === "day");
    expect(days.length).toBeGreaterThan(10);
    expect(days.every((d) => d.tally === 12)).toBe(true);
    const rec = g.nodes.find((n) => n.parent === "grp:attendance:2026-10-21")!;
    expect(rec.label).toBe(rec.title); // 일자 아래 = 학생 이름만(날짜를 12번 되풀이하지 않는다)
    expect(fullGraphOf(CENTERS["student:s1"]).nodes.some((n) => n.level === "day")).toBe(false);
  });

  it("날짜 글 = 연도 포함 한 표기 · 달력에 없는 날은 지어내지 않는다", () => {
    expect(netDateText("2026-09-30")).toBe("2026년 9월 30일 (수)");
    expect(netDateText("2026-09-30T10:00:00+09:00")).toBe("2026년 9월 30일 (수)");
    expect(groupTitle("2026-10")).toBe("2026년 10월");
    expect(recordYmd("2026-13-40")).toBeNull();
    expect(netDateText(null)).toBeNull();
    // 시각이 붙은 값 = KST 날짜(UTC 9/30 20:00 = KST 10/1 05:00)
    expect(recordYmd("2026-09-30T20:00:00Z")).toBe("2026-10-01");
    expect(recordYmd("2026-09-30T20:00:00+09:00")).toBe("2026-09-30");
    expect(recordYmd("2026-09-30T23:30:00")).toBe("2026-09-30"); // 시간대 없음 = 벽시계 날짜(서버·브라우저 같은 답)
  });
});

describe("같은 기록은 한 번 · 되풀이 점 접기", () => {
  it("영역 중심 '출결' — 출석 횟수·기록·출석에 같은 기록이 있으면 가장 좁은 영역(출석·지각·결석·인정결석)에만", () => {
    const recs = recIds("student:s1:attendance");
    const rows = recs.filter((n) => n.rowId && !n.rowId.startsWith("c:"));
    expect(new Set(rows.map((n) => n.rowId)).size).toBe(rows.length); // 같은 기록이 두 점이 되지 않는다
    expect(rows).toHaveLength(27);
    const by = (k: string) => rows.filter((n) => n.sectorKey === k).length;
    expect([by("r:attended"), by("r:total"), by("r:present"), by("r:late"), by("r:absent"), by("r:excused")]).toEqual([0, 0, 23, 2, 1, 1]);
    const g = fullGraphOf(CENTERS["student:s1:attendance"]);
    const attended = g.nodes.find((n) => n.id === "hub:r:attended")!;
    expect([attended.movedTo, attended.moved]).toEqual([["출석", "지각"], 25]);
    expect(recs.filter((n) => n.sectorKey === "r:rate")).toHaveLength(3); // 반별 출석률은 그대로
  });

  it("영역 중심 '상담' — 조각 = 그 기록 하나라 점을 한 번 더 세우지 않고 영역 점이 날짜·내용을 든다", () => {
    expect(recIds("student:s1:consultations")).toHaveLength(0);
    const hub = fullGraphOf(CENTERS["student:s1:consultations"]).nodes.find((n) => n.id === "hub:r:cs3")!;
    expect([hub.date, hub.detail]).toEqual(["2026-09-30", "영어 · 정유진"]);
  });

  it("🔴 대상 조각(반)의 속성 줄은 줄 id가 반마다 같아도 옮기지 않는다 — 원생 '수학' · 강의실·강사 '수업' 영역 중심", () => {
    for (const [c, n] of [["student:s1:subject:math", 4], ["room:r1:classes", 2], ["teacher:t1:classes", 2]] as const) {
      const g = fullGraphOf(CENTERS[c]);
      for (const hub of g.nodes.filter((x) => x.kind === "hub")) {
        expect(g.nodes.filter((x) => x.hub === hub.id && x.kind === "record"), `${c} ${hub.title}`).toHaveLength(n);
        expect(hub.movedTo).toBeUndefined();
      }
    }
  });

  it("수업 중심 — 강의실 대상이 있으면 교시마다 방 줄은 점이 아니다 · 0건 줄(items: [])은 점이 없다", () => {
    const g = fullGraphOf(CENTERS["class:c1"]);
    expect(g.nodes.filter((n) => n.hub === "hub:room").map((n) => n.id)).toEqual(["room:r1"]);
    expect(g.nodes.some((n) => n.id === "rec:attendance:excused")).toBe(false);
  });

  it("영역 중심 '수강 원생' — 대상 조각의 소개 줄(학교학년) 점 없음 · '나머지'가 이미 선 원생을 다시 세우지 않는다", () => {
    expect(fullGraphOf(CENTERS["class:c1:students"]).nodes.some((n) => n.rowId === "about")).toBe(false);
    // 원생 15명 → 조각 11 + '나머지 4'(조각 상한 12)
    const extra = Array.from({ length: 3 }, (_, i) => ({ kind: "student" as const, id: `x${i}`, label: `추가${i}`, detail: "경명여중2" }));
    const students = CLASS.sectors.find((s) => s.key === "students")!;
    const model = buildGroupModel({ ...CLASS, sectors: [{ ...students, targets: [...(students.targets ?? []), ...extra] }] }, "students")!;
    const g = buildNetGraph({ model });
    const more = g.nodes.filter((n) => n.hub === "hub:more" && n.kind === "target").map((n) => n.id);
    expect(more).toEqual(["student:s12", "student:x0", "student:x1", "student:x2"]);
  });
});

describe("펼치기·접기 · 머리 수 · 이웃", () => {
  it("처음 = 연도만 펼침(월이 보이고 그 아래 기록은 접힘) · 월을 펼치면 그 달 기록 · 영역 자리는 그대로", () => {
    const S = CENTERS["student:s1"];
    const closed = netLayout(S, "records");
    expect(closed.pos["grp:consultations:2026-10"]).toBeTruthy();
    expect(closed.pos["rec:consultations:cs1"]).toBeUndefined();
    const open = netLayout(S, "records", new Set(["grp:consultations:2026-10"]));
    expect(open.pos["rec:consultations:cs1"]).toBeTruthy();
    expect(open.pos["rec:consultations:cs3"]).toBeUndefined();
    expect(open.pos["hub:consultations"]).toEqual(closed.pos["hub:consultations"]);
    const y = fullGraphOf(S).nodes.find((n) => n.id === "grp:consultations:2026")!;
    expect([isGroupOpen(y), isGroupOpen(y, new Set([y.id]))]).toEqual([true, false]);
    // 접힌 기록을 골랐으면 보이는 위 점(그 달)을 강조한다
    expect(visibleOf(closed, fullGraphOf(S).nodes, "rec:consultations:cs1")).toBe("grp:consultations:2026-10");
  });

  it("머리 '기록 N개 · 연결선 N개' = 접힌 묶음 안까지(펼치고 접어도 같다) · 조각 자체인 기록도 센다", () => {
    const S = CENTERS["student:s1"];
    const full = fullGraphOf(S);
    const closed = netHeadOf(netLayout(S, "records"), "김서연", full);
    const open = netHeadOf(netLayout(S, "records", new Set(["grp:consultations:2026-10"])), "김서연", full);
    expect([open.nodes, open.edges]).toEqual([closed.nodes, closed.edges]);
    expect(closed.nodes).toBe(full.nodes.filter((n) => ["record", "target", "analysis", "fact"].includes(n.kind)).length);
    const C = CENTERS["student:s1:consultations"];
    expect(netHeadOf(netLayout(C, "records"), "김서연 · 상담", fullGraphOf(C)).nodes).toBe(5);
  });

  it("요약 판 영역 크기 = 그 영역의 기록(옮겨 선 기록 · 조각 자체인 기록 포함 — '0'이 아니다)", () => {
    const att = summaryGraph(fullGraphOf(CENTERS["student:s1:attendance"]));
    const count = (id: string) => att.nodes.find((n) => n.id === id)?.count;
    expect([count("hub:r:attended"), count("hub:r:total"), count("hub:r:present")]).toEqual([25, 27, 23]);
    expect(summaryGraph(fullGraphOf(CENTERS["student:s1:consultations"])).nodes.find((n) => n.id === "hub:r:cs3")?.count).toBe(1);
  });

  it("펼치기·접기(keep) = 그 묶음의 위 점 아래만 새 배치(위 점이 옮겨진 만큼) · 나머지는 끌어 둔 자리 그대로", () => {
    const S = CENTERS["student:s1"];
    const before = netLayout(S, "records");
    const year = "grp:consultations:2026";
    before.pos[year] = { x: before.pos[year].x + 40, y: before.pos[year].y - 25 };
    before.pos["hub:grades"] = { x: 999, y: 999 };
    const set = new Set(["grp:consultations:2026-10"]);
    const fresh = netLayout(S, "records", set);
    const kept = netLayout(S, "records", set, { from: before.pos, around: "grp:consultations:2026-10" });
    expect(kept.pos["hub:grades"]).toEqual({ x: 999, y: 999 });
    expect(kept.pos[year]).toEqual(before.pos[year]); // 위 점(연도)은 끌어 둔 자리에 남는다
    const shift = { x: before.pos[year].x - fresh.pos[year].x, y: before.pos[year].y - fresh.pos[year].y };
    for (const id of ["rec:consultations:cs1", "grp:consultations:2026-09"]) {
      expect(kept.pos[id].x).toBeCloseTo(fresh.pos[id].x + shift.x, 6);
      expect(kept.pos[id].y).toBeCloseTo(fresh.pos[id].y + shift.y, 6);
    }
  });

  it("연달아 펼쳐도 기록 점이 겹치지 않는다(수업 출석부 10월 → 21일 → 23일 · 원생 출결 10월 → 11월)", () => {
    const run = (c: string, steps: string[]) => {
      let b = netLayout(CENTERS[c], "records");
      const set = new Set<string>();
      for (const id of steps) {
        set.add(id);
        b = netLayout(CENTERS[c], "records", new Set(set), { from: b.pos, around: id });
      }
      const recs = b.nodes.filter((n) => n.kind === "record" || n.kind === "group");
      let close = 0;
      for (let i = 0; i < recs.length; i++)
        for (let j = i + 1; j < recs.length; j++) if (Math.hypot(b.pos[recs[i].id].x - b.pos[recs[j].id].x, b.pos[recs[i].id].y - b.pos[recs[j].id].y) < 6.4) close++;
      return close;
    };
    expect(run("class:c1", ["grp:attendance:2026-10", "grp:attendance:2026-10-21", "grp:attendance:2026-10-23"])).toBe(0);
    expect(run("student:s1", ["grp:attendance:2026-10", "grp:attendance:2026-11"])).toBe(0);
  });

  it("묶음을 고르면 '이어진 것' = 그 안에 든 것(최근 먼저)", () => {
    const n = netNeighbors(CENTERS["student:s1"], "grp:consultations:2026-10");
    expect(n.map((x) => x.id)).toEqual(["rec:consultations:cs1", "rec:consultations:cs2"]);
    expect(netNeighbors(CENTERS["student:s1"], "rec:consultations:cs1").some((x) => x.id.startsWith("grp:"))).toBe(false);
  });
});

describe("hover 카드 둘째 줄", () => {
  const S = CENTERS["student:s1"];
  const B = netLayout(S, "records", new Set(["grp:consultations:2026-09"]));
  const node = (id: string) => B.nodes.find((n) => n.id === id)!;

  it("기록 = 날짜(연도 포함) · 내용 · 분석 근거 · 더블클릭 — '이웃 1개' 같은 늘 같은 숫자는 없다", () => {
    const t = hoverText(node("rec:consultations:cs3"), B);
    expect(t).toBe("2026년 9월 30일 (수) · 영어 · 정유진 · 분석 근거 1건 · 더블클릭 = 자세히");
    expect(hoverText(node("rec:attendance:c:중2 수학 A반"), B)).not.toMatch(/이웃/);
  });

  it("묶음 = 영역 이름 + 건수 · 펼치기/접기 · 영역 = 요약 글 + 기록 수 + 더블클릭이 할 일", () => {
    expect(hoverText(node("grp:consultations:2026-10"), B)).toBe("상담 2건 · 더블클릭 = 펼치기");
    expect(hoverText(node("grp:consultations:2026-09"), B)).toBe("상담 1건 · 더블클릭 = 접기");
    expect(hoverText(node("hub:consultations"), B)).toBe("최근 상담 10월 28일 · 기록 5개 · 더블클릭 = 흡수");
    expect(hoverText(node("hub:subject:math"), B)).toBe("2개 반 · 연결 2개 · 더블클릭 = 중2 수학 A반 중심으로");
  });

  it("영역 중심 — 기록이 옮겨 선 영역은 어디로 갔는지 · 기록 하나짜리 조각은 그 기록의 날짜", () => {
    const A = netLayout(CENTERS["student:s1:attendance"], "records");
    expect(hoverText(A.nodes.find((n) => n.id === "hub:r:attended")!, A)).toBe("25회 · 기록 25건은 출석·지각에 · 더블클릭 = 원본 화면 열기");
    const C = netLayout(CENTERS["student:s1:consultations"], "records");
    expect(hoverText(C.nodes.find((n) => n.id === "hub:r:cs3")!, C)).toMatch(/^2026년 9월 30일 \(수\) · 영어 · 정유진/);
    // 요약 판도 같은 글(날짜는 한글 표기 · '기록 0개' 없음)
    const CS = netLayout(CENTERS["student:s1:consultations"], "summary");
    expect(hoverText(CS.nodes.find((n) => n.id === "hub:r:cs3")!, CS)).toMatch(/^2026년 9월 30일 \(수\) · 영어 · 정유진 · 이웃 영역·분석/);
    const AS = netLayout(CENTERS["student:s1:attendance"], "summary");
    expect(hoverText(AS.nodes.find((n) => n.id === "hub:r:attended")!, AS)).not.toMatch(/기록 0개/);
  });

  it("영역 출결 = 날짜 기록 수(연도 묶음 'N건'과 같다) · 반별 출석률은 '항목'", () => {
    expect(hoverText(node("hub:attendance"), B)).toBe("최근 30일 93% · 기록 27개 · 항목 3개 · 더블클릭 = 흡수");
    expect(B.nodes.find((n) => n.id === "grp:attendance:2026")?.label).toBe("2026년 · 27건");
  });
});

describe("이름 배치", () => {
  const SIZE = { w: 1000, h: 640 };
  const labelsOf = (b: ReturnType<typeof netLayout>, active: string | null) => {
    const v = netFitView(b, SIZE);
    const at = (id: string) => (b.pos[id] ? { x: b.pos[id].x * v.k + v.x, y: b.pos[id].y * v.k + v.y } : null);
    return placeLabels({ nodes: b.nodes, at, radius: (n) => Math.max(2, netRadius(n, b) * Math.sqrt(v.k)), active, neighbors: active ? (b.adjacency.get(active) ?? null) : null, hubHover: false, showAll: false, k: v.k, dark: b.mode === "summary", centerId: b.centerId, bounds: SIZE });
  };
  it("판 경계에 걸려도 영역 이름은 사라지지 않는다(요약 판 맨 아래 영역)", () => {
    for (const c of ["student:s1", "student:s1:attendance"]) {
      const b = netLayout(CENTERS[c], "summary");
      const shown = new Set(labelsOf(b, null).map((l) => l.id));
      for (const h of b.nodes.filter((n) => n.kind === "hub")) expect(shown.has(h.id), `${c} ${h.id}`).toBe(true);
    }
  });
  it("고른 점의 이웃 이름이 날짜 묶음 이름보다 먼저 — 펼친 하루의 학생 12명이 다 보인다", () => {
    const b = netLayout(CENTERS["class:c1"], "records", new Set(["grp:attendance:2026-10", "grp:attendance:2026-10-21"]));
    const shown = new Set(labelsOf(b, "grp:attendance:2026-10-21").map((l) => l.id));
    expect(b.nodes.filter((n) => n.parent === "grp:attendance:2026-10-21").every((n) => shown.has(n.id))).toBe(true);
  });
});
