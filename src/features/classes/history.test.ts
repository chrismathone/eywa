import { describe, expect, it } from "vitest";
import {
  buildEnrollmentHistory,
  buildScheduleHistory,
  mergeClassHistory,
  slotLabel,
  type ClassHistoryEntry,
  type EnrollmentHistoryRow,
} from "./history";

const slot = (o: Partial<Parameters<typeof buildScheduleHistory>[0][number]> = {}) => ({
  dayOfWeek: "mon",
  startTime: "16:00:00",
  endTime: "17:00:00",
  validFrom: "2026-01-01",
  validTo: null,
  teacherName: "김강사",
  roomName: "본원301",
  ...o,
});

describe("slotLabel", () => {
  it("요일은 한글, 시각은 HH:MM (raw 노출 금지)", () => {
    expect(slotLabel({ dayOfWeek: "wed", startTime: "16:00:00", endTime: "17:30:00" })).toBe("수 16:00~17:30");
  });
});

describe("buildScheduleHistory — 배치 구간", () => {
  it("같은 구간의 여러 요일을 한 줄로 묶는다", () => {
    const out = buildScheduleHistory([slot(), slot({ dayOfWeek: "wed" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("수업 배치 2개");
    expect(out[0]!.detail).toContain("월 16:00~17:00");
    expect(out[0]!.detail).toContain("수 16:00~17:00");
  });

  it("구간이 다르면(담당 교체) 줄이 갈린다", () => {
    const out = buildScheduleHistory([
      slot({ validTo: "2026-08-03", teacherName: "옛담당" }),
      slot({ validFrom: "2026-08-04", teacherName: "새담당" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.endDate === "2026-08-03")!.detail).toContain("담당 옛담당");
    expect(out.find((e) => e.date === "2026-08-04")!.detail).toContain("담당 새담당");
  });

  it("담당·강의실이 비면 그 부분은 아예 안 적는다(빈 라벨 금지)", () => {
    const out = buildScheduleHistory([slot({ teacherName: null, roomName: null })]);
    expect(out[0]!.detail).not.toContain("담당");
    expect(out[0]!.detail).not.toContain("강의실");
  });

  it("🔴 시작일 없는 행은 이력으로 쓰지 않는다(언제부터인지 지어내지 않는다)", () => {
    expect(buildScheduleHistory([slot({ validFrom: null })])).toEqual([]);
  });
});

describe("buildEnrollmentHistory — 학생 배정 이력", () => {
  const TODAY = "2026-08-18";
  const en = (o: Partial<EnrollmentHistoryRow> = {}): EnrollmentHistoryRow => ({
    studentName: "김지호",
    startDate: "2026-08-01",
    endDate: null,
    isTransferred: false,
    isTransferredIn: false,
    ...o,
  });

  it("수강 한 행 = 배정 사건 하나(종료일 없으면 종료 사건 없음)", () => {
    const out = buildEnrollmentHistory([en()], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ date: "2026-08-01", source: "enrollment", title: "학생 배정", detail: "김지호" });
  });

  it("종료일이 있으면 종료 사건이 따로 생긴다 · 전입/전출 플래그는 라벨을 가른다", () => {
    const out = buildEnrollmentHistory(
      [en({ isTransferredIn: true, endDate: "2026-08-10", isTransferred: true })],
      TODAY,
    );
    expect(out.find((e) => e.date === "2026-08-01")!.title).toBe("전입(반 이동)");
    expect(out.find((e) => e.date === "2026-08-10")!.title).toBe("전출(반 이동)");
  });

  it("같은 날 같은 종류는 한 줄로 묶고 이름을 나열한다(시트 임포트 수십 명 대응)", () => {
    const out = buildEnrollmentHistory([en(), en({ studentName: "이철수" })], TODAY);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("학생 배정 2명");
    expect(out[0]!.detail).toBe("김지호 · 이철수");
  });

  it("일반 종료는 '수강 종료'(전출 아님)", () => {
    const out = buildEnrollmentHistory([en({ endDate: "2026-08-15" })], TODAY);
    expect(out.find((e) => e.date === "2026-08-15")!.title).toBe("수강 종료");
  });

  it("미래 날짜 사건은 '(예정)' — 안 붙이면 아직 안 일어난 이동이 완료된 사실처럼 선다", () => {
    const out = buildEnrollmentHistory(
      [en({ startDate: "2026-08-25" }), en({ studentName: "이철수", startDate: "2026-08-25" })],
      TODAY,
    );
    expect(out[0]!.title).toBe("학생 배정 2명 (예정)");
  });

  it("시작일 없는 행은 배정 사건을 만들지 않는다(지어내지 않는다)", () => {
    expect(buildEnrollmentHistory([en({ startDate: "" })], TODAY)).toEqual([]);
  });
});

describe("mergeClassHistory", () => {
  const e = (date: string, source: ClassHistoryEntry["source"], title = "x"): ClassHistoryEntry => ({
    date,
    source,
    title,
  });

  it("최신이 위로", () => {
    const out = mergeClassHistory([[e("2026-01-01", "schedule")], [e("2026-08-04", "audit")]]);
    expect(out.map((x) => x.date)).toEqual(["2026-08-04", "2026-01-01"]);
  });

  it("같은 날짜면 사실(감사로그·배치·학생)이 정황(보고서)보다 위", () => {
    const out = mergeClassHistory([
      [e("2026-08-04", "report")],
      [e("2026-08-04", "enrollment")],
      [e("2026-08-04", "audit")],
      [e("2026-08-04", "schedule")],
    ]);
    expect(out.map((x) => x.source)).toEqual(["audit", "schedule", "enrollment", "report"]);
  });

  it("날짜 없는 항목은 뺀다(정렬이 무너지지 않게)", () => {
    const out = mergeClassHistory([[{ ...e("", "audit") }]]);
    expect(out).toEqual([]);
  });
});
