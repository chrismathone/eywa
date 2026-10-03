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

import { AttendanceHub, type HubHoliday, type HubTeacher } from "./attendance-hub";

/**
 * 출석부 요약의 오늘 줄 — 평일은 종전 그대로, 학원설정 휴원일은 분모 없이 실제 입력만(2026-10-03 합의 A01).
 */
const teacher = (today: HubTeacher["today"]): HubTeacher => ({
  id: "t1",
  name: "김선생",
  retired: false,
  classCount: 3,
  subjects: ["math"],
  today,
});

function hub(opts: { teachers: HubTeacher[]; holiday?: HubHoliday | null; lang?: "ko" | "en" }) {
  return renderToStaticMarkup(
    <AttendanceHub
      teachers={opts.teachers}
      seats={[]}
      month="2026-10"
      subjectId={null}
      colorOf={() => "blue"}
      labelOf={(k) => (k === "math" ? "수학" : k)}
      todayLabel="10월 3일 (토)"
      lang={opts.lang ?? "ko"}
      holiday={opts.holiday}
    />,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("평일 — 종전 표기 그대로", () => {
  it("수업 N개 반 · 출결 입력 a/b명 · 완료 c개 반, 강사 줄에 a/b", () => {
    const html = hub({ teachers: [teacher({ classes: 2, doneClasses: 1, expected: 22, recorded: 5 })] });
    const t = text(html);
    expect(t).toContain("10월 3일 (토) — 수업 2개 반 · 출결 입력 5/22명 · 완료 1개 반");
    expect(t).toContain("3개 반 · 오늘 5/22명 입력");
    expect(html).not.toContain("data-hub-holiday");
  });

  it("오늘 수업이 없으면 종전 문구", () => {
    expect(text(hub({ teachers: [teacher(null)] }))).toContain("10월 3일 (토) — 오늘 예정된 수업이 없습니다");
  });
});

describe("학원설정 휴원일", () => {
  it("🔴 기록이 있는 휴원일 = 휴일 이름과 입력된 학생 수·반 수만 — 분모·완료가 없다", () => {
    const html = hub({
      teachers: [teacher(null)],
      holiday: { name: "개천절", activity: { students: 5, classes: 2, reservations: 0 } },
    });
    const t = text(html);
    expect(t).toContain("10월 3일 (토) — 개천절 휴원일 · 입력된 출결 5명 · 2개 반");
    expect(t).not.toMatch(/\d+\/\d+/); // a/b 꼴 없음(5/22 · 5/0)
    expect(t).not.toContain("완료");
    expect(t).not.toContain("%");
    expect(t).not.toContain("예정된 수업이 없습니다");
  });

  it("기록이 없는 휴원일 = '수업 없음'이 아니라 휴원일이라고 말한다", () => {
    const t = text(
      hub({ teachers: [teacher(null)], holiday: { name: "추석", activity: { students: 0, classes: 0, reservations: 0 } } }),
    );
    expect(t).toContain("10월 3일 (토) — 추석 휴원일 · 입력된 출결 없음");
    expect(t).not.toContain("예정된 수업이 없습니다");
    expect(t).not.toMatch(/\d+\/\d+/);
  });

  it("보강 예약만 있어도 그 건수를 적는다(정규 교시 없는 보강)", () => {
    const t = text(
      hub({ teachers: [teacher(null)], holiday: { name: "개천절", activity: { students: 0, classes: 0, reservations: 3 } } }),
    );
    expect(t).toContain("개천절 휴원일 · 보강 예약 3건");
    expect(t).not.toContain("입력된 출결 없음");
  });

  it("입력 현황 조회 실패 = 0명이 아니라 못 불러왔다고 적는다", () => {
    const t = text(hub({ teachers: [teacher(null)], holiday: { name: "개천절", activity: null } }));
    expect(t).toContain("개천절 휴원일 · 입력 현황을 불러오지 못했습니다");
    expect(t).not.toContain("0명");
  });

  it("휴원일엔 강사 줄에도 a/b를 그리지 않는다(재료가 남아 있어도)", () => {
    const t = text(
      hub({
        teachers: [teacher({ classes: 2, doneClasses: 0, expected: 22, recorded: 5 })],
        holiday: { name: "개천절", activity: { students: 5, classes: 2, reservations: 0 } },
      }),
    );
    expect(t).not.toContain("5/22");
    expect(t).not.toContain("명 입력");
  });

  it("영어 화면도 같은 사실을 영어로 적는다", () => {
    const t = text(
      hub({
        teachers: [teacher(null)],
        lang: "en",
        holiday: { name: "개천절", activity: { students: 5, classes: 2, reservations: 1 } },
      }),
    );
    expect(t).toContain("(academy closed) · 5 students recorded · 2 classes · 1 makeup bookings");
    expect(t).not.toMatch(/\d+\/\d+/);
  });
});
