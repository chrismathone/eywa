/**
 * 예약 분류 — 실측 모양으로 고정.
 *
 * 🔴 전부 "이동"이 아니다: 실측 미래 수강 28건 중 다수가 특강 **신규 배정**이다. 이동으로 뭉뚱그리면
 *    "A → B 이동"이라는 없는 사실이 배너에 뜬다.
 * 🔴 `leave`(전출 아닌 미래 종료 = 퇴원 예정)에는 **취소 버튼을 붙이지 않는다** — 되돌리면 없던
 *    재원생이 생긴다.
 */
import { describe, expect, it } from "vitest";
import {
  classifyScheduled,
  scheduledChangeLabel,
  shortDate,
  type ScheduledEnrollmentRow,
} from "./scheduled-changes";

const TODAY = "2026-08-29";

const row = (o: Partial<ScheduledEnrollmentRow> & { enrollmentId: string }): ScheduledEnrollmentRow => ({
  classId: "c",
  className: "반",
  studentId: "st",
  studentName: "학생",
  startDate: "2026-01-01",
  endDate: null,
  isTransferred: false,
  ...o,
});

describe("classifyScheduled", () => {
  it("이동 — 옛 수강 종료일 == 새 수강 시작일 ∧ 전출", () => {
    // 실측 김준서A: 중등M 초6 개별MS2B(9/3 종료·전출) → 중등M 초6 MS2A(9/3 시작)
    const res = classifyScheduled(
      [
        row({ enrollmentId: "old", className: "MS2B", endDate: "2026-09-03", isTransferred: true }),
        row({ enrollmentId: "new", className: "MS2A", startDate: "2026-09-03" }),
      ],
      TODAY,
    );
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      kind: "move",
      date: "2026-09-03",
      className: "MS2A",
      fromClassName: "MS2B",
      enrollmentId: "new",
      pairedEnrollmentId: "old",
      canCancel: true,
    });
  });

  it("신규 배정 — 짝 없는 미래 시작(특강 등록)", () => {
    const res = classifyScheduled(
      [row({ enrollmentId: "a", className: "내신중등특강(9/5)", startDate: "2026-09-05" })],
      TODAY,
    );
    expect(res[0]).toMatchObject({ kind: "join", className: "내신중등특강(9/5)", canCancel: true });
  });

  it("전출인데 짝이 안 보이면 '다른 반으로 이동'이라고 말한다(반 상세)", () => {
    // 반 기준 조회는 이동의 **한쪽만** 담는다 — 그걸 "수강 종료"라고 쓰면 옮겨 가는 아이를
    // 그만두는 아이로 읽게 만든다.
    const res = classifyScheduled(
      [row({ enrollmentId: "out", className: "DP6", endDate: "2026-09-01", isTransferred: true })],
      TODAY,
    );
    expect(res[0]).toMatchObject({ kind: "leave", viaTransfer: true, canCancel: false });
    expect(scheduledChangeLabel(res[0]!, TODAY)).toBe("9/1에 DP6에서 다른 반으로 이동");
  });

  it("종료 예정 — 전출이 아니면 취소 버튼을 붙이지 않는다", () => {
    const res = classifyScheduled(
      [row({ enrollmentId: "z", className: "내신중등특강(오후)", endDate: "2026-09-19" })],
      TODAY,
    );
    expect(res[0]).toMatchObject({ kind: "leave", date: "2026-09-19", canCancel: false });
  });

  it("전출 표식이 없으면 날짜가 같아도 이동으로 묶지 않는다", () => {
    // 우연히 종료일과 시작일이 같은 별개 사건을 화살표로 이으면 없는 사실이 된다.
    const res = classifyScheduled(
      [
        row({ enrollmentId: "old", className: "A반", endDate: "2026-09-01", isTransferred: false }),
        row({ enrollmentId: "new", className: "B반", startDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(res.map((r) => r.kind).sort()).toEqual(["join", "leave"]);
  });

  it("같은 날 두 반을 옮기면 짝이 모호해 이동으로 묶지 않는다", () => {
    // 실측 권민서A·김동리가 9/1에 두 반을 동시에 받는다 — 틀린 화살표보다 사실 나열이 낫다.
    const res = classifyScheduled(
      [
        row({ enrollmentId: "o1", className: "A", endDate: "2026-09-01", isTransferred: true }),
        row({ enrollmentId: "o2", className: "B", endDate: "2026-09-01", isTransferred: true }),
        row({ enrollmentId: "n1", className: "C", startDate: "2026-09-01" }),
        row({ enrollmentId: "n2", className: "D", startDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(res.filter((r) => r.kind === "move")).toHaveLength(0);
    expect(res.filter((r) => r.kind === "join")).toHaveLength(2);
    expect(res.filter((r) => r.kind === "leave")).toHaveLength(2);
  });

  it("한 짝이 이미 쓰였으면 다시 쓰지 않는다", () => {
    const res = classifyScheduled(
      [
        row({ enrollmentId: "old", className: "A", endDate: "2026-09-01", isTransferred: true }),
        row({ enrollmentId: "n1", className: "B", startDate: "2026-09-01" }),
        row({ enrollmentId: "n2", className: "C", startDate: "2026-09-01" }),
      ],
      TODAY,
    );
    // 첫 짝이 이동으로 묶이면 남은 하나는 합류다(옛 수강을 두 번 소비하지 않는다).
    expect(res.filter((r) => r.kind === "move")).toHaveLength(1);
    expect(res.filter((r) => r.kind === "join")).toHaveLength(1);
  });

  it("이미 시작·종료된 것은 예약이 아니다", () => {
    const res = classifyScheduled(
      [
        row({ enrollmentId: "past", className: "A", startDate: "2026-01-01" }),
        row({ enrollmentId: "done", className: "B", startDate: "2026-01-01", endDate: "2026-08-01" }),
      ],
      TODAY,
    );
    expect(res).toEqual([]);
  });

  it("날짜순으로 돌려준다", () => {
    const res = classifyScheduled(
      [
        row({ enrollmentId: "b", className: "B", startDate: "2026-09-09" }),
        row({ enrollmentId: "a", className: "A", startDate: "2026-09-01" }),
      ],
      TODAY,
    );
    expect(res.map((r) => r.className)).toEqual(["A", "B"]);
  });
});

describe("문구", () => {
  it("한글 문장으로만 만든다(영문 키 누출 금지)", () => {
    const [move] = classifyScheduled(
      [
        row({ enrollmentId: "o", className: "MS2B", endDate: "2026-09-03", isTransferred: true }),
        row({ enrollmentId: "n", className: "MS2A", startDate: "2026-09-03" }),
      ],
      TODAY,
    );
    expect(scheduledChangeLabel(move!, TODAY)).toBe("9/3부터 MS2B → MS2A 이동");
  });

  it("올해면 연도를 생략한다", () => {
    expect(shortDate("2026-09-01", TODAY)).toBe("9/1");
    expect(shortDate("2027-03-02", TODAY)).toBe("27. 3/2");
  });
});
