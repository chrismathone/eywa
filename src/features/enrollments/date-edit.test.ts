import { describe, expect, it } from "vitest";
import {
  applyDateEdit,
  dateEditConfirmMessage,
  dateEditConfirmTitle,
  dateEditConfirmToken,
  enrollmentDateEditError,
  newlyExcludedAttendanceRanges,
  transferPairRisk,
  type DateEditRisk,
  type EnrollmentWindow,
} from "./date-edit";
import { isEnrollmentEndedOn } from "./eligibility";

const win = (start: string, end: string | null, isTransferred = false): EnrollmentWindow => ({
  startDate: start,
  endDate: end,
  isTransferred,
});

describe("enrollmentDateEditError — 저장 전 순수 검증", () => {
  it("시작일은 비울 수 없다", () => {
    expect(enrollmentDateEditError("start", null, win("2026-08-01", null))).toBe(
      "시작일은 비울 수 없습니다",
    );
  });

  it("종료일은 비울 수 있다(재원중 복귀)", () => {
    expect(enrollmentDateEditError("end", null, win("2026-08-01", "2026-09-10"))).toBeNull();
  });

  it("ISO가 아닌 값은 거절", () => {
    expect(enrollmentDateEditError("end", "2026/09/10", win("2026-08-01", null))).toBe(
      "날짜 형식이 올바르지 않습니다",
    );
  });

  it("종료일을 시작일보다 앞으로 당기면 거절", () => {
    expect(enrollmentDateEditError("end", "2026-07-31", win("2026-08-01", "2026-09-10"))).toBe(
      "시작일이 종료일보다 늦을 수 없습니다",
    );
  });

  it("시작일을 종료일보다 뒤로 밀어도 거절(같은 규칙의 반대 축)", () => {
    expect(enrollmentDateEditError("start", "2026-09-11", win("2026-08-01", "2026-09-10"))).toBe(
      "시작일이 종료일보다 늦을 수 없습니다",
    );
  });

  it("시작일 = 종료일(하루짜리 수강)은 허용 — 개별 반에선 정상", () => {
    expect(enrollmentDateEditError("end", "2026-08-01", win("2026-08-01", null))).toBeNull();
  });

  it("모르는 필드는 거절", () => {
    expect(enrollmentDateEditError("both", "2026-08-01", win("2026-08-01", null))).toBe(
      "잘못된 필드입니다",
    );
  });
});

describe("applyDateEdit", () => {
  it("바꾸는 필드만 갈아끼운다", () => {
    const cur = win("2026-08-01", "2026-09-10");
    expect(applyDateEdit(cur, "end", "2026-09-01").startDate).toBe("2026-08-01");
    expect(applyDateEdit(cur, "start", "2026-08-05").endDate).toBe("2026-09-10");
  });

  it("종료일 비우기는 null로 반영된다", () => {
    expect(applyDateEdit(win("2026-08-01", "2026-09-10"), "end", null).endDate).toBeNull();
  });
});

describe("newlyExcludedAttendanceRanges — 이번 편집이 새로 밀어내는 구간", () => {
  it("기간을 넓히는 편집은 아무것도 밀어내지 않는다", () => {
    const prev = win("2026-08-01", "2026-09-10");
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-30"))).toEqual([]);
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "start", "2026-07-01"))).toEqual([]);
  });

  it("종료일을 비우면(재원중 복귀) 밀려나는 기록이 없다", () => {
    const prev = win("2026-08-01", "2026-09-10");
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", null))).toEqual([]);
  });

  it("종료일을 앞당기면 새 종료 다음날 ~ 옛 종료일", () => {
    const prev = win("2026-08-01", "2026-09-10");
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-01"))).toEqual([
      { from: "2026-09-02", to: "2026-09-10" },
    ]);
  });

  it("열려 있던 수강을 처음 닫으면 위쪽이 열린 구간", () => {
    const prev = win("2026-08-01", null);
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-01"))).toEqual([
      { from: "2026-09-02", to: null },
    ]);
  });

  it("반이동(전출)은 종료일 당일이 이미 밖이라 구간이 하루씩 앞선다", () => {
    const prev = win("2026-08-01", "2026-09-10", true);
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-01"))).toEqual([
      { from: "2026-09-01", to: "2026-09-09" },
    ]);
  });

  it("전출을 하루만 당기면 구간은 그 하루뿐", () => {
    const prev = win("2026-08-01", "2026-09-10", true);
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-09"))).toEqual([
      { from: "2026-09-09", to: "2026-09-09" },
    ]);
  });

  it("시작일을 뒤로 밀면 옛 시작 ~ 새 시작 전날", () => {
    const prev = win("2026-08-01", "2026-09-10");
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "start", "2026-08-05"))).toEqual([
      { from: "2026-08-01", to: "2026-08-04" },
    ]);
  });

  it("변화 없는 저장은 아무것도 안 묻는다", () => {
    const prev = win("2026-08-01", "2026-09-10");
    expect(newlyExcludedAttendanceRanges(prev, applyDateEdit(prev, "end", "2026-09-10"))).toEqual([]);
  });
});

