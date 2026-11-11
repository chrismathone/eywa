import { describe, expect, it } from "vitest";
import type { ExitRow } from "./exit-rows";
import type { SheetExitRecord } from "./sheet-teachers";
import { mergeSheetExits } from "./sheet-exit-rows";
import { studentNamesOf } from "./sheet-match";

const row = (over: Partial<ExitRow>): ExitRow => ({
  key: "s1", studentId: "s1", kind: "withdrawn", name: "태유정", school: null, grade: null, date: "2026-07-08", countDate: "2026-07-08",
  subjects: ["math"], className: "중등M 중2 PS2S", programSubject: "math", englishTrack: null, systemBulk: false, reasonKey: null,
  reasonLabel: null, detail: null, consulted: null, memo: null, cleanup: false, tenureDays: null, ...over,
});
const rec = (over: Partial<SheetExitRecord>): SheetExitRecord => ({
  month: "2026-06", subject: "math", eie: false, name: "태유정", teachers: ["김화영"], schoolGrade: "침산중2", className: "PS2S",
  date: null, reason: "타학원 이동", memo: null, ...over,
});
const today = "2026-11-11";

describe("퇴원관리 = 2026-10까지 퇴원생 관리 차트 줄 그대로", () => {
  it("🔴 시트 줄과 이어진 에이와 줄은 시트의 달로 센다(7/8 퇴원 → 6월 탭)", () => {
    const out = mergeSheetExits([row({})], [rec({})], today);
    expect(out).toHaveLength(1);
    expect(out[0]!.countDate).toBe("2026-06-30");
    expect(out[0]!.studentId).toBe("s1");
  });
  it("🔴 시트에만 있는 줄은 시트 글로 만들고(학생 연결 없음), 그 달들의 에이와에만 있는 줄은 뺀다", () => {
    const out = mergeSheetExits(
      [row({ key: "x", studentId: "x", name: "폐강반학생", date: "2026-07-15", countDate: "2026-07-15" })],
      [rec({ name: "이민성", month: "2026-06" })],
      today,
    );
    expect(out.map((r) => [r.name, r.fromSheet ?? false, r.countDate])).toEqual([["이민성", true, "2026-06-30"]]);
  });
  it("두 과목 퇴원 줄은 시트 과목마다 한 줄 · 시트 달 밖(11월~) 줄은 그대로", () => {
    const out = mergeSheetExits(
      [row({ subjects: ["math", "english"] }), row({ key: "n", studentId: "n", name: "새학생", date: "2026-11-05", countDate: "2026-11-05" })],
      [rec({}), rec({ subject: "english", teachers: ["추민아"] })],
      today,
    );
    expect(out.map((r) => [r.key, r.subjects.join()])).toEqual([["s1|math", "math"], ["s1|english", "english"], ["n", "math"]]);
  });
  it("에이와가 장부 정리로 둔 줄은 시트의 사유로", () => {
    const out = mergeSheetExits([row({ cleanup: true, reasonLabel: "기타" })], [rec({})], today);
    expect([out[0]!.cleanup, out[0]!.reasonLabel]).toEqual([false, "타학원 이동"]);
  });
  it("시트가 없으면 그대로", () => {
    expect(mergeSheetExits([row({})], null, today)).toHaveLength(1);
  });
});

describe("잇기 규칙(퇴원관리)", () => {
  it("🔴 시트에만 있는 줄 = 지금 다니는 학생이면 '수강종료', 아니면 '퇴원' · 시트가 아직 안 적던 과목·달은 에이와 그대로", () => {
    const out = mergeSheetExits(
      [row({ key: "e", studentId: "e", name: "영어생", subjects: ["english"], date: "2026-05-20", countDate: "2026-05-20" })],
      [rec({ name: "재원생", month: "2026-05" }), rec({ name: "떠난학생", month: "2026-05" }), rec({ name: "다른학생", subject: "english", month: "2026-06" })],
      today,
      studentNamesOf([{ name: "재원생", status: "enrolled", enrolled_at: "2025-01-01", withdrawn_at: null }]),
    );
    expect(out.map((r) => [r.name, r.kind])).toEqual([["재원생", "subject-ended"], ["떠난학생", "withdrawn"], ["다른학생", "withdrawn"], ["영어생", "withdrawn"]]);
  });
});
