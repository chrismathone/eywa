import { describe, expect, it } from "vitest";
import { buildWatchlist, watchlistOverflow, type AbsenceInput, type FollowUpInput } from "./watchlist";

const abs = (name: string, absences: number): AbsenceInput => ({
  studentId: `s-${name}`,
  studentName: name,
  absences,
});
const fu = (name: string, urgency: string): FollowUpInput => ({
  id: `f-${name}`,
  studentId: `s-${name}`,
  studentName: name,
  urgency,
});

describe("살펴볼 학생 — 합치는 순서", () => {
  it("기한 지난 후속조치가 맨 위 — 사람이 약속한 일이 먼저다", () => {
    const list = buildWatchlist([abs("가", 9)], [fu("나", "overdue")]);
    expect(list.map((i) => i.studentName)).toEqual(["나", "가"]);
  });

  it("결석은 잦을수록 위로, 그래도 '오늘 기한 후속'보다는 위다", () => {
    const list = buildWatchlist([abs("가", 3), abs("나", 7)], [fu("다", "today")]);
    expect(list.map((i) => i.studentName)).toEqual(["나", "가", "다"]);
  });

  it("임박 후속이 가장 아래", () => {
    const list = buildWatchlist([], [fu("가", "soon"), fu("나", "today"), fu("다", "overdue")]);
    expect(list.map((i) => i.studentName)).toEqual(["다", "나", "가"]);
  });

  it("모르는 긴급도는 맨 아래로 — 지어내지 않는다", () => {
    const list = buildWatchlist([], [fu("가", "무엇"), fu("나", "overdue")]);
    expect(list.map((i) => i.studentName)).toEqual(["나", "가"]);
  });

  it("같은 학생이 두 신호로 걸리면 두 줄로 선다 — 키가 겹치지 않는다", () => {
    const list = buildWatchlist([abs("가", 4)], [fu("가", "overdue")]);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((i) => i.key)).size).toBe(2);
  });

  it("사유에 기간이 글자로 들어간다 — 기간 없는 숫자는 언제 것인지 알 수 없다", () => {
    const [item] = buildWatchlist([abs("가", 4)], []);
    expect(item.reason).toBe("14일 결석 4회");
  });

  it("🔴 사유 원문이 담길 자리가 없다 — 병원·가정사가 바탕화면에 뜨지 않는다", () => {
    // 입력 자체에 사유 필드가 없다(모양으로 잠근다). 나가는 값도 이름·사유요약·톤뿐이다.
    const [item] = buildWatchlist([abs("가", 4)], []);
    expect(Object.keys(item).sort()).toEqual([
      "key",
      "kind",
      "rank",
      "reason",
      "studentId",
      "studentName",
      "tone",
    ]);
  });

  it("여덟 줄에서 자르고, 잘린 수를 따로 셀 수 있다", () => {
    const many = Array.from({ length: 7 }, (_, i) => abs(`학생${i}`, 3));
    const fus = [fu("가", "overdue"), fu("나", "today"), fu("다", "soon")];
    expect(buildWatchlist(many, fus)).toHaveLength(8);
    // 🔴 잘렸다는 사실을 숨기지 않는다 — 배열 길이를 건수로 쓰면 영원히 "8"이다(#89).
    expect(watchlistOverflow(many, fus)).toBe(2);
    expect(watchlistOverflow([abs("가", 3)], [])).toBe(0);
  });
});