/**
 * 🔴 구간 계산이 [`eligibility`](./eligibility.ts)의 종료 규약과 **갈리지 않는지** 날짜를 훑어 확인한다.
 * 구간은 성능을 위해 규약을 "경계"로 옮겨 적은 것이라, 한쪽만 고쳐지면 조용히 어긋난다
 * (특히 전출의 반열림 `[start,end)`). 그래서 판정자를 직접 불러 1:1로 맞춘다.
 */
describe("구간 계산 ↔ isEnrollmentEndedOn 교차 검증", () => {
  const inWindow = (w: EnrollmentWindow, d: string) =>
    w.startDate <= d && !isEnrollmentEndedOn(w.endDate, d, w.isTransferred);

  const sweep = (from: string, days: number): string[] => {
    const out: string[] = [];
    const base = new Date(`${from}T00:00:00Z`);
    for (let i = 0; i < days; i += 1) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  };

  const inRanges = (ranges: { from: string; to: string | null }[], d: string) =>
    ranges.some((r) => r.from <= d && (r.to === null || d <= r.to));

  const cases: { prev: EnrollmentWindow; field: "start" | "end"; value: string | null }[] = [
    { prev: win("2026-08-05", "2026-09-10"), field: "end", value: "2026-09-01" },
    { prev: win("2026-08-05", "2026-09-10", true), field: "end", value: "2026-09-01" },
    { prev: win("2026-08-05", null), field: "end", value: "2026-08-20" },
    { prev: win("2026-08-05", null, true), field: "end", value: "2026-08-20" },
    { prev: win("2026-08-05", "2026-09-10"), field: "start", value: "2026-08-20" },
    { prev: win("2026-08-05", "2026-09-10"), field: "end", value: "2026-09-30" },
    { prev: win("2026-08-05", "2026-09-10"), field: "start", value: "2026-08-01" },
  ];

  it.each(cases)("prev=$prev.startDate~$prev.endDate $field→$value", ({ prev, field, value }) => {
    const next = applyDateEdit(prev, field, value);
    const ranges = newlyExcludedAttendanceRanges(prev, next);
    for (const d of sweep("2026-07-25", 80)) {
      // "옛 기간 안 ∧ 새 기간 밖" ⟺ 구간에 들어 있다.
      const newlyOut = inWindow(prev, d) && !inWindow({ ...next, isTransferred: prev.isTransferred }, d);
      expect({ d, hit: inRanges(ranges, d) }).toEqual({ d, hit: newlyOut });
    }
  });
});

/**
 * 반이동 짝 — `scheduled-changes.ts`가 `옛.end_date === 새.start_date ∧ 옛쪽 is_transferred`로
 * 짝을 찾는다. 그 닻을 옮기면 DB는 조용한데 화면이 전출을 '수강 종료'로 부른다.
 */
