import { describe, expect, it } from "vitest";
import { teacherWork, type WorkReport } from "./teacher-work";
import { narrowBySubject } from "../layout/narrow";
import { previewSnapshot } from "../layout/preview";
import { MENU_KEYS } from "@/lib/permissions";
import type { OverviewSnapshot } from "./model";

const classes = [
  { id: "m1", teacherId: "t1", teacherName: "김강사", subject: "math" },
  { id: "e1", teacherId: "t1", teacherName: "김강사", subject: "english" },
  { id: "m2", teacherId: "t2", teacherName: "김강사", subject: "math" },
];
const range = { reportFrom: "2026-10-06", videoFrom: "2026-09-13", to: "2026-10-12" };
const report = (id: string, classId: string, date: string, status: string | null = null): WorkReport => ({ id, classId, studentId: id, date, status, videoHomework: true });
const reports = [report("1", "m1", "2026-10-08", "success"), report("2", "m1", "2026-10-08", "queued"), report("3", "e1", "2026-10-08", "failed"), report("4", "m2", "2026-10-08", null), report("5", "m1", "2026-10-01")];

describe("강사별 업무 현황", () => {
  it("한 강사의 과목별 집계와 동명이인 강사를 분리하고, 중복 보고서를 한 번 센다", () => {
    const result = teacherWork(classes, [...reports, reports[0]], [], range);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.teacherId === "t1" && r.subject === "math")).toMatchObject({ reports: 2, sent: 1, pending: 1, failed: 0 });
    expect(result.rows.find((r) => r.subject === "english")).toMatchObject({ reports: 1, failed: 1 });
    expect(result.rows.find((r) => r.teacherId === "t2")).toMatchObject({ reports: 1, pending: 1 });
  });
  it("없어진 숙제·다른 반·기간 밖 미제출은 포함하지 않는다", () => {
    const outcome = { classId: "m1", studentId: "5", date: "2026-10-01", status: "missing", observedAt: "2026-10-12T10:00:00Z" };
    const result = teacherWork(classes, reports, [outcome, outcome, { ...outcome, studentId: "not-assigned" }, { ...outcome, classId: "outside" }], range);
    expect(result.rows.find((r) => r.teacherId === "t1" && r.subject === "math")?.videoMissing).toBe(1);
    expect(teacherWork(classes, reports.map((r) => ({ ...r, videoHomework: false })), [outcome], range).rows.every((r) => r.videoMissing === 0)).toBe(true);
  });
  it("저장된 보고서가 없는 담당 강사도 0건으로 표시한다", () => {
    expect(teacherWork(classes, [], [], range).rows).toHaveLength(3);
  });
  it("서버와 미리보기 모두 담당 과목 업무·수강종료만 남긴다", () => {
    const ok = <T,>(data: T) => ({ data, at: 1, error: false });
    const sections = {
      teacherWork: ok(teacherWork(classes, reports, [], range)),
      withdrawals: ok({ month: "2026-10", rows: [
        { id: "m", name: "수학학생", subject: "math", program: "math" as const, schoolGrade: null, withdrawnAt: "2026-10-01" },
        { id: "e", name: "영어학생", subject: "english", program: "eie" as const, schoolGrade: null, withdrawnAt: "2026-10-01" },
        { id: "s", name: "과학학생", subject: "science", program: null, schoolGrade: null, withdrawnAt: "2026-10-01" },
      ] }),
    };
    expect(narrowBySubject(sections, ["science"], (key) => key ?? null, false).withdrawals?.data?.rows.map((r) => r.id)).toEqual(["s"]);
    const full = { sections, today: range.to, subjects: { math: "수학", english: "영어", science: "과학" }, allowed: MENU_KEYS } as unknown as OverviewSnapshot;
    const preview = previewSnapshot(full, { role: "subject", menus: new Set(MENU_KEYS), subject: { key: "math", label: "수학" }, items: [{ id: "panel:teacherWork", w: 12, h: 1 }, { id: "kpi:withdrawals", w: 6, h: 1 }] });
    expect(preview.sections.teacherWork?.data?.rows.map((r) => r.subject)).toEqual(["math", "math"]);
    expect(preview.sections.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["m"]);
  });
});
