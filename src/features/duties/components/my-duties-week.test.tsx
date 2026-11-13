import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { foldWeekRows, type DutyWeekRow } from "../view";
import { MyDutiesWeek } from "./my-duties-week";

const NOW = Date.parse("2026-11-11T06:00:00.000Z");
const row = (o: Partial<DutyWeekRow>): DutyWeekRow => ({ cycle: "2026-11-10", status: "done", voidReason: null, studentId: "s1", classId: "c1", kind: "attendance", dueAt: "2026-11-10T09:00:00.000Z", studentName: "김하나", className: "중2 A", ...o });

describe("내 업무 — 이번 주 표의 결석", () => {
  it("🔴 결석으로 빠진 보고서 업무는 수에 넣지 않고 '결석' 조각으로 싣는다 — 출결만 있고 보고서가 없는 날이 왜 그런지 겉으로 보이게", () => {
    const cells = foldWeekRows([
      row({}), // 출결(결석으로 적음) = 완료
      row({ kind: "report_send", status: "void", voidReason: "absent" }),
      row({ kind: "report_write", status: "void", voidReason: "absent" }),
      // 다른 날: 출결 완료 · 보고서는 기한이 지나 미처리 / 미처리 확정은 미처리로 센다 / 면제 · 그 밖의 void는 싣지 않는다
      row({ cycle: "2026-11-09", dueAt: "2026-11-09T09:00:00.000Z" }),
      row({ cycle: "2026-11-09", kind: "report_send", status: "open", dueAt: "2026-11-10T09:00:00.000Z" }),
      row({ cycle: "2026-11-06", kind: "report_send", status: "void", voidReason: "expired", dueAt: "2026-11-07T09:00:00.000Z" }),
      row({ cycle: "2026-11-06", kind: "attendance", status: "void", voidReason: "waived" }),
      row({ cycle: "2026-11-06", kind: "attendance", status: "void", voidReason: "moved" }),
    ], NOW);
    const of = (day: string) => cells.find((x) => x.day === day)!;
    // 결석한 날: 전체 1(출결) · 완료 1 — 결석 조각 둘은 수에 없다.
    expect(of("2026-11-10")).toMatchObject({ total: 1, done: 1, kinds: [{ kind: "attendance", state: "done" }, { kind: "report_send", state: "absent" }, { kind: "report_write", state: "absent" }] });
    expect(of("2026-11-09")).toMatchObject({ total: 2, done: 1, kinds: [{ kind: "attendance", state: "done" }, { kind: "report_send", state: "late" }] });
    expect(of("2026-11-06")).toMatchObject({ total: 1, done: 0, kinds: [{ kind: "report_send", state: "late" }] });
  });

  it("화면 — 결석한 날 칸에 '결석' 조각 하나(종류가 둘이어도) · 칸 설명에 까닭", () => {
    const week = foldWeekRows([row({}), row({ kind: "report_send", status: "void", voidReason: "absent" }), row({ kind: "report_write", status: "void", voidReason: "absent" })], NOW);
    const html = renderToStaticMarkup(<MyDutiesWeek week={week} days={["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]} today="2026-11-11" classDays={{ c1: ["mon", "tue"] }} />);
    expect(html.match(/>결석</g)?.length).toBe(1);
    expect(html).toContain("출결 완료 · 보고서 작성 결석(업무 없음) · 보고서 발송 결석(업무 없음)");
    // 반 머리의 수는 출결 한 건뿐이다(결석은 업무가 아니다).
    expect(html).toContain("이번 주 1/1");
  });
});
