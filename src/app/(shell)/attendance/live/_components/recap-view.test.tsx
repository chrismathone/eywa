/**
 * 요약 탭 렌더 스모크 — 화면이 **결정론 집계를 실제로 그리는지** 확인한다.
 * (타입체크·빌드는 "렌더 중 터짐"을 못 잡는다. 이 화면은 AI 없이도 온전해야 하는 것이 핵심 성질이라
 *  AI 상태가 null인 경로를 특히 본다.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OperationsProvider } from "@/features/owner/operations-context";
import { buildDayRecap } from "@/features/attendance/recap/digest";
import { buildRangeRecap } from "@/features/attendance/recap/range";
import { RecapView } from "./recap-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// 서버 액션은 버튼을 누를 때만 도는 자리 — 렌더 스모크에선 모듈만 있으면 된다.
vi.mock("@/features/attendance/recap/server/actions", () => ({ generateRecapSummary: vi.fn() }));

afterEach(cleanup);

const day = buildDayRecap({
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
const recap = buildRangeRecap([{ ...day, holiday: null }]);

/** 월요일 화면(금·토·일) — 금요일은 결석, 토요일은 휴원일, 일요일은 수업 없음. */
const mondayRecap = buildRangeRecap([
  { ...day, date: "2026-08-21", holiday: null },
  {
    ...buildDayRecap({ date: "2026-08-22", slots: [] }),
    holiday: "광복절",
  },
  { ...buildDayRecap({ date: "2026-08-23", slots: [] }), holiday: null },
]);

function renderRange(range: typeof recap) {
  return render(
    <OperationsProvider
      subjects={[
        { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
        { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
      ]}
      gradeLevels={["중2"]}
    >
      <RecapView recap={range} isToday={false} ai={null} />
    </OperationsProvider>,
  );
}

function renderRecap(isToday = false) {
  return render(
    <OperationsProvider
      subjects={[
        { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
        { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
      ]}
      gradeLevels={["중2"]}
    >
      <RecapView recap={recap} isToday={isToday} ai={null} />
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

  it("입력이 덜 된 강사를 펼치면 그 강사의 미입력 반이 그날 출석부 링크로 뜬다", () => {
    renderRecap();
    const toggle = screen.getByRole("button", { name: /최강사/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // 접힌 동안엔 링크가 날짜 블록 하나뿐이다(중복 링크로 화면이 두 번 말하지 않게).
    expect(screen.getAllByRole("link", { name: "영어 B" })).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // 펼치면 같은 반이 **같은 링크 규약**으로 한 줄 더(줄에 적힌 '미입력 1반'과 같은 수).
    const links = screen.getAllByRole("link", { name: "영어 B" });
    expect(links).toHaveLength(2);
    expect(links[1].getAttribute("href")).toBe("/attendance/2026-08-18/c2");
  });

  it("빈 출석부가 없는(칸만 덜 찍은) 강사 줄은 펼칠 것이 없어 버튼이 아니다", () => {
    const partial = buildRangeRecap([
      {
        ...buildDayRecap({
          date: "2026-08-18",
          slots: [
            {
              classId: "c3",
              className: "중3 C",
              subject: "math",
              slotStart: "16:20",
              saveSlot: null,
              teacherName: "한강사",
              slotTeacherLabel: null,
              hasAnyRecord: true,
              students: [
                { studentId: "s8", studentName: "가학생", schoolGrade: null, status: "present", note: null },
                { studentId: "s9", studentName: "나학생", schoolGrade: null, status: null, note: null },
              ],
            },
          ],
        }),
        holiday: null,
      },
    ]);
    renderRange(partial);
    expect(screen.getByText("한강사")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /한강사/ })).toBeNull();
  });

  it("오늘을 요약하면 진행 중임을 먼저 말한다", () => {
    renderRecap(true);
    expect(screen.getByText(/오늘은 아직 진행 중입니다/)).toBeTruthy();
  });

  it("여러 날이면 날짜별 블록으로 나누고, 빈 날은 블록 대신 한 줄로 밝힌다", () => {
    renderRange(mondayRecap);
    // 수업이 있던 날만 블록 — 날짜 제목이 근거다.
    expect(screen.getByRole("heading", { name: "2026년 8월 21일 (금)" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "2026년 8월 22일 (토)" })).toBeNull();
    // 휴원일·수업 없는 날은 사라지지 않고 한 줄로 남는다("안 봤다"와 "볼 게 없었다"의 구분).
    expect(screen.getByText(/2026년 8월 22일 \(토\) 휴원일\(광복절\)/)).toBeTruthy();
    expect(screen.getByText(/2026년 8월 23일 \(일\) 수업 없음/)).toBeTruthy();
  });
});
