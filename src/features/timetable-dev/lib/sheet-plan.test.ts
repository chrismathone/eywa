import { describe, expect, it } from "vitest";
import type { ResolvedSlot, SheetGrid } from "@/features/timetable/import/structure/types";
import type { PlanSlot } from "../types";
import { buildPlanSheetImport, detectGridLayout, parseSheetUrl } from "./sheet-plan";

// ── 픽스처 ────────────────────────────────────────────────────────────────────

const CLASS_A = "11111111-1111-4111-8111-111111111111";
const CLASS_B = "22222222-2222-4222-8222-222222222222";
const TEACHER_1 = "33333333-3333-4333-8333-333333333333";
const TEACHER_2 = "44444444-4444-4444-8444-444444444444";
const ROOM_1 = "55555555-5555-4555-8555-555555555555";

function slot(over: Partial<ResolvedSlot> = {}): ResolvedSlot {
  return {
    teacherIndex: 1,
    teacherName: "Jane",
    teacherHeader: "Jane 추민아 301",
    day: "mon",
    koDay: "월",
    className: "LT2",
    room: "301",
    startTime: "16:20",
    endTime: "17:20",
    rawTimeLabel: "4:20~5:20",
    starred: false,
    raw: "LT2/301",
    grid: { r1: 4, c1: 1, r2: 9, c2: 1 },
    classId: CLASS_A,
    teacherId: TEACHER_1,
    classroomId: ROOM_1,
    ...over,
  };
}

function planSlot(over: Partial<PlanSlot> = {}): PlanSlot {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    planMonth: "2026-09",
    classId: CLASS_A,
    dayOfWeek: "mon",
    startTime: "16:20",
    endTime: "17:20",
    teacherId: TEACHER_1,
    classroomId: ROOM_1,
    slotTeacherLabel: "Jane",
    slotRoomLabel: "301",
    periodLabel: "1교시",
    mergeGroup: "99999999-9999-4999-8999-999999999999",
    sourceScheduleId: "88888888-8888-4888-8888-888888888888",
    ...over,
  };
}

// ── parseSheetUrl ─────────────────────────────────────────────────────────────

describe("parseSheetUrl — 원장이 붙여넣는 주소", () => {
  it("원장이 준 실제 주소에서 문서 id와 탭 번호를 뽑는다", () => {
    expect(
      parseSheetUrl(
        "https://docs.google.com/spreadsheets/d/1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA/edit?gid=661682520#gid=661682520",
      ),
    ).toEqual({ spreadsheetId: "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA", gid: 661682520 });
  });

  it("🔑 쿼리와 해시가 다르면 **해시가 이긴다**(사람이 지금 보고 있는 탭)", () => {
    const r = parseSheetUrl("https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit?gid=111#gid=222");
    expect(r?.gid).toBe(222);
  });

  it("해시가 없으면 쿼리로 폴백한다", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit?gid=333")?.gid).toBe(333);
  });

  it("해시에 다른 파라미터가 섞여 있어도 gid를 찾는다", () => {
    expect(
      parseSheetUrl("https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit#gid=0&range=A1")?.gid,
    ).toBe(0);
  });

  it("gid가 없으면 null — 첫 탭을 임의로 집지 않는다", () => {
    expect(parseSheetUrl("https://docs.google.com/spreadsheets/d/abcdefghij1234567890/edit")).toEqual({
      spreadsheetId: "abcdefghij1234567890",
      gid: null,
    });
  });

  it("주소가 아니라 문서 id만 붙여넣어도 받는다(연동 설정에 저장된 형태)", () => {
    expect(parseSheetUrl("  1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA  ")).toEqual({
      spreadsheetId: "1-1JHCw36iWPku782DXMhqYbEMBUFL7bElfJjSQekoWA",
      gid: null,
    });
  });

  it("🔴 구글이 아닌 도메인은 거절한다 — 서비스계정이 엉뚱한 문서를 긁으러 가면 안 된다", () => {
    expect(parseSheetUrl("https://evil.example.com/spreadsheets/d/abcdefghij1234567890/edit")).toBeNull();
  });

  it("빈 값·엉뚱한 문자열은 null", () => {
    expect(parseSheetUrl("")).toBeNull();
    expect(parseSheetUrl(null)).toBeNull();
    expect(parseSheetUrl("9월 시간표")).toBeNull();
    expect(parseSheetUrl("https://docs.google.com/document/d/abcdefghij1234567890/edit")).toBeNull();
  });
});