describe("transferPairRisk — 반이동 짝의 닻", () => {
  const TODAY = "2026-08-25";
  const out = (end: string | null) => ({ startDate: "2026-08-01", endDate: end, isTransferred: true });
  const inn = (start: string) => ({
    startDate: start,
    endDate: null,
    isTransferred: false,
    isTransferredIn: true,
  });

  it("아직 오지 않은 전출 행의 종료일을 옮기면 위험", () => {
    expect(transferPairRisk(out("2026-09-01"), "end", "2026-09-03", TODAY)).toEqual({
      kind: "transferPair",
      anchor: "2026-09-01",
    });
  });

  it("전출 행이라도 같은 날짜 재저장은 위험이 아니다", () => {
    expect(transferPairRisk(out("2026-09-01"), "end", "2026-09-01", TODAY)).toBeNull();
  });

  it("전출 행의 종료일을 **비우는** 것도 짝을 끊는다", () => {
    expect(transferPairRisk(out("2026-09-01"), "end", null, TODAY)).toEqual({
      kind: "transferPair",
      anchor: "2026-09-01",
    });
  });

  it("전입 행은 **시작일**이 닻이다", () => {
    expect(transferPairRisk(inn("2026-09-01"), "start", "2026-09-03", TODAY)).toEqual({
      kind: "transferPair",
      anchor: "2026-09-01",
    });
    // 전입 행의 종료일은 짝과 무관하다.
    expect(transferPairRisk(inn("2026-09-01"), "end", "2026-12-31", TODAY)).toBeNull();
  });

  /**
   * 🔴 실측(2026-09-10) 전입 표식 157건 중 대부분이 지나간 이동이다. 전부 물으면 경보 피로라
   * 진짜 위험이 묻힌다 — 예약 배너·예약 취소가 **미래 행만** 대상이라 근거도 여기서만 성립한다.
   */
  it("이미 지나간 이동은 묻지 않는다 — 예약 배너·취소가 미래분만 보기 때문", () => {
    expect(transferPairRisk(out("2026-08-01"), "end", "2026-08-03", TODAY)).toBeNull();
    expect(transferPairRisk(inn("2026-08-01"), "start", "2026-08-03", TODAY)).toBeNull();
  });

  it("오늘이 닻이면 아직 묻는다(경계 포함)", () => {
    expect(transferPairRisk(out(TODAY), "end", "2026-08-27", TODAY)).not.toBeNull();
  });

  it("반이동이 아닌 평범한 수강은 위험 없음", () => {
    const plain = { startDate: "2026-08-01", endDate: "2026-09-01", isTransferred: false };
    expect(transferPairRisk(plain, "end", "2026-08-20", TODAY)).toBeNull();
    expect(transferPairRisk(plain, "start", "2026-08-10", TODAY)).toBeNull();
  });
});

