import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnswerBody } from "./answer-body";
import { parseAnswerBlocks } from "../rich-answer";
import type { AssistantLink } from "../links";

/**
 * 여기서 잠그는 계약:
 *  ① 표는 **표로** 그려진다 — 파이프 원문이 화면에 남지 않는다(원장 제보 2026-08-20).
 *  ② LLM 출력은 **항상 텍스트** — `<script>`·`<img onerror>`가 엘리먼트가 되지 않는다(XSS 표면 0).
 *  ③ 바로가기 버튼의 href는 **검증된 id로 만든 상세 경로**뿐(모델이 만든 URL 없음).
 *  ④ 옛 평문 답변(파이프 없음)도 그대로 읽힌다(하위호환).
 */
const ID = "11111111-1111-4111-8111-111111111111";

function renderAnswer(text: string, links?: AssistantLink[], omitted = 0) {
  return render(<AnswerBody blocks={parseAnswerBlocks(text)} links={links} omittedLinks={omitted} />);
}

describe("AnswerBody", () => {
  it("파이프 표를 <table>로 그린다(원문 파이프가 화면에 안 남는다)", () => {
    const { container } = renderAnswer(
      ["오늘 출결입니다.", "| 반 이름 | 예정 | 기록 |", "|---|---|---|", "| DP5 | 8 | 0 |"].join("\n"),
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "반 이름" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "DP5" })).toBeTruthy();
    expect(container.textContent).not.toContain("|");
  });

  it("**강조**는 <strong>, 불릿은 <li>", () => {
    const { container } = renderAnswer(["- 결석 **3명**", "- 지각 1명"].join("\n"));
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("3명");
    expect(container.textContent).not.toContain("**");
  });

  it("🔴 LLM이 뱉은 HTML은 텍스트로만 남는다(dangerouslySetInnerHTML 미사용)", () => {
    const { container } = renderAnswer(
      '<script>alert(1)</script> 와 <img src=x onerror="alert(2)"> 를 포함한 답변입니다.',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("🔴 표 셀에 든 HTML도 텍스트", () => {
    const { container } = renderAnswer(
      ["| 이름 | 메모 |", "|---|---|", "| <b>굵게</b> | <img src=x onerror=1> |"].join("\n"),
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("cell", { name: "<b>굵게</b>" })).toBeTruthy();
  });

  it("바로가기 버튼은 검증된 상세 경로로만 이동한다", () => {
    const { container } = renderAnswer("김민수 학생은 결석이 잦습니다.", [
      { kind: "student", id: ID, label: "김민수" },
    ]);
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(`/students/${ID}`);
    expect(link?.textContent).toContain("김민수");
    expect(link?.textContent).toContain("학생"); // 종류 라벨
  });

  it("상한을 넘긴 대상 수를 밝힌다(붙인 게 전부인 척 금지)", () => {
    renderAnswer("여러 학생이 있습니다.", [{ kind: "student", id: ID, label: "김민수" }], 5);
    expect(screen.getByText(/외 5건/)).toBeTruthy();
  });

  it("링크가 없으면 버튼 영역 자체가 없다", () => {
    const { container } = renderAnswer("특이사항 없습니다.");
    expect(container.querySelector("a")).toBeNull();
  });

  it("옛 평문 답변도 그대로 문단으로(하위호환)", () => {
    const { container } = renderAnswer("이번 달 수납률은 91.8%입니다.");
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).toBe("이번 달 수납률은 91.8%입니다.");
  });
});