// ── detectGridLayout ──────────────────────────────────────────────────────────

describe("detectGridLayout — 탭 구조 판별", () => {
  const grid = (cells: string[][]): SheetGrid => ({ cells, merges: [] });

  it("2행이 요일이면 aywa export 탭", () => {
    expect(
      detectGridLayout(
        grid([
          ["시각", "Jane", "Dom"],
          ["", "월 9/1", "월 9/1"],
          ["14:20", "LT2", ""],
        ]),
      ),
    ).toBe("aywa");
  });

  it("4행이 요일이면 손으로 만든 마스터 탭", () => {
    expect(
      detectGridLayout(
        grid([
          ["", "1", "", "2"],
          ["", "Jane 301", "", "Dom 302"],
          ["", "근무 14:00~", "", ""],
          ["시각", "월", "화", "월"],
          ["4:20", "LT2/301", "", ""],
        ]),
      ),
    ).toBe("master");
  });

  it("판별할 단서가 없으면 마스터로 본다(미래 달 탭은 손시트다)", () => {
    expect(detectGridLayout(grid([["a"], ["b"]]))).toBe("master");
  });
});

// ── buildPlanSheetImport ──────────────────────────────────────────────────────

describe("buildPlanSheetImport — 시트 슬롯 → 계획 칸", () => {
  it("빈 달에 시트 칸이 그대로 들어간다(add)", () => {
    const p = buildPlanSheetImport([slot()], []);
    expect(p.counts).toMatchObject({ add: 1, update: 0, keep: 0, orphan: 0, skipped: 0 });
    expect(p.rows[0]!.input).toMatchObject({
      classId: CLASS_A,
      dayOfWeek: "mon",
      startTime: "16:20",
      endTime: "17:20",
      teacherId: TEACHER_1,
      classroomId: ROOM_1,
      slotTeacherLabel: "Jane",
      slotRoomLabel: "301",
    });
  });

  it("같은 값이면 keep — 다시 가져와도 아무 것도 쓰지 않는다", () => {
    const p = buildPlanSheetImport([slot()], [planSlot()]);
    expect(p.counts).toMatchObject({ add: 0, update: 0, keep: 1 });
  });

  it("방 표기만 다르면(본원303 ↔ 303) keep — 표기 차이로 전건이 '변경'이 되지 않는다", () => {
    const p = buildPlanSheetImport([slot({ room: "303", classroomId: ROOM_1 })], [planSlot({ slotRoomLabel: "본원303" })]);
    expect(p.counts.keep).toBe(1);
    expect(p.counts.update).toBe(0);
  });

  it("종료 시각이 바뀌면 update + 이전 값을 함께 돌려준다", () => {
    const p = buildPlanSheetImport([slot({ endTime: "18:00" })], [planSlot()]);
    expect(p.counts).toMatchObject({ update: 1, add: 0, keep: 0 });
    expect(p.rows[0]!.before).toEqual({ endTime: "17:20", teacherLabel: "Jane", roomLabel: "301" });
    expect(p.rows[0]!.input.endTime).toBe("18:00");
  });

  it("🔑 시트에 없는 값(교시 라벨·합반 묶음·복사 출처)은 기존 계획 것을 보존한다", () => {
    const p = buildPlanSheetImport([slot({ endTime: "18:00" })], [planSlot()]);
    expect(p.rows[0]!.input).toMatchObject({
      periodLabel: "1교시",
      mergeGroup: "99999999-9999-4999-8999-999999999999",
      sourceScheduleId: "88888888-8888-4888-8888-888888888888",
    });
  });

  it("🔑 강사 이름이 그대로면 해석 실패(teacherId=null)여도 기존 연결을 유지한다", () => {
    const p = buildPlanSheetImport([slot({ teacherId: null, endTime: "18:00" })], [planSlot()]);
    expect(p.rows[0]!.input.teacherId).toBe(TEACHER_1);
  });

  it("강사 이름이 바뀌면 새 강사로 간다(해석 실패면 라벨만 남는다)", () => {
    const withId = buildPlanSheetImport([slot({ teacherName: "Dom", teacherId: TEACHER_2 })], [planSlot()]);
    expect(withId.rows[0]!.input).toMatchObject({ teacherId: TEACHER_2, slotTeacherLabel: "Dom" });

    const unresolved = buildPlanSheetImport([slot({ teacherName: "Dom", teacherId: null })], [planSlot()]);
    expect(unresolved.rows[0]!.input).toMatchObject({ teacherId: null, slotTeacherLabel: "Dom" });
  });

  it("🔴 aywa에 없는 반은 담지 않고 이유와 함께 돌려준다(유령 반을 만들지 않는다)", () => {
    const p = buildPlanSheetImport(
      [slot(), slot({ className: "TEVO", classId: null }), slot({ className: "TEVO", classId: null, day: "tue" })],
      [],
    );
    expect(p.counts.add).toBe(1);
    expect(p.counts.skipped).toBe(2);
    expect(p.skipped[0]).toMatchObject({ className: "TEVO", count: 2 });
    expect(p.skipped[0]!.reason).toContain("에이와에 없는 반");
  });

  it("종료 시각이 없거나 뒤집힌 칸은 담지 않는다(DB가 NOT NULL·순서를 요구한다)", () => {
    const p = buildPlanSheetImport(
      [slot({ endTime: null }), slot({ day: "tue", endTime: "15:00" })],
      [],
    );
    expect(p.counts.add).toBe(0);
    expect(p.counts.skipped).toBe(2);
  });

  it("시트에 없는 기존 칸은 orphan으로 보이기만 한다(기본 병합은 지우지 않는다)", () => {
    const p = buildPlanSheetImport([slot()], [planSlot(), planSlot({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", classId: CLASS_B, startTime: "17:30", endTime: "18:30" })], {
      classNameById: new Map([[CLASS_B, "DP6"]]),
    });
    expect(p.counts.orphan).toBe(1);
    expect(p.orphans[0]).toMatchObject({ className: "DP6", startTime: "17:30" });
  });

  it("같은 칸에 강사가 여럿이면 첫 강사만 담고 합반 경고를 남긴다", () => {
    const p = buildPlanSheetImport([slot(), slot({ teacherName: "Dom", teacherId: TEACHER_2 })], []);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]!.input.slotTeacherLabel).toBe("Jane");
    expect(p.warnings.join(" ")).toContain("합반");
  });

  it("해시는 입력 순서에 흔들리지 않고, 값이 바뀌면 달라진다", () => {
    const a = buildPlanSheetImport([slot(), slot({ day: "tue" })], []);
    const b = buildPlanSheetImport([slot({ day: "tue" }), slot()], []);
    expect(a.hash).toBe(b.hash);
    const c = buildPlanSheetImport([slot({ endTime: "18:00" }), slot({ day: "tue" })], []);
    expect(c.hash).not.toBe(a.hash);
  });

  it("정렬은 요일 → 시작시각 순(화면·해시가 흔들리지 않게)", () => {
    const p = buildPlanSheetImport(
      [slot({ day: "wed", startTime: "16:20" }), slot({ day: "mon", startTime: "18:00", endTime: "19:00" }), slot({ day: "mon", startTime: "16:20" })],
      [],
    );
    expect(p.rows.map((r) => `${r.input.dayOfWeek}${r.input.startTime}`)).toEqual(["mon16:20", "mon18:00", "wed16:20"]);
  });
});
