import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettledReport } from "@/features/assistant/report";
import { ReportView } from "./report-view";

// recharts는 크기를 재야 그린다(테스트 DOM엔 크기가 없다) — 차트 자리는 이름만 남긴다.
vi.mock("./report-chart", () => ({
  ReportChart: ({ block }: { block: { title: string } }) => <div data-testid="chart">{`차트:${block.title}`}</div>,
}));

afterEach(cleanup);

const HOSTILE = '<img src=x onerror="alert(1)"> [눌러 주세요](https://evil.example) **굵게**';

const report: SettledReport = {
  title: "11월 미납 현황",
  blocks: [
    { type: "summary", text: `미납이 지난달보다 늘었습니다.\n${HOSTILE}` },
    {
      type: "kpi",
      items: [
        { label: "미납액", value: 1234000, unit: "원", delta: 120000, deltaLabel: "지난달 대비", goodWhen: "down" },
        { label: "출석률", value: 93.46, unit: "%", delta: 1.2, goodWhen: "up" },
        { label: "담당", value: "김철수" },
      ],
    },
    { type: "chart", kind: "bar", title: "반별 미납액", query: "q1", x: "class", series: [{ column: "amount", label: "미납액" }], unit: "원" },
    {
      type: "table",
      title: "반별 미납",
      query: "q1",
      columns: [
        { column: "class", label: "반" },
        { column: "amount", label: "미납액", format: "won" },
        { column: "memo", label: "메모" },
      ],
      totals: ["amount"],
    },
    { type: "callout", tone: "warn", title: "주의", text: HOSTILE },
    { type: "list", title: "할 일", items: ["3반 학부모 연락", HOSTILE] },
    {
      type: "advice",
      items: [
        { action: "3반 학부모에게 이번 주 안내 문자를 보내세요", why: "3반 미납이 12건으로 다른 반의 두 배입니다", when: "today", who: "원장" },
        { action: "다음 달 청구일을 앞당겨 보세요", why: HOSTILE, when: "watch" },
      ],
    },
    // 화면보다 먼저 나간 새 블록 — 건너뛰고 나머지는 그린다.
    { type: "mystery", text: "?" } as never,
  ],
  datasets: {
    q1: {
      purpose: "반별 미납액",
      truncated: true,
      columns: ["class", "amount", "memo"],
      rows: Array.from({ length: 25 }, (_, i) => ({
        class: `${i + 1}반`,
        amount: (i + 1) * 1000,
        memo: i === 0 ? HOSTILE : i === 1 ? "=HYPERLINK(\"http://x\")" : null,
      })),
    },
  },
};

