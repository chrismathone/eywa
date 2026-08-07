import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridBodyRow, type GridConfig, type GridFieldHandlers, type GridRowActions } from "./grid-row";
import type { GridRow } from "../grid";
import type { OneScreenStudent, Subject } from "../types";

afterEach(cleanup);

/**
 * 결석 행 잠금(원장 2026-08-07: *"결석을 눌렀는데 진도 같은거 전부다 적을 수 있던데?"*).
 *
 * 🔴 이 스위트가 지키는 것은 **잠금의 경계**다: 보고서 입력은 잠기고, **출결 계열은 안 잠긴다.**
 *    출결까지 잠기면 잘못 누른 결석을 되돌릴 문이 없어 그 행이 영영 잠긴다.
 */
const fields = {
  onAttendance: vi.fn(),
  onProgress: vi.fn(),
  onProgressMode: vi.fn(),
  onStudyGrade: vi.fn(),
  onScore: vi.fn(),
  onMax: vi.fn(),
  onAttitude: vi.fn(),
  onHomework: vi.fn(),
  onTextbook: vi.fn(),
  onHomeworkToday: vi.fn(),
  onDraft: vi.fn(),
  onTrend: vi.fn(),
  onNote: vi.fn(),
  onMakeup: vi.fn(),
} satisfies GridFieldHandlers;

const actions = {
  onSendRow: vi.fn(),
  onAutoWrite: vi.fn(),
  onOpenCard: vi.fn(),
  onImportPrev: vi.fn(),
  onAttach: vi.fn(),
  onRemoveAttachment: vi.fn(),
  onOpenAttachments: vi.fn(),
} satisfies GridRowActions;

const config: GridConfig = {
  attitudes: ["매우 좋음", "좋음"],
  allowTestMax: false,
  dailyEnabled: true,
  checkEnabled: true,
  attachmentUrls: {},
  noticeMode: "A",
};

function row(attendanceRaw: string | null): GridRow {
  const subject = {
    name: "수학",
    subjectLabel: "수학",
    subjectKey: "math",
    prev: "",
    today: "1. 다항식",
    classId: "c1",
    className: "중3 A",
    attendanceRaw,
  } as unknown as Subject;
  const student = {
    id: "s1",
    name: "학생",
    grade: "중3",
    tag: "중3 A",
    attendance: attendanceRaw === "absent" ? "결석" : "출석",
    subjects: [subject],
    tests: {
      daily: { score: null, max: 20, prevScore: null },
      check: { score: null, max: 20, prevScore: null },
    },
    attitude: null,
    homework: "",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  } as unknown as OneScreenStudent;
  return { student, subject, subjectIndex: 0, key: "s1::수학" };
}

function renderRow(attendanceRaw: string | null) {
  return render(
    <table>
      <tbody>
        <GridBodyRow
          row={row(attendanceRaw)}
          checked={false}
          onToggle={vi.fn()}
          rep={undefined}
          fields={fields}
          actions={actions}
          config={config}
          gen={{ rowBusy: false, attPending: new Set() }}
          nav={{ row: 0, studentRow: 0 }}
        />
      </tbody>
    </table>,
  );
}

describe("결석 행 — 보고서 입력은 잠긴다", () => {
  it("출석 행에서는 기록 칸이 전부 열려 있다", () => {
    renderRow("present");
    expect(screen.getByLabelText("학생 일일테스트")).not.toBeDisabled();
    expect(screen.getByLabelText("학생 수학 교재명")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 특이사항")).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 수학 학부모 문구")).not.toHaveAttribute("readonly");
  });

  it("결석 행에서는 진도·점수·교재·과제·특이사항·문구가 전부 잠긴다", () => {
    renderRow("absent");
    // 진도 — 선택 팝오버를 아예 열지 않고 읽기 전용 표시로 바뀐다.
    expect(screen.queryByLabelText("학생 수학 오늘 진도")).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByLabelText("학생 일일테스트")).toBeDisabled();
    expect(screen.getByLabelText("학생 확인테스트")).toBeDisabled();
    // 태도는 native select가 아니라 base-ui 드롭다운(버튼) — fieldset[disabled]이 버튼까지 먹는지 확인한다.
    expect(screen.getByLabelText("학생 태도")).toBeDisabled();
    expect(screen.getByLabelText("학생 과제 수행률")).toBeDisabled();
    expect(screen.getByLabelText("학생 수학 교재명")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 수학 오늘 과제")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 수학 보강")).toBeDisabled();
    expect(screen.getByLabelText("학생 특이사항")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 수학 학부모 문구")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("학생 수학 학습 추세")).toHaveAttribute("readonly");
  });

  // 🔴 여기가 뒤집히면 강사가 오클릭한 결석에서 빠져나올 수 없다.
  it("🔴 결석이어도 출결 알약과 수업타임은 살아 있다 — 되돌릴 유일한 문", () => {
    renderRow("absent");
    expect(screen.getByRole("button", { name: /출석/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /결석/ })).not.toBeDisabled();
  });
});
