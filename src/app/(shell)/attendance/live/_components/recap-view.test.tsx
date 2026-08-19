/**
 * 요약 탭 렌더 스모크 — 화면이 **결정론 집계를 실제로 그리는지** 확인한다.
 * (타입체크·빌드는 "렌더 중 터짐"을 못 잡는다. 이 화면은 AI 없이도 온전해야 하는 것이 핵심 성질이라
 *  AI 상태가 null인 경로를 특히 본다.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OperationsProvider } from "@/features/owner/operations-context";
import { buildDayRecap } from "@/features/attendance/recap/digest";
import { RecapView } from "./recap-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// 서버 액션은 버튼을 누를 때만 도는 자리 — 렌더 스모크에선 모듈만 있으면 된다.
vi.mock("@/features/attendance/recap/server/actions", () => ({ generateRecapSummary: vi.fn() }));

afterEach(cleanup);

const recap = buildDayRecap({
  date: "2026-08-18",
  slots: [
    {
      classId: "c1",
      className: "중2 A",
      subject: "math",
      slotStart: "16:20",
      saveSlot: null,
      teacherName: "김강사",
      slotTeacherLabel: null,
      hasAnyRecord: true,
      students: [
        { studentId: "s1", studentName: "이학생", schoolGrade: "경명여중2", status: "absent", note: "감기" },
        { studentId: "s2", studentName: "박학생", schoolGrade: "경명여중2", status: "late", note: null },
      ],
    },
    {
      classId: "c2",
      className: "영어 B",
      subject: "english",
      slotStart: "17:20",
      saveSlot: "17:20",
      teacherName: "최강사",
      slotTeacherLabel: null,
      hasAnyRecord: false,
      students: [{ studentId: "s3", studentName: "정학생", schoolGrade: "경명중1", status: null, note: null }],
    },
  ],
  recentAbsenceOf: (id) => (id === "s1" ? 3 : null),
});

function renderRecap(isToday = false) {
  return render(
    <OperationsProvider
      subjects={[
        { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
        { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
      ]}
      gradeLevels={["중2"]}
    >
      <RecapView recap={recap} date="2026-08-18" isToday={isToday} ai={null} />
    </OperationsProvider>,
  );
}

describe("RecapView", () => {
  it("AI 정리가 없어도 집계·명단을 그대로 그린다", () => {
    renderRecap();
    expect(screen.getByText("이학생")).toBeTruthy();
    expect(screen.getByText("조치 미완료")).toBeTruthy();
    // 반복 결석 배지는 '지금 기준 14일'임을 라벨로 밝힌다.
    expect(screen.getByText("최근 14일 3회")).toBeTruthy();
    // 과목은 학원설정 라벨로(raw 키 노출 금지).
    expect(screen.queryByText(/english/)).toBeNull();
    // 미입력 반은 그날 출석부로 이어진다.
    expect(screen.getByRole("link", { name: "영어 B" }).getAttribute("href")).toBe("/attendance/2026-08-18/c2");
    // AI가 없을 때도 "아래 집계가 사실"이라고 말한다.
    expect(screen.getByRole("button", { name: "AI로 정리" })).toBeTruthy();
  });

  it("오늘을 요약하면 진행 중임을 먼저 말한다", () => {
    renderRecap(true);
    expect(screen.getByText(/오늘은 아직 진행 중입니다/)).toBeTruthy();
  });
});
