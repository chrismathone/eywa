/**
 * 결석 위험 "N회"의 과목 분해가 **RPC(0221a)와 같은 셈법**인지 잠근다.
 *
 * 이 가드가 지키는 약속은 하나다: 브리핑 카드가 "최근 14일 결석 8회" 옆에 "수학 6 · 영어 2"를 나란히
 * 놓으므로 **분해 합 = 총계**여야 한다. 셈법이 갈리면 둘 중 하나가 거짓인데 화면만 봐서는 알 수 없다.
 */
import { describe, expect, it } from "vitest";
import { countAbsencesBySubject, type AbsenceSubjectRow } from "./absence-subjects";

const row = (over: Partial<AbsenceSubjectRow> & { id: string }): AbsenceSubjectRow => ({
  student_id: "s1",
  class_id: "c-math",
  session_date: "2026-08-20",
  slot_start: null,
  status: "absent",
  recorded_at: "2026-08-20T10:00:00Z",
  subject: "math",
  ...over,
});

const sum = (buckets: { subject: string; count: number }[]) => buckets.reduce((n, b) => n + b.count, 0);

describe("countAbsencesBySubject", () => {
  it("과목별로 나누고 건수 desc로 정렬한다", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", class_id: "c-math", session_date: "2026-08-20" }),
      row({ id: "2", class_id: "c-math", session_date: "2026-08-21" }),
      row({ id: "3", class_id: "c-eng", subject: "english", session_date: "2026-08-21" }),
    ]);
    expect(out.get("s1")).toEqual([
      { subject: "math", count: 2 },
      { subject: "english", count: 1 },
    ]);
  });

  it("같은 반·같은 날의 여러 교시는 1회다(0221a — 영어가 2.19배로 부풀던 것)", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", class_id: "c-eng", subject: "english", slot_start: "16:20" }),
      row({ id: "2", class_id: "c-eng", subject: "english", slot_start: "17:00" }),
      row({ id: "3", class_id: "c-eng", subject: "english", slot_start: "17:40" }),
    ]);
    expect(out.get("s1")).toEqual([{ subject: "english", count: 1 }]);
  });

  it("같은 날 다른 반을 빠진 것은 따로 센다(수학은 왔는데 영어만 빠진 날이 지워지지 않게)", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", class_id: "c-math", subject: "math" }),
      row({ id: "2", class_id: "c-eng", subject: "english" }),
    ]);
    expect(sum(out.get("s1")!)).toBe(2);
  });

  it("결석을 출석으로 정정하면 사라진다 — 같은 교시의 최신 1건만 유효", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", slot_start: "16:20", status: "absent", recorded_at: "2026-08-20T10:00:00Z" }),
      row({ id: "2", slot_start: "16:20", status: "present", recorded_at: "2026-08-20T18:00:00Z" }),
    ]);
    expect(out.get("s1")).toBeUndefined();
  });

  it("recorded_at이 같으면 id가 큰 쪽이 이긴다(RPC의 `recorded_at desc, id desc`)", () => {
    const same = "2026-08-20T10:00:00Z";
    const out = countAbsencesBySubject([
      row({ id: "b", slot_start: "16:20", status: "absent", recorded_at: same }),
      row({ id: "a", slot_start: "16:20", status: "present", recorded_at: same }),
    ]);
    expect(out.get("s1")).toEqual([{ subject: "math", count: 1 }]);
  });

  it("교시 null과 교시 있는 행은 다른 그룹이지만, 같은 반·같은 날이면 합쳐서 1회다", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", slot_start: null }),
      row({ id: "2", slot_start: "16:20" }),
    ]);
    expect(out.get("s1")).toEqual([{ subject: "math", count: 1 }]);
  });

  it("과목이 없는 반도 버리지 않는다(빈 키 = 호출부가 '과목 미상'으로 라벨링)", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", class_id: "c-x", subject: null }),
      row({ id: "2", class_id: "c-y", subject: "   " }),
    ]);
    expect(out.get("s1")).toEqual([{ subject: "", count: 2 }]);
  });

  it("결석이 아닌 행만 있는 학생은 결과에 없다", () => {
    const out = countAbsencesBySubject([row({ id: "1", student_id: "s2", status: "late" })]);
    expect(out.size).toBe(0);
  });

  it("학생별로 나뉜다", () => {
    const out = countAbsencesBySubject([
      row({ id: "1", student_id: "s1" }),
      row({ id: "2", student_id: "s2", class_id: "c-eng", subject: "english" }),
    ]);
    expect(out.get("s1")).toEqual([{ subject: "math", count: 1 }]);
    expect(out.get("s2")).toEqual([{ subject: "english", count: 1 }]);
  });

  it("실데이터 재현: 하은결 8회 = 수학 6 · 영어 2 (injaewon 2026-08-29)", () => {
    // 수학 6일 + 영어 2일(영어는 하루 3교시라 행은 6개지만 2회여야 한다).
    const rows: AbsenceSubjectRow[] = [];
    for (const d of ["08-11", "08-13", "08-14", "08-18", "08-20", "08-25"]) {
      rows.push(row({ id: `m-${d}`, class_id: "c-math", subject: "math", session_date: `2026-${d}` }));
    }
    for (const d of ["08-12", "08-19"]) {
      for (const slot of ["16:20", "17:00", "17:40"]) {
        rows.push(
          row({ id: `e-${d}-${slot}`, class_id: "c-eng", subject: "english", session_date: `2026-${d}`, slot_start: slot }),
        );
      }
    }
    const out = countAbsencesBySubject(rows)!;
    expect(out.get("s1")).toEqual([
      { subject: "math", count: 6 },
      { subject: "english", count: 2 },
    ]);
    expect(sum(out.get("s1")!)).toBe(8);
  });
});
