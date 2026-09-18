import { describe, expect, it } from "vitest";
import {
  labSeparateChanges,
  planSlotArchives,
  preserveScheduleFields,
  resolveLabSeparate,
  type IncomingSlot,
  type PriorSlot,
} from "./schedule-preserve";

const TODAY = "2026-09-17";
const noPeriod = { validFrom: null, validTo: null, provided: false };

const incoming = (over: Partial<IncomingSlot> = {}): IncomingSlot => ({
  dayOfWeek: "tue",
  startTime: "16:20",
  endTime: "17:20",
  teacherId: null,
  classroomId: null,
  seatLabel: "LAB",
  ...over,
});
const prior = (over: Partial<PriorSlot> = {}): PriorSlot => ({
  dayOfWeek: "tue",
  startTime: "16:20:00",
  endTime: "17:20:00",
  validFrom: "2026-09-01",
  validTo: null,
  teacherId: null,
  classroomId: null,
  slotTeacherLabel: "LAB",
  slotRoomLabel: null,
  periodLabel: null,
  mergeGroup: null,
  labSeparate: false,
  ...over,
});

describe("'따로 수업(*LAB)' 표식 저장 규칙 (원장 2026-09-17)", () => {
  it("폼이 켜면 켜지고, 폼이 안 보내면(옛 탭·자유 시각 행) 기존 값을 승계한다", () => {
    expect(resolveLabSeparate(incoming({ labSeparate: true }), prior())).toBe(true);
    expect(resolveLabSeparate(incoming(), prior({ labSeparate: true }))).toBe(true);
    expect(resolveLabSeparate(incoming({ labSeparate: false }), prior({ labSeparate: true }))).toBe(false);
  });

  it("🔴 LAB 자리일 때만 켜진다 — JJ·강사로 바꾸면 꺼진다(다시 LAB으로 돌릴 때 유령 표식 방지)", () => {
    expect(resolveLabSeparate(incoming({ seatLabel: "JJ", labSeparate: true }), prior({ labSeparate: true }))).toBe(false);
    expect(resolveLabSeparate(incoming({ seatLabel: null, teacherId: "t1" }), prior({ labSeparate: true }))).toBe(false);
    // 자유 시각 행: 담당 드롭다운 없이 자리 라벨을 그대로 되돌려 보낸다 → 승계.
    expect(resolveLabSeparate(incoming({ seatLabel: "LAB" }), prior({ labSeparate: true }))).toBe(true);
  });

  it("재삽입 값에 최종 표식이 실린다", () => {
    const [row] = preserveScheduleFields({ incoming: [incoming({ labSeparate: true })], prior: [prior()], period: noPeriod, today: TODAY });
    expect(row).toMatchObject({ slotTeacherLabel: "LAB", labSeparate: true });
  });

  it("🔴 켜고 끄는 것은 **제자리에서** 고친다 — 마감 행 없이 옛 시작일 그대로(원장 2026-09-18: 켠 날 이전 요일도 바로 `*LAB`)", () => {
    // 9/17엔 오늘부터 갈랐다 → 이번 주 화요일(켠 날 이전)이 옛 행이라 통합뷰에 `LAB` 그대로였다.
    expect(planSlotArchives({ incoming: [incoming({ labSeparate: true })], prior: [prior()], today: TODAY })).toEqual([]);
    expect(planSlotArchives({ incoming: [incoming({ labSeparate: false })], prior: [prior({ labSeparate: true })], today: TODAY })).toEqual([]);
    const [on] = preserveScheduleFields({ incoming: [incoming({ labSeparate: true })], prior: [prior()], period: noPeriod, today: TODAY });
    expect(on).toMatchObject({ validFrom: "2026-09-01", labSeparate: true });
    // 수정 폼은 늘 운영 기간을 함께 보낸다(교시 시작일 9/1) — 그래도 같은 행이다.
    const [withForm] = preserveScheduleFields({
      incoming: [incoming({ labSeparate: true })],
      prior: [prior()],
      period: { validFrom: "2026-09-01", validTo: null, provided: true },
      today: TODAY,
    });
    expect(withForm).toMatchObject({ validFrom: "2026-09-01", labSeparate: true });
  });

  it("담당·강의실이 **함께** 바뀐 저장은 종전대로 오늘부터 가르고, 새 행이 표식을 들고 간다", () => {
    const moved = incoming({ labSeparate: true, classroomId: "r603" });
    const archives = planSlotArchives({ incoming: [moved], prior: [prior()], today: TODAY });
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ validTo: "2026-09-16", labSeparate: false });
    const [row] = preserveScheduleFields({ incoming: [moved], prior: [prior()], period: noPeriod, today: TODAY });
    expect(row).toMatchObject({ validFrom: TODAY, labSeparate: true, classroomId: "r603" });
  });

  it("값이 그대로면 마감 행도 새 구간도 없다(저장 한 번에 이력이 쌓이지 않는다)", () => {
    expect(planSlotArchives({ incoming: [incoming({ labSeparate: true })], prior: [prior({ labSeparate: true })], today: TODAY })).toEqual([]);
    expect(planSlotArchives({ incoming: [incoming()], prior: [prior({ labSeparate: true })], today: TODAY })).toEqual([]);
  });

  it("감사로그용 변경 목록 — 켬·끔과 새로 켜 둔 LAB 교시", () => {
    expect(labSeparateChanges([incoming({ labSeparate: true })], [prior()])).toEqual([{ dayOfWeek: "tue", startTime: "16:20", on: true }]);
    expect(labSeparateChanges([incoming({ labSeparate: false })], [prior({ labSeparate: true })])).toEqual([{ dayOfWeek: "tue", startTime: "16:20", on: false }]);
    expect(labSeparateChanges([incoming({ dayOfWeek: "wed", labSeparate: true })], [])).toEqual([{ dayOfWeek: "wed", startTime: "16:20", on: true }]);
    expect(labSeparateChanges([incoming()], [prior({ labSeparate: true })])).toEqual([]);
  });
});

