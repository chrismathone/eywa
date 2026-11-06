import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { tipText } from "@/components/hover-tip/tip";
import type { ListItem, ReportFlow } from "@/features/withdrawal-reports/list-items";
import { ReportList } from "./report-list";

// 새 창 링크(WindowLink)는 창 저장소를 쓰므로 표시만 남긴 가짜로 — 어느 꼬리가 새 창인지 가린다.
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, title, className, children }: { href: string; title?: string; className?: string; children?: React.ReactNode }) => (
    <a href={href} title={title} className={className} data-window-link="">
      {children}
    </a>
  ),
}));

const flow = (over: Partial<ReportFlow> = {}): ReportFlow => ({
  status: "manager_pending", othersPending: false, effectiveDate: "2026-11-20", appliedAt: null, updatedAt: "2026-11-04T16:30:00Z", canCancel: false, ...over,
});
const item = (over: Partial<ListItem>): ListItem => ({
  key: "r:1", href: "/withdrawal-reports/1", name: "김학생", schoolGrade: "경명여중1", detail: "퇴원 · 수학", subjectText: "수학", kindText: "퇴원", kind: "withdrawal", classText: "", requestedAt: "2026-10-08T00:00:00Z", mine: "none", date: "2026-10-10", dateText: "2026-10-10", requestedText: "2026-10-08",
  teacher: "이성우", reason: { text: "이사", note: null }, subjects: ["math"], status: "pending", statusLabel: "관리자 요청",
  approval: [{ text: "관리자 ○ 관리자" }], link: null, myTurn: false, search: "", flow: flow(),
  ...over,
});
/** 그 학생 줄의 상태 칸(마지막 칸). */
const statusTd = (name: string) => screen.getByRole("link", { name }).closest("tr")!.querySelectorAll("td")[9] as HTMLElement;
const statusCell = (name: string) => within(statusTd(name));
/** 붙는 공백(nbsp)을 보통 공백으로 — 아래 한 줄은 '·' 뒤에서만 접히게 '·' 앞을 nbsp로 둔다. */
const plain = (s: string | null | undefined) => (s ?? "").replace(/\u00a0/g, " ");
/** 아래 한 줄의 추가 정보 조각(글 전체로 찾는다 — 화면은 '·'마다 줄바꿈 없는 조각으로 나눠 그린다). */
const noteOf = (name: string, text: string) => [...statusTd(name).querySelectorAll<HTMLElement>("[data-note]")].find((n) => plain(n.textContent) === text);

describe("퇴원보고서 목록 표 — 웹 보고서와 기존 기록 한 표(원장 2026-10-14)", () => {
  afterEach(cleanup);
  it("기존 기록은 원문 화면으로 열리고 상태 칸은 막대 없이 '스프레드시트 기록'", () => {
    render(
      <ReportList
        items={[
          item({ myTurn: true, flow: flow({ status: "requested" }) }),
          item({ key: "a:9", href: "/withdrawal-reports/archive/9", name: "박원생", status: "archive", statusLabel: "스프레드시트 기록", link: "manual", approval: [{ text: "원본 · 9월 퇴원", muted: true }], flow: undefined }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "박원생" })).toHaveAttribute("href", "/withdrawal-reports/archive/9");
    expect(screen.queryByText("학생 연결 필요")).not.toBeInTheDocument();
    expect(screen.getByText("원본 · 9월 퇴원")).toBeInTheDocument();
    const archive = statusCell("박원생");
    expect(archive.getByText("스프레드시트 기록")).toBeInTheDocument();
    expect(archive.getByText("직접 연결")).toBeInTheDocument();
    expect(archive.queryByRole("img")).not.toBeInTheDocument();
    expect(statusCell("김학생").getByRole("link", { name: "내 작성 대기" })).toHaveAttribute("href", "/withdrawal-reports/1");
  });
  it("퇴원 사유 칸 — 우리 사유, '기타'는 아래에 설명(전체는 메모 카드)", () => {
    render(
      <ReportList
        items={[
          item({ key: "r:1" }),
          item({ key: "a:2", name: "박원생", reason: { text: "기타", note: "학습태도 불량 / 금전적인 문제(집안사정)" } }),
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "퇴원 사유" })).toBeInTheDocument();
    // 원장 2026-10-29 — 요청일 열(날짜 열 왼쪽) · 이름 옆 학교학년 / 2026-11-03 — 이름: '퇴원요청일' · '마지막 수업일'
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.indexOf("퇴원요청일")).toBe(heads.indexOf("마지막 수업일") - 1);
    expect(heads).not.toContain("요청일");
    expect(heads).not.toContain("퇴원·종료일");
    expect(screen.getByText("이사")).toBeInTheDocument();
    expect(screen.getByText("기타")).toBeInTheDocument();
    const note = screen.getByText("학습태도 불량 / 금전적인 문제(집안사정)");
    expect(note).not.toHaveAttribute("title");
    expect(tipText(note.getAttribute("data-tip"))).toContain("학습태도 불량 / 금전적인 문제(집안사정)");
  });
  it("없으면 빈 안내", () => {
    render(<ReportList items={[]} />);
    expect(screen.getByText("해당하는 퇴원보고서가 없습니다.")).toBeInTheDocument();
  });
});

