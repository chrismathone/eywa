import { describe, expect, it } from "vitest";
import {
  canMaterializeTerm,
  isVirtualTermId,
  monthRosterPairs,
  parseVirtualTermId,
  TERM_STATE_LABEL,
  termRowState,
  virtualTermId,
} from "./month-roster";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FROM = "2026-09-01";
const rec = (studentId: string, classId: string, sessionDate: string, status = "present", sessionUnits: number | null = null, slotStart: string | null = null) => ({
  studentId,
  classId,
  sessionDate,
  status,
  sessionUnits,
  slotStart,
});

describe("monthRosterPairs — 월별 출석부와 같은 줄 집합(원장 2026-09-18 '출석부 행 개수 = 회차 확정 행 개수')", () => {
  it("① 수강 구간이 그 달과 겹치면 줄 — 휴원·월초 전 종료는 줄이 아니다", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [
        { studentId: S1, classId: C1, startDate: "2026-05-01", endDate: null, onHold: false },
        { studentId: S2, classId: C1, startDate: "2026-05-01", endDate: "2026-08-31", onHold: false }, // 월초 전 종료
        { studentId: S2, classId: C2, startDate: "2026-05-01", endDate: null, onHold: true }, // 휴원
      ],
      records: [],
      reservations: [],
    });
    expect(pairs).toEqual([{ studentId: S1, classId: C1, sources: ["enrolled"], recordedUnits: null }]);
  });

  it("종료일이 월초 당일이면 줄이다(출석부 `end_date < startIso` 제외와 같은 경계)", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [{ studentId: S1, classId: C1, startDate: "2026-05-01", endDate: "2026-09-01", onHold: false }],
      records: [],
      reservations: [],
    });
    expect(pairs).toHaveLength(1);
  });

  it("② 수강행이 없는 기록(보강 방문)은 줄 — 실제 시수를 함께 센다(결석은 안 센다)", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [],
      records: [rec(S1, C1, "2026-09-06", "makeup", 1.5), rec(S1, C1, "2026-09-13", "absent", 1), rec(S1, C1, "2026-09-20", "present", null)],
      reservations: [],
    });
    expect(pairs).toEqual([{ studentId: S1, classId: C1, sources: ["recorded"], recordedUnits: 2.5 }]);
  });

  it("🔴 휴원·월초 전 종료 수강행이 있는 학생은 기록이 있어도 줄이 아니다(출석부가 그렇게 숨긴다 — 두 화면이 같은 말)", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [
        { studentId: S1, classId: C1, startDate: "2026-05-01", endDate: null, onHold: true },
        { studentId: S2, classId: C1, startDate: "2026-05-01", endDate: "2026-08-20", onHold: false },
      ],
      records: [rec(S1, C1, "2026-09-06"), rec(S2, C1, "2026-09-06")],
      reservations: [{ studentId: S1, classId: C1 }],
    });
    expect(pairs).toEqual([]);
  });

  it("수강 줄에 기록이 있으면 근거가 둘이고 실제 시수가 붙는다 — 같은 날 같은 교시는 마지막 행 하나(0267a와 같다)", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [{ studentId: S1, classId: C1, startDate: "2026-05-01", endDate: null, onHold: false }],
      records: [rec(S1, C1, "2026-09-06", "absent", 0, "16:20"), rec(S1, C1, "2026-09-06", "present", 0.5, "16:20"), rec(S1, C1, "2026-09-06", "present", 0.5, "17:20")],
      reservations: [],
    });
    expect(pairs).toEqual([{ studentId: S1, classId: C1, sources: ["enrolled", "recorded"], recordedUnits: 1 }]);
  });

  it("③ 예약만 있는 학생은 줄이되 근거가 `reserved`뿐 — 실제 시수 없음", () => {
    const pairs = monthRosterPairs({ from: FROM, enrollments: [], records: [], reservations: [{ studentId: S1, classId: C1 }, { studentId: S1, classId: C1 }] });
    expect(pairs).toEqual([{ studentId: S1, classId: C1, sources: ["reserved"], recordedUnits: null }]);
  });

  it("반마다 기간 창 시작이 다르면(과목별 세션) 그 반의 시작으로 종료를 판정한다", () => {
    const pairs = monthRosterPairs({
      // C1(수학 세션)은 9/2부터 · C2는 달력월(9/1부터) — 9/1에 끝난 수강은 C1에선 줄이 아니고 C2에선 줄이다.
      from: (classId) => (classId === C1 ? "2026-09-02" : FROM),
      enrollments: [
        { studentId: S1, classId: C1, startDate: "2026-05-01", endDate: "2026-09-01", onHold: false },
        { studentId: S1, classId: C2, startDate: "2026-05-01", endDate: "2026-09-01", onHold: false },
      ],
      records: [],
      reservations: [],
    });
    expect(pairs.map((p) => p.classId)).toEqual([C2]);
  });

  it("같은 반에 수강행이 둘(재등록)이어도 한 줄", () => {
    const pairs = monthRosterPairs({
      from: FROM,
      enrollments: [
        { studentId: S1, classId: C1, startDate: "2026-03-01", endDate: "2026-09-10", onHold: false },
        { studentId: S1, classId: C1, startDate: "2026-09-15", endDate: null, onHold: false },
      ],
      records: [],
      reservations: [],
    });
    expect(pairs).toHaveLength(1);
  });
});

describe("가상 회차 id — 표·초안·선택의 키이고 서버는 풀어서 다시 판정한다", () => {
  it("만들고 되풀고, 다른 모양은 거절한다", () => {
    const id = virtualTermId(S1, C1);
    expect(isVirtualTermId(id)).toBe(true);
    expect(parseVirtualTermId(id)).toEqual({ studentId: S1, classId: C1 });
    expect(parseVirtualTermId("v:not-a-uuid:x")).toBeNull();
    expect(parseVirtualTermId(S1)).toBeNull();
    expect(isVirtualTermId(S1)).toBe(false);
  });
});

describe("termRowState — 회차 행이 없는 줄은 청구서 유무로 갈린다", () => {
  it("행 있음 → term · 청구서 있음 → missing(만들 수 있다) · 청구서 없음/취소 → 잠근다", () => {
    expect(termRowState({ hasTerm: true, invoiceStatus: "paid" })).toBe("term");
    expect(termRowState({ hasTerm: false, invoiceStatus: "paid" })).toBe("missing");
    expect(termRowState({ hasTerm: false, invoiceStatus: null })).toBe("no_invoice");
    expect(termRowState({ hasTerm: false, invoiceStatus: "void" })).toBe("void_invoice");
    expect(canMaterializeTerm("missing")).toBe(true);
    expect(canMaterializeTerm("no_invoice")).toBe(false);
    expect(canMaterializeTerm("void_invoice")).toBe(false);
  });

  it("🔴 화면 라벨은 전부 한글이고 raw 코드가 아니다", () => {
    for (const [code, meta] of Object.entries(TERM_STATE_LABEL)) {
      expect(meta.label).not.toContain(code);
      expect(meta.label).toMatch(/[가-힣]/);
      expect(meta.tip).toMatch(/[가-힣]/);
    }
  });
});
