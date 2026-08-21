import { describe, expect, it } from "vitest";
import { answerHasTable, parseAnswerBlocks, parseInlineSegments, splitRow } from "./rich-answer";

describe("parseAnswerBlocks — 표", () => {
  it("실측 모양(2026-08-20 '오늘 출결')의 GFM 파이프 표를 블록으로", () => {
    const blocks = parseAnswerBlocks(
      [
        "오늘 출결 현황입니다.",
        "| 반 이름 | 과목 | 예정 | 기록 |",
        "| --- | --- | ---: | :---: |",
        "| 고등M 고1 BS4A | 수학 | 12 | 12 |",
        "| DP5 | 영어 | 8 | 0 |",
        "미처리 반은 담당 강사에게 확인이 필요합니다.",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "paragraph", text: "오늘 출결 현황입니다." },
      {
        kind: "table",
        head: ["반 이름", "과목", "예정", "기록"],
        rows: [
          ["고등M 고1 BS4A", "수학", "12", "12"],
          ["DP5", "영어", "8", "0"],
        ],
      },
      { kind: "paragraph", text: "미처리 반은 담당 강사에게 확인이 필요합니다." },
    ]);
    expect(answerHasTable(blocks)).toBe(true);
  });

  it("구분행이 없으면 표가 아니다(산문 속 파이프를 표로 오인 금지)", () => {
    const blocks = parseAnswerBlocks("A | B 형태로 적혀 있습니다.");
    expect(blocks).toEqual([{ kind: "paragraph", text: "A | B 형태로 적혀 있습니다." }]);
    expect(answerHasTable(blocks)).toBe(false);
  });

  it("칸 수가 모자라거나 넘쳐도 머리행 폭에 맞춘다", () => {
    const blocks = parseAnswerBlocks(
      ["| 이름 | 상태 |", "|---|---|", "| 김민수 |", "| 이서연 | 재원 | 군더더기 |"].join("\n"),
    );
    expect(blocks[0]).toEqual({
      kind: "table",
      head: ["이름", "상태"],
      rows: [
        ["김민수", ""],
        ["이서연", "재원"],
      ],
    });
  });

  it("코드펜스로 감싼 표도 울타리만 버리고 파싱", () => {
    const blocks = parseAnswerBlocks(["```", "| 이름 | 수 |", "|---|---|", "| 김 | 1 |", "```"].join("\n"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("table");
  });
});

describe("parseAnswerBlocks — 목록·헤더·문단", () => {
  it("연속 불릿은 하나의 목록", () => {
    const blocks = parseAnswerBlocks(["- 결석 3명", "- 지각 1명", "확인 부탁드립니다."].join("\n"));
    expect(blocks).toEqual([
      { kind: "list", ordered: false, items: ["결석 3명", "지각 1명"] },
      { kind: "paragraph", text: "확인 부탁드립니다." },
    ]);
  });

  it("번호 목록은 ordered", () => {
    const blocks = parseAnswerBlocks(["1. 첫째", "2) 둘째"].join("\n"));
    expect(blocks).toEqual([{ kind: "list", ordered: true, items: ["첫째", "둘째"] }]);
  });

  it("헤더는 마커만 벗겨 살린다(프롬프트가 금지하지만 새어도 raw `##` 노출 금지)", () => {
    expect(parseAnswerBlocks("## 오늘 요약")).toEqual([{ kind: "heading", text: "오늘 요약" }]);
  });

  it("저장된 옛 평문 답변은 줄마다 문단 그대로(하위호환)", () => {
    const blocks = parseAnswerBlocks("이번 달 수납률은 91.8%입니다.\n\n미납은 4건입니다.");
    expect(blocks).toEqual([
      { kind: "paragraph", text: "이번 달 수납률은 91.8%입니다." },
      { kind: "paragraph", text: "미납은 4건입니다." },
    ]);
  });

  it("빈 문자열은 블록 0개", () => {
    expect(parseAnswerBlocks("   \n\n ")).toEqual([]);
  });
});

describe("splitRow", () => {
  it("양끝 파이프를 벗기고 셀을 다듬는다", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a|b")).toEqual(["a", "b"]);
  });
  it("이스케이프된 파이프는 셀 안 문자", () => {
    expect(splitRow("| a\\|b | c |")).toEqual(["a|b", "c"]);
  });
});

describe("parseInlineSegments", () => {
  it("**강조**를 조각으로 분해(렌더러가 <strong>으로)", () => {
    expect(parseInlineSegments("수납률 **91.8%** 입니다")).toEqual([
      { text: "수납률 ", bold: false },
      { text: "91.8%", bold: true },
      { text: " 입니다", bold: false },
    ]);
  });
  it("강조가 없으면 한 조각", () => {
    expect(parseInlineSegments("평범한 문장")).toEqual([{ text: "평범한 문장", bold: false }]);
  });
});