describe("ReportView", () => {
  it("모든 블록을 그린다 — 제목·요약·KPI·차트·표·주의·목록·비서 의견·근거", () => {
    render(<ReportView report={report} />);
    expect(screen.getByRole("heading", { name: "11월 미납 현황" })).toBeInTheDocument();
    expect(screen.getByText(/미납이 지난달보다 늘었습니다/)).toBeInTheDocument();
    expect(screen.getByText("1,234,000")).toBeInTheDocument();
    expect(screen.getByText("93.5")).toBeInTheDocument();
    expect(screen.getByText("김철수")).toBeInTheDocument();
    expect(screen.getByTestId("chart")).toHaveTextContent("차트:반별 미납액");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "주의: 주의" })).toBeInTheDocument();
    expect(screen.getByText("3반 학부모 연락")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "비서 의견" })).toBeInTheDocument();
    expect(screen.getByText("이렇게 처리하시면 좋겠습니다")).toBeInTheDocument();
    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.getByText("지켜보기")).toBeInTheDocument();
    expect(screen.getByText("담당 · 원장")).toBeInTheDocument();
    expect(screen.getByText("근거", { selector: "summary span" })).toBeInTheDocument();
    expect(screen.queryByText("?")).toBeNull();
  });

  it("🔴 DB·AI 글은 글자로만 — 태그·링크·이미지가 생기지 않는다(강조 표시만 굵기·색)", () => {
    const { container } = render(<ReportView report={report} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    // 같은 글이 요약·주의·목록·비서 의견·표 칸에 그대로 글자로 선다.
    const hostileCount = (container.textContent ?? "").split('<img src=x onerror="alert(1)"> [눌러 주세요](https://evil.example)').length - 1;
    expect(hostileCount).toBeGreaterThanOrEqual(5);
    // 글 칸의 `**굵게**`는 굵게(<strong> — 표시 글자는 사라진다) · 표 칸(DB 값)은 글자 그대로.
    const strong = [...container.querySelectorAll("strong")].map((el) => el.textContent);
    expect(strong.filter((t) => t === "굵게").length).toBe(4);
    const cell = within(screen.getByRole("table")).getByText((_, el) => el?.tagName === "TD" && (el.textContent ?? "").includes("**굵게**"));
    expect(cell.querySelector("strong")).toBeNull();
  });

  it("강조 표시 — 굵게 · 좋음 초록 · 위험 빨강 · 주의 앰버 · 제목·낭독 이름엔 표시가 없다", () => {
    const marked: SettledReport = {
      // 제목은 저장 때 표시를 벗긴 글이다(settleReport) — 화면은 그대로 쓴다.
      title: "퇴원 점검",
      blocks: [
        { type: "summary", text: "최근 3개월 퇴원 **8명** 중 [[bad:불만족 3명]]입니다." },
        { type: "callout", tone: "warn", title: "퇴원 사유 — [[bad:절반]]이 수업", text: "[[good:출석은 **95%**]] · [[warn:지켜볼 반 2곳]]" },
        { type: "advice", items: [{ action: "**BS3B** 담임 면담", why: "6개월 [[bad:**7명**]] 퇴원" }] },
      ],
      datasets: {},
    };
    const { container } = render(<ReportView report={marked} />);
    expect(screen.getByRole("heading", { name: "퇴원 점검" })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "주의: 퇴원 사유 — 절반이 수업" })).toBeInTheDocument();
    expect(screen.getByText("8명").tagName).toBe("STRONG");
    expect(screen.getByText("불만족 3명").className).toContain("text-danger");
    expect(screen.getByText("절반").className).toContain("text-danger");
    expect(screen.getByText("95%")).toMatchObject({ tagName: "STRONG" });
    expect(screen.getByText("95%").className).toContain("text-green");
    expect(screen.getByText("지켜볼 반 2곳").className).toContain("text-amber");
    expect(screen.getByText("7명").className).toContain("text-danger");
    expect(container.textContent).not.toMatch(/\*\*|\[\[/);
  });

  it("비서 의견 — 온 순서대로 번호 · 할 일 · '근거' 줄 · 오늘만 앰버 · 자료 카드와 다른 바탕", () => {
    render(<ReportView report={report} />);
    const card = screen.getByRole("heading", { name: "비서 의견" }).closest("section") as HTMLElement;
    expect(card.className).toContain("bg-gold-soft");
    const items = within(card).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("p")?.textContent)).toEqual(["3반 학부모에게 이번 주 안내 문자를 보내세요", "다음 달 청구일을 앞당겨 보세요"]);
    expect(within(items[0]!).getByText("근거")).toBeInTheDocument();
    expect(within(items[0]!).getByText("3반 미납이 12건으로 다른 반의 두 배입니다")).toBeInTheDocument();
    expect(within(items[0]!).getByText("오늘").className).toContain("text-amber");
    expect(within(items[1]!).getByText("지켜보기").className).not.toContain("text-amber");
  });

  it("KPI 델타 — 미납(내리면 좋음)이 올랐으면 빨강, 출석률(오르면 좋음)이 올랐으면 초록 · %는 %p", () => {
    render(<ReportView report={report} />);
    const up = screen.getByText("120,000원").closest("span.inline-flex");
    expect(up?.className).toContain("text-danger");
    expect(within(up as HTMLElement).getByText("증가")).toBeInTheDocument();
    const good = screen.getByText("1.2%p").closest("span.inline-flex");
    expect(good?.className).toContain("text-green");
    expect(screen.getByText("지난달 대비")).toBeInTheDocument();
  });

  it("표 — 원 서식 · 합계(일부만이면 '받은 N행') · 처음 20행 + 더 보기 · 일부만 표시", () => {
    render(<ReportView report={report} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("1,000원")).toBeInTheDocument();
    expect(within(table).getByText("합계(받은 25행)")).toBeInTheDocument();
    expect(within(table).getByText("325,000원")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 20 + 1); // 머리 + 20행 + 합계
    expect(screen.getByText("· 일부만 받았습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "5행 더 보기" }));
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 25 + 1);
    expect(screen.queryByRole("button", { name: /더 보기/ })).toBeNull();
  });

  it("표 — 머리를 누르면 정렬(금액은 큰 것부터 → 작은 것부터 → 원래 순서)", () => {
    render(<ReportView report={report} />);
    const table = screen.getByRole("table");
    const firstAmount = () => within(within(table).getAllByRole("row")[1]!).getAllByRole("cell")[1]!.textContent;
    const head = within(table).getByRole("button", { name: "미납액" });
    expect(firstAmount()).toBe("1,000원");
    fireEvent.click(head);
    expect(firstAmount()).toBe("25,000원");
    expect(head.closest("th")).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(head);
    expect(firstAmount()).toBe("1,000원");
    expect(head.closest("th")).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(head);
    expect(head.closest("th")).toHaveAttribute("aria-sort", "none");
  });

  it("표 — 엑셀(CSV): BOM · 수식 차단 · 파일 이름", async () => {
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:x";
    });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    render(<ReportView report={report} />);
    const card = screen.getByRole("table").closest("section") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "엑셀(CSV) 내려받기" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(clicks[0]).toMatch(/^학원비서_반별 미납_\d{4}-\d{2}-\d{2}\.csv$/);
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("반,미납액,메모\r\n");
    expect(text).toContain("1반,1000,");
    expect(text).toContain('2반,2000,"\'=HYPERLINK(""http://x"")"');
    click.mockRestore();
  });

  it("차트 — 표로 보기 ↔ 차트로 보기", () => {
    render(<ReportView report={report} />);
    const chartCard = screen.getByTestId("chart").closest("section") as HTMLElement;
    fireEvent.click(within(chartCard).getByRole("button", { name: "표로 보기" }));
    expect(within(chartCard).getByRole("table")).toBeInTheDocument();
    expect(within(chartCard).getByRole("button", { name: "항목" })).toBeInTheDocument();
    fireEvent.click(within(chartCard).getByRole("button", { name: "차트로 보기" }));
    expect(within(chartCard).getByTestId("chart")).toBeInTheDocument();
  });

  it("근거 — 목적·행 수·일부만, SQL은 없다", () => {
    const withSql = { ...report, datasets: { q1: { ...report.datasets.q1!, sql: "select secret from x" } } } as SettledReport;
    const { container } = render(<ReportView report={withSql} />);
    const details = container.querySelector("details:last-of-type") as HTMLElement;
    expect(within(details).getByText("반별 미납액")).toBeInTheDocument();
    expect(within(details).getByText("25행")).toBeInTheDocument();
    expect(within(details).getByText("일부만")).toBeInTheDocument();
    expect(container.textContent).not.toContain("select secret");
  });

  it("가리킨 자료가 없으면 그 카드만 안내", () => {
    render(<ReportView report={{ ...report, blocks: [report.blocks[3]!], datasets: {} }} />);
    expect(screen.getByText("이 자료를 찾지 못했습니다.")).toBeInTheDocument();
  });
});
