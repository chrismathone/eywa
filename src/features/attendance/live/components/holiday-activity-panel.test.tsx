import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/embed-link", () => ({
  EmbedLink: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import type { ScopedHolidayActivity } from "@/features/attendance/server/holiday-activity";
import { HolidayActivityPanel } from "./holiday-activity-panel";

/** 휴원일 읽기 전용 목록(2026-10-03 합의 A01) — 분모 없음 · 사무실만 일별 링크 · 강사는 월별 경로. */
const activity = (over: Partial<ScopedHolidayActivity> = {}): ScopedHolidayActivity => ({
  date: "2026-10-03",
  students: 2,
  classes: 1,
  cells: 3,
  reservations: 1,
  excludedTestCells: 0,
  officeScope: true,
  rows: [
    {
      classId: "eng-a",
      className: "Bridge A",
      subject: "english",
      students: [
        { studentId: "s1", name: "김가람", statuses: ["present", "late"] },
        { studentId: "s2", name: null, statuses: ["absent"] },
      ],
      reservations: [{ id: "m1", studentId: "s3", name: "박다온", slotStart: "10:00", slotEnd: "11:00" }],
    },
  ],
  ...over,
});
const labelOf = (k: string) => (k === "english" ? "영어" : k);
const render = (a: ScopedHolidayActivity | null, lang: "ko" | "en" = "ko") =>
  renderToStaticMarkup(<HolidayActivityPanel activity={a} date="2026-10-03" lang={lang} labelOf={labelOf} />);
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("휴원일 읽기 전용 목록", () => {
  it("입력된 학생 수·반 수·보강 예약 건수와 반별 목록 — 분모·완료율이 없다", () => {
    const t = text(render(activity()));
    expect(t).toContain("이 날 입력된 기록 (읽기 전용)");
    expect(t).toContain("입력된 출결 2명 · 1개 반 · 보강 예약 1건 · 학원 전체");
    expect(t).toContain("Bridge A");
    expect(t).toContain("영어 · 2명");
    // 상태는 한글 라벨로(영문 코드가 새지 않는다), 이름을 못 찾은 학생은 id 대신 안내 문구.
    expect(t).toContain("김가람(출석·지각)");
    expect(t).toContain("이름 없음(결석)");
    expect(t).not.toMatch(/present|absent|late|s2/);
    expect(t).toContain("보강 예약 박다온 10:00~11:00");
    expect(t).not.toMatch(/\d+\/\d+|%|완료|미처리|미입력/);
  });

  it("🔴 사무실 범위에만 일별 출석부 링크가 선다", () => {
    const html = render(activity());
    expect(html).toContain('href="/attendance/2026-10-03"');
    expect(html).not.toContain('href="/attendance?month=2026-10"');
  });

  it("🔴 강사 범위에는 일별 출석부 링크가 없고 월별 출석부로 간다", () => {
    const html = render(activity({ officeScope: false }));
    expect(html).not.toContain("/attendance/2026-10-03");
    expect(html).toContain('href="/attendance?month=2026-10"');
    expect(text(html)).toContain("내 수업");
  });

  it("입력·수정 조작이 없다(읽기 전용)", () => {
    const html = render(activity());
    expect(html).not.toMatch(/<button|<input|<form|<select/);
  });

  it("테스트 학생을 뺀 칸 수가 있으면 일별 출석부와의 차이를 문구로 밝힌다(사무실 범위)", () => {
    expect(text(render(activity({ excludedTestCells: 2 })))).toContain(
      "테스트 학생 기록 2칸은 세지 않았습니다. 일별 출석부에는 함께 보입니다.",
    );
    expect(text(render(activity({ excludedTestCells: 0 })))).not.toContain("테스트 학생");
    // 강사 범위엔 일별 링크가 없으니 그 비교 문구도 없다.
    expect(text(render(activity({ excludedTestCells: 2, officeScope: false })))).not.toContain("테스트 학생");
  });

  it("기록도 예약도 없으면 아무것도 그리지 않는다(종전 휴원일 화면 그대로)", () => {
    expect(render(activity({ students: 0, classes: 0, cells: 0, reservations: 0, rows: [] }))).toBe("");
  });

  it("조회 실패(null)는 0건이 아니라 못 불러왔다고 적는다", () => {
    const t = text(render(null));
    expect(t).toContain("이 날 입력된 출결을 불러오지 못했습니다");
    expect(t).not.toContain("0명");
  });

  it("예약만 있는 반도 선다 — 그 반의 다른 학생을 미입력으로 세우지 않는다", () => {
    const t = text(
      render(
        activity({
          students: 0,
          classes: 0,
          cells: 0,
          rows: [
            {
              classId: "sat",
              className: "보강 전용",
              subject: "math",
              students: [],
              reservations: [{ id: "m1", studentId: "s3", name: "박다온", slotStart: "10:00", slotEnd: "11:00" }],
            },
          ],
        }),
      ),
    );
    expect(t).toContain("입력된 출결 0명 · 0개 반 · 보강 예약 1건");
    expect(t).toContain("보강 전용");
    expect(t).not.toContain("미입력");
  });

  it("영어 화면", () => {
    const t = text(render(activity({ officeScope: false }), "en"));
    expect(t).toContain("Recorded on this day (read-only)");
    expect(t).toContain("2 students recorded · 1 classes · 1 makeup bookings · my classes");
    expect(t).toContain("김가람(Present·Late)");
    expect(t).toContain("Open monthly sheet");
  });
});