describe("상태 칸 = 3단계 막대 + 아래 한 줄(원장 2026-11-06 시안 A)", () => {
  afterEach(cleanup);
  it("막대는 이름 있는 그림 · 칸과 단계 이름이 같은 상태 · 막대와 겹치는 '관리자 요청'은 쓰지 않는다 · 칩·버튼 없음", () => {
    render(<ReportList items={[item({ mine: "view" })]} />);
    const cell = statusCell("김학생");
    const bar = cell.getByRole("img", { name: "진행 2/3단계 · 관리자 승인" });
    expect([...bar.children].map((c) => c.getAttribute("data-cell"))).toEqual(["done", "now", "todo"]);
    expect(cell.getByText("강사 작성")).toHaveAttribute("data-state", "done");
    expect(cell.getByText("관리자 승인")).toHaveAttribute("data-state", "now");
    expect(cell.getByText("관리자 승인")).toHaveClass("font-bold");
    expect(cell.getByText("처리 완료")).toHaveAttribute("data-state", "todo");
    expect(cell.getByText("승인 대상 아님")).toBeInTheDocument();
    expect(cell.queryByRole("link")).not.toBeInTheDocument(); // 할 일 없는 열람은 링크가 아니다
    expect(cell.queryByText(/관리자 요청|작성 요청|열람 · 승인 대상 아님/)).not.toBeInTheDocument();
    expect(cell.queryByText("내 승인 필요")).not.toBeInTheDocument();
  });
  it("내 할 일은 줄 끝의 진짜 링크 — 승인 · 환불(데스크 화면이 있으면 그곳) · 재요청 · 위쪽 진한 버튼과 statusLabel 줄은 없다", () => {
    render(
      <ReportList
        items={[
          item({ key: "r:1", name: "가학생", mine: "approve", statusLabel: "관리자 요청" }),
          item({ key: "r:2", name: "나학생", href: "/withdrawal-reports/2", mine: "approve", deskTurn: true, refundStage: "desk", deskHref: "/billing/refunds/d1", flow: flow({ status: "approved" }), statusLabel: "관리자 승인 완료 · 데스크 환불 요청" }),
          item({ key: "r:3", name: "다학생", href: "/withdrawal-reports/3", flow: flow({ status: "blocked", canCancel: true }) }),
        ]}
      />,
    );
    const approve = statusCell("가학생");
    expect(approve.getByRole("link", { name: "내 승인 필요" })).toHaveAttribute("href", "/withdrawal-reports/1");
    expect(approve.getByRole("link", { name: "내 승인 필요" })).toHaveClass("text-primary", "font-bold", "hover:underline");
    expect(approve.queryByText("관리자 요청")).not.toBeInTheDocument();
    const desk = statusCell("나학생");
    expect(desk.getByRole("img")).toHaveAccessibleName("진행 3/3단계 · 처리 완료 — 데스크 환불 대기");
    expect(desk.getByText("데스크 환불 대기")).toBeInTheDocument();
    // 환불 요청서는 수납 메뉴 — 새 창 링크(WindowLink) · 보고서 상세로 가는 꼬리는 같은 창(EmbedLink)
    const deskLink = desk.getByRole("link", { name: "내 환불 처리 필요" });
    expect(deskLink).toHaveAttribute("href", "/billing/refunds/d1");
    expect(deskLink).toHaveAttribute("data-window-link");
    expect(deskLink).toHaveAttribute("title", "환불 요청서");
    expect(deskLink).toHaveClass("text-primary", "font-bold", "whitespace-nowrap", "hover:underline");
    expect(approve.getByRole("link", { name: "내 승인 필요" })).not.toHaveAttribute("data-window-link");
    expect(desk.queryByText("관리자 승인 완료 · 데스크 환불 요청")).not.toBeInTheDocument();
    const blocked = statusCell("다학생");
    expect(noteOf("다학생", "수강 변경 · 재검토 필요 — 취소 후 다시 요청")).toHaveClass("text-destructive");
    expect(blocked.getByRole("link", { name: "내 재요청 필요" })).toHaveAttribute("href", "/withdrawal-reports/3");
    expect([...blocked.getByRole("img").children].map((c) => c.getAttribute("data-cell"))).toEqual(["done", "done", "alert"]);
  });
  it("반려는 지금 칸이 빨강 · '반려 · 수정 요청' 빨강 · 작성자는 '내 작성 대기' 링크", () => {
    render(<ReportList items={[item({ myTurn: true, flow: flow({ status: "revision" }) })]} />);
    const cell = statusCell("김학생");
    expect(cell.getByRole("img")).toHaveAccessibleName("진행 1/3단계 · 강사 작성 — 반려 · 수정 요청");
    expect(cell.getByText("강사 작성")).toHaveClass("text-destructive", "font-bold");
    expect(noteOf("김학생", "반려 · 수정 요청")).toHaveClass("text-destructive");
    expect(cell.getByRole("link", { name: "내 작성 대기" })).toBeInTheDocument();
  });
  it("처리 완료 = 세 칸 채움 · '처리 완료'만 굵게 · 처리일 초록 · 꼬리 없음", () => {
    render(<ReportList items={[item({ status: "completed", mine: "none", flow: flow({ status: "completed", appliedAt: "2026-11-05T01:00:00Z" }) })]} />);
    const cell = statusCell("김학생");
    expect([...cell.getByRole("img").children].map((c) => c.getAttribute("data-cell"))).toEqual(["done", "done", "done"]);
    expect(cell.getByText("처리 완료")).toHaveClass("font-bold");
    expect(cell.getByText("관리자 승인")).not.toHaveClass("font-bold");
    expect(noteOf("김학생", "처리일 11-05")).toHaveClass("text-att-present-ink", "font-semibold");
    expect(cell.queryByRole("link")).not.toBeInTheDocument();
  });
  it("요청 취소 = 옅은 회색 · 이름 취소선 · 취소 기록이 없으면 말풍선 없이 글만", () => {
    render(<ReportList items={[item({ status: "canceled", flow: flow({ status: "canceled", updatedAt: "2026-11-05T02:00:00Z" }) })]} />);
    const cell = statusCell("김학생");
    expect([...cell.getByRole("img").children].map((c) => c.getAttribute("data-cell"))).toEqual(["off", "off", "off"]);
    expect(cell.getByText("강사 작성")).toHaveClass("line-through");
    const note = noteOf("김학생", "요청 취소 · 취소일 11-05")!;
    expect(note).toBeInTheDocument();
    expect(note.querySelector("[tabindex]")).toBeNull();
    expect(note.querySelector(".decoration-dotted")).toBeNull();
  });
  it("요청 취소 기록이 있으면 점선 밑줄 · 마우스·키보드 초점에 말풍선(취소 사유 · 사람 · 시각)", async () => {
    render(<ReportList items={[item({ status: "canceled", flow: flow({ status: "canceled" }), cancel: { reason: null, by: "김원장 원장", at: "2026-11-05T05:20:00Z" } })]} />);
    const trigger = noteOf("김학생", "요청 취소 · 취소일 11-05")!.querySelector<HTMLElement>("[tabindex]")!;
    expect(plain(trigger.textContent)).toBe("요청 취소 · 취소일 11-05");
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveClass("decoration-dotted", "cursor-help");
    expect(screen.queryByText("취소 사유")).not.toBeInTheDocument();
    await act(async () => {
      trigger.focus();
      fireEvent.focus(trigger);
    });
    expect(await screen.findByText("취소 사유")).toBeInTheDocument();
    expect(screen.getByText("사유 기록 없음(이전 취소)")).toBeInTheDocument();
    expect(screen.getByText("김원장 원장 · 11-05 14:20")).toBeInTheDocument();
  });
  it("아래 한 줄은 막대 폭 안에서 '·' 뒤로만 접힌다 — 조각·꼬리 링크는 줄바꿈 없이 · 상태 칸을 넓히지 않는다(리뷰 2026-11-06)", () => {
    render(<ReportList items={[item({ name: "다학생", mine: "view", flow: flow({ status: "blocked", canCancel: true }) })]} />);
    const td = statusTd("다학생");
    // 막대·단계 이름·아래 한 줄이 한 상자(w-64 = 막대 폭) 안 — 아래 한 줄은 줄바꿈을 막지 않고(break-keep) 넓히지 않는다
    const box = td.firstElementChild as HTMLElement;
    expect(box).toHaveClass("w-64");
    const line = td.querySelector<HTMLElement>("[data-line]")!;
    expect(box).toContainElement(line);
    expect(line).toHaveClass("break-keep");
    expect(line).not.toHaveClass("whitespace-nowrap");
    // 조각은 줄바꿈 없이 · '·' 앞은 붙는 공백(nbsp)이라 '·'는 앞 줄 끝에 남는다
    const note = noteOf("다학생", "수강 변경 · 재검토 필요 — 취소 후 다시 요청")!;
    expect([...note.querySelectorAll(".whitespace-nowrap")].map((p) => p.textContent)).toEqual(["수강 변경", "재검토 필요 — 취소 후 다시 요청"]);
    expect(note.textContent).toBe("수강 변경\u00a0· 재검토 필요 — 취소 후 다시 요청");
    expect(line.textContent).toBe("수강 변경\u00a0· 재검토 필요 — 취소 후 다시 요청\u00a0· 내 재요청 필요");
    expect(statusCell("다학생").getByRole("link", { name: "내 재요청 필요" })).toHaveClass("whitespace-nowrap");
  });
  it("할 일 없는 열람의 꼬리도 한 덩어리", () => {
    render(<ReportList items={[item({ mine: "view", flow: flow({ status: "approved", othersPending: true }) })]} />);
    expect(statusCell("김학생").getByText("승인 대상 아님")).toHaveClass("whitespace-nowrap");
    expect(plain(statusTd("김학생").querySelector("[data-line]")!.textContent)).toBe("다른 과목 승인 대기 · 승인 대상 아님");
  });
  it("데스크 화면 주소가 없으면 '내 환불 처리 필요'는 보고서 상세로(같은 창)", () => {
    render(<ReportList items={[item({ mine: "approve", deskTurn: true, refundStage: "desk", flow: flow({ status: "approved" }) })]} />);
    const link = statusCell("김학생").getByRole("link", { name: "내 환불 처리 필요" });
    expect(link).toHaveAttribute("href", "/withdrawal-reports/1");
    expect(link).not.toHaveAttribute("data-window-link");
  });
  it("2과목 묶음에서 먼저 승인된 과목 — 2단계 · '다른 과목 승인 대기 · 데스크 환불 대기'(리뷰 2026-11-06)", () => {
    render(<ReportList items={[item({ mine: "view", refundStage: "desk", flow: flow({ status: "approved", othersPending: true }) })]} />);
    const cell = statusCell("김학생");
    expect(cell.getByRole("img")).toHaveAccessibleName("진행 2/3단계 · 관리자 승인 — 다른 과목 승인 대기 · 데스크 환불 대기");
    expect(plain(statusTd("김학생").querySelector("[data-line]")!.textContent)).toBe("다른 과목 승인 대기 · 데스크 환불 대기 · 승인 대상 아님");
  });
});
