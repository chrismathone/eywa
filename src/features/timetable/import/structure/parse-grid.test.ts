import { describe, expect, it } from "vitest";
import { parseTeacherGrid } from "./parse-grid";
import type { SheetGrid } from "./types";
// 실제 인재원 강사별영어시간표(7월) 시트를 Sheets includeGridData 형태로 스냅샷한 픽스처.
// (구글시트 export → xlsx → 셀+병합 추출. 값은 formattedValue, 병합은 0-based end-exclusive.)
import fixtureJson from "./fixtures/teacher-grid.sample.json";

const fixture = fixtureJson as unknown as SheetGrid;

describe("parseTeacherGrid — 실 강사별 그리드", () => {
  const parsed = parseTeacherGrid(fixture);

  it("강사 블록 16개를 인식", () => {
    expect(parsed.teachers).toHaveLength(16);
  });

  it("첫 블록 = Jane / 담임 방 301 / index 1", () => {
    const jane = parsed.teachers[0]!;
    expect(jane.name).toBe("Jane");
    expect(jane.homeRoom).toBe("301");
    expect(jane.index).toBe(1);
  });

  it("예비 블록 4개(예비1~4)", () => {
    expect(parsed.teachers.filter((t) => t.reserve)).toHaveLength(4);
  });

  // 핀 갱신 2026-07-22: 275 → 330. 요일 헤더가 가로 병합된 **병렬 레인**(LAB: JJ·이주희)을 파서가
  // 통째로 건너뛰고 있었다(병합 셀은 좌상단에만 값 → 나머지 레인이 "요일 없음"). 55슬롯 = 2026-07-06에
  // `import-lab-parallel-slots.cjs`로 따로 이식해야 했던 그 병렬 수업들 — 이제 파서가 직접 읽는다.
  // 2026-07-22 2차: 비수업 칸(감독·쉬는 시간·수업준비·회의·연차)이 slots에서 blocks로 빠졌다(0138a).
  // 합계는 보존된다 — 한 칸은 수업이거나 블록이지 둘 다일 수 없다.
  it("인식 칸 330건 = 수업 슬롯 + 비수업 블록(상호배타·합계 보존)", () => {
    expect(parsed.slots.length + parsed.blocks.length).toBe(330);
    expect(parsed.slots.length).toBeGreaterThan(0);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("강사 이름이 반으로 남지 않는다(감독 칸은 blocks로 빠진다)", () => {
    // ⚠️ 이 픽스처는 7/9 개편 이전 스냅샷이라 감독('JJ') 칸이 아직 없다 — 승격 자체는 아래 합성 격자로
    //    검증하고, 여기선 "강사 이름이 반 이름 자리에 남아 있지 않다"는 불변만 지킨다.
    const names = new Set(parsed.teachers.map((t) => t.name));
    expect(parsed.slots.some((s) => names.has(s.className))).toBe(false);
  });

  it("감독 승격: 다른 강사 이름 한 단어인 칸 = supervise 블록(반 아님)", () => {
    // 2026-07-22 원장 확인: "병합 셀에 JJ 문구 딱 하나면 실제 JJ 수업이 맞아. 감독하러 가야함."
    // 감독 칸 1개가 JJ 수업 0~5개에 걸쳐(LAB 병렬) 반으로 환원되지 않으므로 blocks로 뺀다(0138a).
    const grid = {
      cells: [
        ["", "1", "", "2", ""],
        ["", "JJ 김주희 305", "", "Dom 김동후 303", ""],
        ["", "", "", "", ""],
        ["", "월", "화", "월", "화"],
        ["4:20~5:00", "중등E_중1 TOP/305", "쉬는 시간", "JJ", "Dom"],
      ],
      merges: [],
    };
    const r = parseTeacherGrid(grid as unknown as SheetGrid);
    // JJ 블록 월 = 진짜 수업 1건만 슬롯으로.
    expect(r.slots.map((s) => s.className)).toEqual(["중등E_중1 TOP"]);
    const kinds = r.blocks.map((b) => `${b.teacherName}:${b.kind}:${b.label}`).sort();
    // JJ 화 "쉬는 시간" = break · Dom 월 "JJ" = 감독 · Dom 화 "Dom"(자기 이름) = 승격 안 함(반 취급도 안 함).
    expect(kinds).toContain("JJ:break:쉬는 시간");
    expect(kinds).toContain("Dom:supervise:JJ");
    expect(r.blocks.find((b) => b.kind === "supervise")?.superviseTarget).toBe("JJ");
    // ⚠️ 자기 이름 칸은 감독이 아니지만 **반도 아니다** — 'other'로 담기고 슬롯엔 안 남는다.
    const self = r.blocks.find((b) => b.teacherName === "Dom" && b.label === "Dom");
    expect(self?.kind).toBe("other");
    expect(self?.superviseTarget).toBeUndefined();
  });

  it("⚠️ 마지막 블록 우측 레인 — 요일 헤더 행이 짧아도(ragged) 안 잘린다", () => {
    // 2026-07-22 실측 사고: Sheets API rowData는 행마다 길이가 다르다(마지막 유효 셀까지만).
    // 요일 헤더는 가로 병합이라 짧게 끝나는데 그걸 마지막 블록 경계로 쓰면 우측 레인이 통째로
    // 스킵된다 → 이주희 금요일 5슬롯이 조용히 사라지고 컷오버가 'remove'로 마감했다.
    // 아래 격자는 그 형태를 최소 재현: 요일 헤더 행(길이 3)이 데이터 행(길이 5)보다 짧다.
    const grid = {
      cells: [
        ["", "1"],
        ["", "이주희 T LAB (603호)"],
        [""],
        ["", "금"], // ← 길이 2. 병합이 c1~c3을 덮지만 값은 좌상단에만.
        ["4:20~5:00", "LS2b/603", "LS2a/603", "JP1/603"], // ← 길이 4
      ],
      merges: [{ startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 4 }],
    };
    const r = parseTeacherGrid(grid as unknown as SheetGrid);
    // 헤더 행 길이(2)로 잘렸다면 LS2b 하나만 잡힌다. 최대 행 길이(4)를 써야 셋 다 잡힌다.
    expect(r.slots.map((s) => s.className).sort()).toEqual(["JP1", "LS2a", "LS2b"]);
    for (const s of r.slots) expect(s.day).toBe("fri");
  });

  it("병렬 레인: 같은 강사·요일·시각에 여러 반(LAB) — 병합 요일헤더를 펼쳐야 잡힌다", () => {
    const key = (s: (typeof parsed.slots)[number]) => `${s.teacherName}|${s.day}|${s.startTime}`;
    const counts = new Map<string, number>();
    for (const s of parsed.slots) counts.set(key(s), (counts.get(key(s)) ?? 0) + 1);
    const parallel = [...counts.entries()].filter(([, n]) => n > 1);
    expect(parallel.length).toBeGreaterThan(0);
    // 실제로 LAB 강사(이주희·JJ)에서 나와야 한다 — 일반 강사는 요일당 1레인.
    expect(parallel.some(([k]) => k.startsWith("이주희|") || k.startsWith("JJ|"))).toBe(true);
  });

  it("모든 슬롯: 요일 mon~sat, 시작시각 HH:MM", () => {
    const days = new Set(["mon", "tue", "wed", "thu", "fri", "sat"]);
    for (const s of parsed.slots) {
      expect(days.has(s.day)).toBe(true);
      expect(s.startTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("스팟체크: Jane 월 '중등E_중2 심화' → 방 301, 16:20~17:20 (행 인덱스 규칙)", () => {
    // end=17:20이 진실(병합 6행 × 10분, DB normalized_model과 일치). 옛 기대값 17:00은
    // A열 라벨("4:20~5:00") 기반 오류였음 — 라벨 텍스트는 불규칙해 신뢰 불가(2026-07-06 정정).
    const s = parsed.slots.find(
      (x) => x.teacherName === "Jane" && x.day === "mon" && x.className === "중등E_중2 심화",
    );
    expect(s).toBeDefined();
    expect(s!.room).toBe("301");
    expect(s!.startTime).toBe("16:20");
    expect(s!.endTime).toBe("17:20");
  });

  it("행 인덱스 규칙: 모든 슬롯 시각이 10분 격자 정렬 + end > start", () => {
    const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    for (const s of parsed.slots) {
      expect(min(s.startTime) % 10).toBe(0);
      expect(s.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(min(s.endTime!)).toBeGreaterThan(min(s.startTime));
    }
  });

  it("레벨코드 수업(LT2/KW6 등)과 내신 수업이 함께 존재", () => {
    const names = new Set(parsed.slots.map((s) => s.className));
    expect([...names].some((n) => /^[A-Z]{2,3}\d/.test(n))).toBe(true); // 영어 레벨코드
    expect(names.has("중등E_중2 심화")).toBe(true); // 내신
  });

  it("SKY 이름 반의 방 = 실방(반명 제외 잔여에서만 방 탐색 — 'SKY' 오인 금지)", () => {
    // 옛 동작: raw 전체 ROOM_RE 매칭 → 반명 "중등E_초6 SKY"의 SKY가 방으로 오인(원 임포트
    // '본원SKY' 오류의 근본 원인). 정정 후: 그 셀들의 방은 실방(301/303 등 숫자 3자리)이어야 한다.
    const skyClasses = parsed.slots.filter((s) => /SKY/.test(s.className));
    expect(skyClasses.length).toBeGreaterThan(0);
    for (const s of skyClasses) expect(s.room).toMatch(/^\d{3}$/);
    // room==='SKY'는 실제 방 줄에 SKY라고 적힌 경우에만 — 현 시트엔 없다.
    expect(parsed.slots.filter((s) => s.room === "SKY")).toHaveLength(0);
  });

  it("선두 '*'(보강 표식)는 반명에서 떼고 starred로만 남긴다 — 안 그러면 기존 반과 매칭 실패", () => {
    // 2026-07-22 실측: 마스터 시트 7/9~ 탭의 *MEC1-3·*JP1·*LT4가 반명에 별표를 달고 나와
    // 기존 반(MEC1-3 등)에 매칭되지 못하고 "eywa에 없는 반"으로 통째 제외됐다.
    expect(parsed.slots.some((s) => s.className.startsWith("*"))).toBe(false);
    const grid = {
      cells: [
        ["", "1"], // 1행 = 블록 번호(블록 시작 열 판별)
        ["", "Test 강사 301"], // 2행 = 강사 헤더
        ["", ""], // 3행 = 메모
        ["", "월"], // 4행 = 요일 헤더
        ["4:20~5:00", "*MEC1-3/606"], // 5행+ = 데이터
      ],
      merges: [],
    };
    const starred = parseTeacherGrid(grid as unknown as SheetGrid).slots[0]!;
    expect(starred.className).toBe("MEC1-3");
    expect(starred.starred).toBe(true);
  });

  // ── 색 규칙(원장 2026-08-04 "색 없는 건 다 수업이 아님") ──────────────────────
  describe("fills — 색칠된 칸만 수업", () => {
    // 5행부터 데이터. 월=col1: 색칠된 진짜 반 / 화=col2: 무색 메모 / 수=col3: 무색 비수업 블록.
    const base = {
      cells: [
        ["", "1", "", ""],
        ["", "Test 강사 301", "", ""],
        ["", "", "", ""],
        ["", "월", "화", "수"],
        ["4:20~5:00", "DP6/606", "TEVO", "쉬는 시간"],
      ],
      merges: [],
    };

    it("fills 없으면 색 판정을 건너뛴다(기존 동작·eywa export 경로 보존)", () => {
      const p = parseTeacherGrid(base as unknown as SheetGrid);
      expect(p.slots.map((s) => s.className).sort()).toEqual(["DP6", "TEVO"]);
    });

    it("무색 칸은 수업에서 빠지고, 색칠된 칸만 남는다", () => {
      const fills = [
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
        [false, true, false, false], // 월(DP6)만 색칠
      ];
      const p = parseTeacherGrid({ ...base, fills } as unknown as SheetGrid);
      expect(p.slots.map((s) => s.className)).toEqual(["DP6"]);
      expect(p.warnings.some((w) => w.includes("TEVO"))).toBe(true);
    });

    it("⚠️ 비수업 블록(쉬는 시간·수업준비)은 무색이어도 살아남는다 — 색 필터보다 먼저 분류된다", () => {
      const fills = [
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
        [false, false, false, false],
        [false, true, false, false],
      ];
      const p = parseTeacherGrid({ ...base, fills } as unknown as SheetGrid);
      expect(p.blocks.map((b) => b.kind)).toContain("break");
    });
  });
});