describe("🔴 가른 행은 오늘부터 — 수정 폼이 운영 기간(시작일)을 함께 보내도 옛 행과 안 겹친다 (적대적 리뷰 2026-09-17)", () => {
  // 표식은 2026-09-18부터 가르지 않는다 — 가르기 규칙 회귀는 **강의실 변경**을 방아쇠로 지킨다.
  // 실제 수정 폼 조건: 교시 시작일이 모두 9/1이라 폼이 시작일 칸을 9/1로 채워 보낸다.
  const formPeriod = { validFrom: "2026-09-01", validTo: null, provided: true };

  it("강의실을 바꾸면 옛 행은 9/16까지, 새 행은 9/17부터 — 9/1~9/16에 두 줄이 살지 않는다", () => {
    const args = { incoming: [incoming({ classroomId: "r603" })], prior: [prior()], today: TODAY };
    expect(planSlotArchives(args)[0]).toMatchObject({ validFrom: "2026-09-01", validTo: "2026-09-16" });
    const [row] = preserveScheduleFields({ ...args, period: formPeriod });
    expect(row).toMatchObject({ validFrom: TODAY, classroomId: "r603" });
  });

  it("같은 날 다시 바꾸면 오늘 시작한 행이라 더 가르지 않는다(누를 때마다 행이 늘지 않는다)", () => {
    const today = prior({ validFrom: TODAY, classroomId: "r603" });
    expect(planSlotArchives({ incoming: [incoming({ classroomId: "r604" })], prior: [today], today: TODAY })).toEqual([]);
    const [row] = preserveScheduleFields({ incoming: [incoming({ classroomId: "r604" })], prior: [today], period: formPeriod, today: TODAY });
    expect(row).toMatchObject({ validFrom: TODAY, classroomId: "r604" });
  });

  it("폼이 **오늘보다 뒤** 시작일을 보냈으면(개강을 미루는 명시 입력) 그 날짜가 이긴다", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming({ classroomId: "r603" })],
      prior: [prior()],
      period: { validFrom: "2026-10-01", validTo: null, provided: true },
      today: TODAY,
    });
    expect(row!.validFrom).toBe("2026-10-01");
  });

  it("🔴 이미 끝난 구간으로 저장하면(종료일이 어제) 시작일을 오늘로 당기지 않는다 — `시작 > 종료` 유령 행 방지", () => {
    // 3/1부터 돌던 반을 "어제(8/31)부로 끝내며" 같은 저장에서 강의실도 바로잡는다.
    const old = prior({ validFrom: "2026-03-01" });
    const ended = { validFrom: "2026-03-01", validTo: "2026-08-31", provided: true };
    const [row] = preserveScheduleFields({ incoming: [incoming({ classroomId: "r603" })], prior: [old], period: ended, today: TODAY });
    expect(row).toMatchObject({ validFrom: "2026-03-01", validTo: "2026-08-31" });
    expect(row!.validFrom <= row!.validTo!).toBe(true);
    // 그 짝은 마감 행도 안 만든다(재삽입 행이 같은 구간을 덮는다).
    expect(planSlotArchives({ incoming: [incoming({ classroomId: "r603" })], prior: [old], today: TODAY, periodValidTo: "2026-08-31" })).toEqual([]);
    // 종료일이 없거나 오늘 이후면 종전대로 오늘부터 가른다.
    expect(planSlotArchives({ incoming: [incoming({ classroomId: "r603" })], prior: [old], today: TODAY, periodValidTo: null })).toHaveLength(1);
  });

  it("가르지 않는 행은 종전대로 폼 시작일을 따른다", () => {
    const [row] = preserveScheduleFields({ incoming: [incoming()], prior: [prior()], period: { validFrom: "2026-08-25", validTo: null, provided: true }, today: TODAY });
    expect(row!.validFrom).toBe("2026-08-25");
  });
});
