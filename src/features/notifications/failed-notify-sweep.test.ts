import { describe, expect, it } from "vitest";
import {
  buildFailureBody,
  notifyKey,
  parseNotifiedKey,
  selectMissing,
  type FailedReportRow,
} from "./failed-notify-sweep";

const row = (o: Partial<FailedReportRow> = {}): FailedReportRow => ({
  id: "r1",
  studentName: "김수련",
  reportDate: "2026-07-24",
  teacherName: "김윤하",
  classId: null,
  error: "해당 학생 없음",
  ...o,
});

describe("notifyKey / parseNotifiedKey", () => {
  it("트리거 본문에서 키를 되뽑아 왕복이 맞는다", () => {
    const r = row();
    expect(parseNotifiedKey(buildFailureBody(r))).toBe(notifyKey(r.studentName, r.reportDate));
  });

  it("형식이 아니면 null — 옛 문구를 중복으로 오판해 알림을 삼키지 않는다", () => {
    expect(parseNotifiedKey("발송에 실패했습니다")).toBeNull();
    expect(parseNotifiedKey(null)).toBeNull();
    expect(parseNotifiedKey("")).toBeNull();
  });

  it("이름에 공백·알파벳 접미사가 있어도 파싱된다", () => {
    expect(parseNotifiedKey("이동건A · 07-27 — 사유")).toBe("이동건A|07-27");
  });
});

describe("buildFailureBody", () => {
  it("'해당 학생 없음'은 학부모 초대 안내로 바꾼다(0143a 문구 유지)", () => {
    expect(buildFailureBody(row())).toBe(
      "김수련 · 07-24 — 학부모가 ClassNote 알림장에 연결되어 있지 않습니다 — 학부모를 초대한 뒤 다시 발송하세요.",
    );
  });

  it("사유가 없으면 콘솔 확인 안내", () => {
    expect(buildFailureBody(row({ error: null }))).toContain("사유가 기록되지 않았습니다");
  });

  it("그 밖의 사유는 원문 그대로", () => {
    expect(buildFailureBody(row({ error: "스샷 kage 업로드 실패" }))).toBe(
      "김수련 · 07-24 — 스샷 kage 업로드 실패",
    );
  });
});

describe("selectMissing", () => {
  it("이미 알림이 있는 건은 제외한다", () => {
    const rows = [row(), row({ id: "r2", studentName: "정다온" })];
    const missing = selectMissing(rows, new Set(["김수련|07-24"]));
    expect(missing.map((m) => m.studentName)).toEqual(["정다온"]);
  });

  it("같은 학생·같은 날 2행(과목 분리 등)이면 한 번만 만든다", () => {
    const rows = [row(), row({ id: "r2" })];
    expect(selectMissing(rows, new Set())).toHaveLength(1);
  });

  it("알림이 하나도 없으면 전부 대상", () => {
    expect(selectMissing([row(), row({ id: "r2", reportDate: "2026-07-22" })], new Set())).toHaveLength(2);
  });
});
