import { describe, expect, it } from "vitest";
import { bulkSendAlreadySent, bulkSendTailLines, planBulkSendExclusions } from "./bulk-send-preview";
import type { GridRow } from "./grid";
import type { OneScreenStudent, Subject } from "./types";

const tf = ((k: string, p: Record<string, string | number>) => `${k}:${p.n}${p.names ? `(${p.names})` : ""}|`) as never;
const su = (over: Partial<Subject> = {}) => ({ name: "수학", subjectKey: "science", classId: "c1", today: "1-1", ...over }) as Subject;
const stu = (id: string, s: Subject) => ({ id, name: id, grade: "중1", tag: "A", subjects: [s], tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } } }) as unknown as OneScreenStudent;
const row = (st: OneScreenStudent): GridRow => ({ student: st, subject: st.subjects[0]!, subjectIndex: 0, key: `${st.id}::수학` }) as GridRow;

describe("bulkSendAlreadySent", () => {
  it("게이트 이전 원본 행에서 이미 발송된 행을 센다(결석 제외 · 체크한 행 안에서)", () => {
    const a = stu("a", su({ classnoteStatus: "success" }));
    const b = stu("b", su({ attendanceRaw: "absent", classnoteStatus: "success" }));
    const view = { visible: [a, b], activeClassFilter: null, classTags: [], displaySettings: { options: { sort: "class" as const } } };
    expect(bulkSendAlreadySent({ view, keys: undefined, liveClassnoteStatus: () => undefined }).alreadySentRows).toBe(1);
    expect(bulkSendAlreadySent({ view, keys: ["b::수학"], liveClassnoteStatus: () => undefined }).alreadySentRows).toBe(0);
  });
});

describe("planBulkSendExclusions", () => {
  it("🔴 빈 멘트 행은 대상에서 빼고 누구인지 적는다 — 판정은 화면 스냅샷 reports", () => {
    const a = stu("a", su());
    const b = stu("b", su());
    const out = planBulkSendExclusions({
      rows: [row(a), row(b)],
      allRows: [row(a), row(b)],
      keySet: null,
      liveClassnoteStatus: () => undefined,
      reports: { a: { 수학: { draft: "멘트", sent: false } } },
      reportsRef: { current: {} },
      canEditAttendance: false,
      showDailyTest: false,
      showCheckTest: false,
      latestRow: () => null,
      tf,
    });
    expect(out.rows.map((r) => r.student.id)).toEqual(["a"]);
    expect(out.emptyMentRows.map((r) => r.student.id)).toEqual(["b"]);
    expect(out.emptyMentLine).toBe("os.c.lineMent:1(b)|");
  });
});

describe("bulkSendTailLines", () => {
  it("영어 옛 값은 이름(중복 없이) · 결석·이미 발송은 건수", () => {
    const out = bulkSendTailLines([{ student: { name: "가" } }, { student: { name: "가" } }], 2, 0, tf);
    expect(out).toEqual({ aiStaleLine: "os.tpl.lineOutdated:1(가)|", absentLine: "os.c.lineAbsent:2|", sentLine: "" });
  });
});
