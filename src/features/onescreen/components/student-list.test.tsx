import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentList } from "./student-list";
import type { OneScreenStudent } from "../types";

afterEach(cleanup);

const subject = (over: Partial<OneScreenStudent["subjects"][number]> = {}) => ({
  name: "수학",
  prev: "",
  today: "p.10",
  className: null as string | null,
  ...over,
});

const student = (over: Partial<OneScreenStudent>): OneScreenStudent =>
  ({
    id: over.id ?? "s1",
    name: over.name ?? "학생",
    grade: "중3",
    tag: "중3",
    attendance: "출석",
    subjects: over.subjects ?? [subject()],
    tests: { daily: { score: null, max: 20, prevScore: null }, check: { score: null, max: 20, prevScore: null } },
    attitude: null,
    homework: "—",
    progressConfirmed: false,
    reportDraft: "", // studentStatus가 .trim() 하므로 필수(없으면 렌더 자체가 터진다)
    reportSent: false,
    ...over,
  }) as OneScreenStudent;

/** 이름 옆 발송 표시 배지(title로 식별) — 없으면 null. */
function sendBadge(name: string): HTMLElement | null {
  const row = screen.getByText(name).closest("button");
  return row?.querySelector<HTMLElement>('[title*="발송"], [title*="저장"]') ?? null;
}

describe("StudentList 이름 옆 발송 표시", () => {
  const students = [
    student({ id: "a", name: "최주원" }),
    student({ id: "b", name: "안서준", subjects: [subject({ name: "수학" }), subject({ name: "영어" })] }),
    student({ id: "c", name: "이도훈" }),
  ];
  const marks = {
    a: { sent: 1, total: 1, label: "학부모 발송" },
    b: { sent: 1, total: 2, label: "학부모 발송" },
    c: { sent: 0, total: 1, label: "학부모 발송" },
  };

  it("전부 나간 학생만 숫자 없는 체크(완료 표시)", () => {
    render(<StudentList students={students} selId="a" onSelect={vi.fn()} sendMarkById={marks} />);
    const badge = sendBadge("최주원");
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("title")).toBe("학부모 발송 1/1");
    expect(badge!.textContent).toBe(""); // 완료는 체크만(숫자 없음)
  });

  it("일부만 나갔으면 남은 수를 숫자로 밝힌다(N/M)", () => {
    render(<StudentList students={students} selId="a" onSelect={vi.fn()} sendMarkById={marks} />);
    const badge = sendBadge("안서준");
    expect(badge?.textContent).toBe("1/2");
    expect(badge?.getAttribute("title")).toBe("학부모 발송 1/2");
  });

  it("🔴 하나도 안 나갔으면 아무 표시도 없다 — 없음=미발송(거짓 안심 금지)", () => {
    render(<StudentList students={students} selId="a" onSelect={vi.fn()} sendMarkById={marks} />);
    expect(sendBadge("이도훈")).toBeNull();
  });

  it("표시 재료가 없으면(구경로) 배지 없이 그대로 렌더", () => {
    render(<StudentList students={students} selId="a" onSelect={vi.fn()} />);
    expect(sendBadge("최주원")).toBeNull();
  });

  it("기준이 '보고서 저장'인 학원은 툴팁이 그 사실을 밝힌다", () => {
    render(
      <StudentList
        students={students}
        selId="a"
        onSelect={vi.fn()}
        sendMarkById={{ a: { sent: 1, total: 1, label: "보고서 저장" } }}
      />,
    );
    expect(sendBadge("최주원")?.getAttribute("title")).toBe("보고서 저장 1/1");
  });
});

describe("StudentList 빈 목록 문구", () => {
  it("기본은 반 문구", () => {
    render(<StudentList students={[]} selId="" onSelect={vi.fn()} />);
    expect(screen.getByText("해당 반 학생이 없습니다")).toBeTruthy();
  });

  it("작성 필터로 비었을 때는 호출부 문구로 바뀐다(반 탓 거짓말 방지)", () => {
    render(
      <StudentList students={[]} selId="" onSelect={vi.fn()} emptyLabel="미작성 학생이 없습니다" />,
    );
    expect(screen.getByText("미작성 학생이 없습니다")).toBeTruthy();
    expect(screen.queryByText("해당 반 학생이 없습니다")).toBeNull();
  });
});