describe("확인 서명·문구", () => {
  const ENR = "enr-1";
  const att = (count: number, lastDate: string): DateEditRisk => ({
    kind: "attendanceOutside",
    shrink: { count, lastDate },
  });

  it("숫자나 마지막 날짜가 달라지면 서명이 달라진다(그 사이 출결이 늘면 다시 묻는다)", () => {
    expect(dateEditConfirmToken(ENR, "end", "2026-09-01", [att(3, "2026-09-08")])).not.toBe(
      dateEditConfirmToken(ENR, "end", "2026-09-01", [att(4, "2026-09-09")]),
    );
  });

  it("같은 편집·같은 실측이면 서명이 같다", () => {
    const r = [att(3, "2026-09-08")];
    expect(dateEditConfirmToken(ENR, "end", "2026-09-01", r)).toBe(
      dateEditConfirmToken(ENR, "end", "2026-09-01", r),
    );
  });

  /** 🔴 확인은 **이 행에 대해** 받은 것이어야 한다 — 안 묶으면 같은 숫자를 내는 남의 수강 토큰이 통한다. */
  it("수강이 다르면 서명도 다르다", () => {
    const r = [att(3, "2026-09-08")];
    expect(dateEditConfirmToken("enr-1", "end", "2026-09-01", r)).not.toBe(
      dateEditConfirmToken("enr-2", "end", "2026-09-01", r),
    );
  });

  it("위험 하나가 늘면 서명이 달라진다(둘을 확인해야 통과)", () => {
    const one = [att(3, "2026-09-08")];
    const two: DateEditRisk[] = [...one, { kind: "transferPair", anchor: "2026-09-01" }];
    expect(dateEditConfirmToken(ENR, "end", "2026-09-01", one)).not.toBe(
      dateEditConfirmToken(ENR, "end", "2026-09-01", two),
    );
  });

  /**
   * 🔴 이 테스트는 한 번 **거짓을 잠갔다가** 고쳤다(2026-09-10 적대 검증). 처음엔 `/시수|급여/`가
   * 문구에 없어야 한다고 단언했는데, 실제로는 수강 구간이 자리 출석부 시수 합계·급여명세서 수업인원을
   * 다시 계산시킨다. "안전해 보이는 문구"를 테스트로 굳히면 그 거짓이 영영 안 잡힌다.
   */
  it("무엇이 다시 계산되는지 이름을 대고, 기록이 지워진다고는 말하지 않는다", () => {
    const msg = dateEditConfirmMessage("end", "2026-09-01", [att(3, "2026-09-08")]);
    expect(msg).toContain("3건");
    expect(msg).toContain("2026-09-08");
    expect(msg).toContain("지워지지는 않지만");
    // "표시만 바뀐다"로 되돌아가면 이 셋이 사라진다.
    expect(msg).toContain("출석부");
    expect(msg).toContain("시수");
    expect(msg).toContain("급여명세서");
  });

  it("금액이 바뀐다고는 적지 않는다 — 티어 정산은 수강 기간을 안 본다", () => {
    const msg = dateEditConfirmMessage("end", "2026-09-01", [att(3, "2026-09-08")]);
    expect(msg).not.toMatch(/금액|원이 |정산액/);
  });

  it("시작일 축은 '앞에 찍힌', 종료일 축은 '뒤에 찍힌'으로 방향을 갈라 적는다", () => {
    const r = [att(1, "2026-08-03")];
    expect(dateEditConfirmMessage("start", "2026-08-05", r)).toContain("앞에 이미 찍힌");
    expect(dateEditConfirmMessage("end", "2026-08-05", r)).toContain("뒤에 이미 찍힌");
  });

  /**
   * 🔴 적대 검증이 이 문장에서 **거짓 둘**을 잡았다(2026-09-10):
   *  · 짝이 끊겨도 `viaTransfer`는 남아 라벨이 "다른 반으로 이동" 그대로다 — "'수강 종료'로 표시된다"는 거짓.
   *  · 저장하면 `canCancel:false`가 되어 `ScheduledChangeActions`가 블록째 사라진다 — **수정 버튼도 없다**.
   *    그러니 안내는 "나중에 거기서"가 아니라 **"저장하지 말고"**여야 한다([[#77]] 결: 할 수 없는 일을 시키지 않는다).
   */
  it("반이동 문구는 '저장 전에' 다른 자리에서 고치라고 말한다 — 사후 경로가 아니다", () => {
    const msg = dateEditConfirmMessage("end", "2026-09-03", [
      { kind: "transferPair", anchor: "2026-09-01" },
    ]);
    expect(msg).toContain("반 이동");
    expect(msg).toContain("2026-09-01");
    expect(msg).toContain("저장하지 말고");
    expect(msg).toContain("수정");
    // 라벨은 그대로 '이동'이라 이렇게 적으면 거짓이 된다.
    expect(msg).not.toContain("'수강 종료'로 표시");
  });

  it("제목은 걸린 위험을 따라간다 — 출결이 안 밀려나는데 '출결이…'라고 하지 않는다", () => {
    const pair: DateEditRisk = { kind: "transferPair", anchor: "2026-09-01" };
    expect(dateEditConfirmTitle([pair])).not.toContain("출결");
    expect(dateEditConfirmTitle([att(1, "2026-09-08")])).toContain("출결");
    // 둘 다면 어느 한쪽으로 단정하지 않는다.
    const both = dateEditConfirmTitle([att(1, "2026-09-08"), pair]);
    expect(both).not.toContain("출결");
    expect(both).not.toContain("반 이동의 기준일");
  });

  it("위험이 둘이면 문장 둘이 빈 줄로 나뉜다(화면이 pre-line으로 그린다)", () => {
    const msg = dateEditConfirmMessage("end", "2026-09-03", [
      att(2, "2026-09-05"),
      { kind: "transferPair", anchor: "2026-09-01" },
    ]);
    expect(msg.split("\n\n").length).toBe(3); // 위험 2 + 마지막 "그대로 저장할까요?"
  });

  it("문구엔 마크업을 넣지 않는다 — 화면이 그대로 그려서 별표가 보인다", () => {
    const msg = dateEditConfirmMessage("end", "2026-09-03", [
      att(2, "2026-09-05"),
      { kind: "transferPair", anchor: "2026-09-01" },
    ]);
    expect(msg).not.toContain("**");
  });
});
