import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { decodeTip } from "@/components/hover-tip/tip";
import { parseConsultationRating, type ConsultationRating } from "@/features/consultation-rating/rating";
import { ConsultationRatingCell } from "./consultation-rating-cell";
import { ConsultationRatingPanel } from "./consultation-rating-panel";

afterEach(cleanup);

const rating = (over: Partial<ConsultationRating> = {}): ConsultationRating => ({
  points: 4, reason: "일정 안내가 구체적", evidence: "2학년 1학기 심화 내용으로", kinds: ["schedule", "academic"], missing: ["response"], rule: null, basis: "memo", ratedOn: "2026-11-11", ...over,
});

describe("원생상담 목록 '상담 평점' 칸", () => {
  it("평점이 없으면 '—'(아직 안 매겼다) — 근거 카드도 없다", () => {
    const { container } = render(<ConsultationRatingCell rating={null} />);
    expect(container.textContent).toBe("—");
    expect(container.querySelector("[data-tip]")).toBeNull();
  });

  it("숫자 + 근거는 카드로(title 겹침 없음) — 1점이어도 주의색을 칠하지 않는다", () => {
    const { container, rerender } = render(<ConsultationRatingCell rating={rating()} />);
    expect(screen.getByText("4")).toBeTruthy();
    expect(container.querySelector("[title]:not([title=''])")).toBeNull(); // 근거는 카드로만 — 빈 title은 행 툴팁이 카드와 겹치지 않게 막는 것이다
    expect(container.querySelector("[data-tip]")!.getAttribute("title")).toBe("");
    rerender(<ConsultationRatingCell rating={rating({ points: 1 })} />);
    expect(screen.getByText("1").className).not.toMatch(/amber|danger|caution|warning/);
  });

  it("카드 = 이유 · 인용 · 한글 사유 · '기록에 없음'(실제로 하지 않았다는 뜻이 아니라고 적는다) — raw 코드가 새지 않는다", () => {
    const { container } = render(<ConsultationRatingCell rating={rating()} />);
    const card = decodeTip(container.querySelector("[data-tip]")!.getAttribute("data-tip"))!;
    const rows = Object.fromEntries(card.rows ?? []);
    expect(rows["이유"]).toBe("일정 안내가 구체적");
    expect(rows["기록에서"]).toBe("“2학년 1학기 심화 내용으로”");
    expect(rows["상담 사유"]).toBe("반·일정 안내 · 학습·성적");
    expect(rows["기록에 없음"]).toContain("상대 반응·요청");
    expect(rows["기록에 없음"]).toContain("실제로 하지 않았다는 뜻은 아닙니다");
    expect(JSON.stringify(card)).not.toMatch(/schedule|academic|response|not_recorded/);
  });

  it("코드 규칙·녹음 전사 기준은 카드에 까닭을 적는다", () => {
    const { container } = render(<ConsultationRatingCell rating={rating({ points: 3, rule: "copied", basis: "recording" })} />);
    const card = decodeTip(container.querySelector("[data-tip]")!.getAttribute("data-tip"))!;
    expect(Object.fromEntries(card.rows ?? [])["규칙"]).toContain("같은 글이 여러 학생에게");
    expect((card.lines ?? []).join("\n")).toContain("녹음 전사 기준");
  });

  it("상세 패널은 같은 재료를 펼친다", () => {
    render(<ConsultationRatingPanel rating={rating()} />);
    expect(screen.getByText("상담 평점")).toBeTruthy();
    expect(screen.getByText("일정 안내가 구체적")).toBeTruthy();
  });
});

describe("표 행 → 화면 값", () => {
  const row = { consultation_id: "c", points: 3, reason: "r", evidence: "e", kinds: ["schedule", "엉뚱"], checks: { reason: "present", next: "not_recorded", response: "not_recorded", context: "unclear" }, rule: null, basis: "recording", rated_on: "2026-11-11" };
  it("1~5 숫자가 아니면 보이지 않는다", () => {
    for (const points of [0, 6, "x", null]) expect(parseConsultationRating({ ...row, points })).toBeNull();
    expect(parseConsultationRating({ ...row, points: "3" })?.points).toBe(3);
  });
  it("모르는 태그는 버리고, 기록에 없는 칸만 모은다", () => {
    expect(parseConsultationRating(row)).toMatchObject({ kinds: ["schedule"], missing: ["response", "next"], basis: "recording" });
    expect(parseConsultationRating({ ...row, checks: null, kinds: null })).toMatchObject({ kinds: [], missing: [] });
  });
});
