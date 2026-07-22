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
  it("배치 슬롯 330건 파싱(병렬 레인 포함)", () => {
    expect(parsed.slots).toHaveLength(330);
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
});
