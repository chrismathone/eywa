import { describe, expect, it } from "vitest";
import type { ReportBlock, SettledReport } from "@/features/assistant/report";
import {
  EMPTY_CELL,
  OTHER_COLOR,
  axisLabels,
  chartColumnFormat,
  chartPoints,
  columnAlign,
  columnTotals,
  csvFileName,
  dateKey,
  deltaTone,
  effectiveFormat,
  firstSortDir,
  formatAxisTick,
  formatCell,
  formatChartValue,
  formatDate,
  formatDateTime,
  formatDelta,
  formatKpiValue,
  groupBlocks,
  pieSlices,
  reportSources,
  sortRows,
  toCsv,
  toNumber,
} from "./report-format";

describe("toNumber — DB 숫자는 글자로도 온다", () => {
  it("숫자·숫자 글자·쉼표 글자를 받는다", () => {
    expect(toNumber(12)).toBe(12);
    expect(toNumber("12345.00")).toBe(12345);
    expect(toNumber(" 1,234 ")).toBe(1234);
    expect(toNumber("-3.5")).toBe(-3.5);
  });
  it("숫자가 아니면 null — 0으로 지어내지 않는다", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber("12개")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatCell — 칸 서식", () => {
  it("원은 정수 + '원', 숫자는 쉼표, %는 한 자리", () => {
    expect(formatCell(12000, "won")).toBe("12,000원");
    expect(formatCell("12000.4", "won")).toBe("12,000원");
    expect(formatCell(1234567.891, "number")).toBe("1,234,567.89");
    expect(formatCell(12.345, "percent")).toBe("12.3%");
    expect(formatCell(-0, "number")).toBe("0");
  });
  it("빈 값은 —, 0은 0 — 둘을 구별한다", () => {
    expect(formatCell(null, "won")).toBe(EMPTY_CELL);
    expect(formatCell("  ", "text")).toBe(EMPTY_CELL);
    expect(formatCell(0, "won")).toBe("0원");
  });
  it("참·거짓은 예·아니오", () => {
    expect(formatCell(true)).toBe("예");
    expect(formatCell(false, "number")).toBe("아니오");
  });
  it("숫자 서식인데 숫자가 아니면 원문 그대로", () => {
    expect(formatCell("미정", "won")).toBe("미정");
  });
  it("🔴 글자는 꾸미지 않는다 — 태그·마크다운도 그대로 글자다", () => {
    expect(formatCell("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
    expect(formatCell("**굵게** [링크](https://x.y)")).toBe("**굵게** [링크](https://x.y)");
  });
});

describe("날짜 — KST", () => {
  it("달력 날짜는 시간대 변환 없이 그대로", () => {
    expect(dateKey("2026-11-06")).toBe("2026-11-06");
    expect(formatDate("2026-11-06")).toBe("26.11.06");
    expect(formatCell("2026-01-01", "date")).toBe("26.01.01");
  });
  it("UTC 시각은 KST 날짜로 옮긴다(한국 새벽에 하루 어긋나지 않게)", () => {
    // 2026-11-05 20:30 UTC = 2026-11-06 05:30 KST
    expect(dateKey("2026-11-05T20:30:00Z")).toBe("2026-11-06");
    expect(formatDateTime("2026-11-05T20:30:00Z")).toBe("26.11.06 05:30");
    expect(formatDateTime("2026-11-06 14:00:00+09")).toBe("26.11.06 14:00");
  });
  it("datetime 칸에 날짜만 오면 날짜만", () => {
    expect(formatDateTime("2026-11-06")).toBe("26.11.06");
  });
  it("없는 날·날짜가 아닌 값은 원문(지어내지 않는다)", () => {
    expect(dateKey("2026-13-40")).toBeNull();
    expect(formatDate("어제")).toBe("어제");
    expect(formatDateTime("어제")).toBe("어제");
  });
});

describe("effectiveFormat · columnAlign", () => {
  it("서식이 없는데 값이 전부 숫자면 숫자로 본다", () => {
    expect(effectiveFormat(undefined, [1, 2, null])).toBe("number");
    expect(effectiveFormat("text", [1, 2])).toBe("number");
    expect(effectiveFormat(undefined, ["010-1234", 2])).toBe("text");
    expect(effectiveFormat(undefined, [null, ""])).toBe("text");
    expect(effectiveFormat("won", ["a"])).toBe("won");
  });
  it("금액·숫자는 오른쪽, 날짜는 가운데, 짧은 글은 가운데, 긴 글은 왼쪽", () => {
    expect(columnAlign("won", [])).toBe("right");
    expect(columnAlign("date", [])).toBe("center");
    expect(columnAlign("text", ["김철수", "수학"])).toBe("center");
    expect(columnAlign("text", ["학부모가 남긴 긴 상담 메모입니다"])).toBe("left");
  });
});

describe("chartColumnFormat — 차트를 표로 볼 때", () => {
  it("가로축 — 날짜·날짜시각·숫자·글자", () => {
    expect(chartColumnFormat(["2026-11-01", "2026-11-02"], undefined, true)).toBe("date");
    expect(chartColumnFormat(["2026-11-01T01:00:00Z"], undefined, true)).toBe("datetime");
    expect(chartColumnFormat([1, 2], undefined, true)).toBe("number");
    expect(chartColumnFormat(["2026-03", "수학"], undefined, true)).toBe("text");
  });
  it("시리즈 — 단위로", () => {
    expect(chartColumnFormat([], "원")).toBe("won");
    expect(chartColumnFormat([], "%")).toBe("percent");
    expect(chartColumnFormat([], "명")).toBe("number");
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "10반", amount: 300, day: "2026-11-02" },
    { name: "2반", amount: null, day: null },
    { name: "가반", amount: "1,200", day: "2026-10-30" },
    { name: "나반", amount: 50, day: "2026-11-05" },
  ];
  it("숫자는 크기대로, 빈 값은 방향과 상관없이 맨 뒤", () => {
    expect(sortRows(rows, "amount", "desc", "won").map((r) => r.name)).toEqual(["가반", "10반", "나반", "2반"]);
    expect(sortRows(rows, "amount", "asc", "won").map((r) => r.name)).toEqual(["나반", "10반", "가반", "2반"]);
  });
  it("글자는 숫자를 크기대로 읽는다(2반 < 10반)", () => {
    expect(sortRows(rows, "name", "asc", "text").map((r) => r.name)).toEqual(["2반", "10반", "가반", "나반"]);
  });
  it("날짜", () => {
    expect(sortRows(rows, "day", "asc", "date").map((r) => r.name)).toEqual(["가반", "10반", "나반", "2반"]);
  });
  it("같은 값은 원래 순서(안정)", () => {
    const same = [{ k: 1, n: "a" }, { k: 1, n: "b" }, { k: 1, n: "c" }];
    expect(sortRows(same, "k", "desc", "number").map((r) => r.n)).toEqual(["a", "b", "c"]);
  });
  it("처음 누를 때 숫자는 큰 것부터, 글자는 가나다", () => {
    expect(firstSortDir("won")).toBe("desc");
    expect(firstSortDir("text")).toBe("asc");
  });
});

describe("columnTotals", () => {
  const rows = [
    { a: 1000, b: "2", c: 50, d: null },
    { a: "2,000", b: null, c: 30, d: null },
  ];
  const cols = [
    { column: "a", format: "won" as const },
    { column: "b", format: "number" as const },
    { column: "c", format: "percent" as const },
    { column: "d", format: "number" as const },
    { column: "e", format: "number" as const },
  ];
  it("요청한 칸만 더한다 · 숫자가 하나도 없으면 null · 백분율은 더하지 않는다", () => {
    expect(columnTotals(rows, cols, ["a", "b", "c", "d"])).toEqual({ a: 3000, b: 2, d: null });
  });
});

describe("toCsv", () => {
  const cols = [
    { column: "name", label: "이름", format: "text" as const },
    { column: "fee", label: "미납액", format: "won" as const },
    { column: "at", label: "마지막 연락", format: "datetime" as const },
    { column: "day", label: "청구일", format: "date" as const },
  ];
  it("UTF-8 BOM + CRLF · 숫자는 꾸밈 없이 · 날짜는 KST", () => {
    const csv = toCsv(cols, [{ name: "김철수", fee: "12,000", at: "2026-11-05T20:30:00Z", day: "2026-11-01" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿이름,미납액,마지막 연락,청구일\r\n김철수,12000,2026-11-06 05:30,2026-11-01\r\n");
  });
  it("쉼표·따옴표·줄바꿈은 따옴표로 감싼다", () => {
    const csv = toCsv([cols[0]!], [{ name: '그는 "네, 알겠습니다"\n라고' }]);
    expect(csv).toBe('﻿이름\r\n"그는 ""네, 알겠습니다""\n라고"\r\n');
  });
  it("🔴 엑셀 수식으로 읽힐 글자는 앞에 '를 붙인다(수식 주입 차단)", () => {
    const csv = toCsv([cols[0]!], [{ name: "=HYPERLINK(\"http://x\")" }, { name: "+1" }, { name: "@SUM(A1)" }, { name: "-2" }]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(lines[2]).toBe("'+1");
    expect(lines[3]).toBe("'@SUM(A1)");
    expect(lines[4]).toBe("'-2");
  });
  it("숫자 칸의 음수는 숫자 그대로(수식 차단 대상이 아니다) · 빈 값은 빈 칸", () => {
    const csv = toCsv([cols[1]!], [{ fee: -500 }, { fee: null }]);
    expect(csv).toBe("﻿미납액\r\n-500\r\n\r\n");
  });
  it("파일 이름 — 못 쓰는 글자를 지운다", () => {
    expect(csvFileName('미납/현황: "반별"', "2026-11-06")).toBe("학원비서_미납 현황 반별_2026-11-06.csv");
    expect(csvFileName("   ", "2026-11-06")).toBe("학원비서_표_2026-11-06.csv");
  });
});

describe("KPI", () => {
  it("델타 색 — goodWhen에 따라", () => {
    expect(deltaTone(3, "up")).toBe("good");
    expect(deltaTone(-3, "up")).toBe("bad");
    expect(deltaTone(3, "down")).toBe("bad");
    expect(deltaTone(-3, "down")).toBe("good");
    expect(deltaTone(3, "none")).toBe("neutral");
    expect(deltaTone(3, undefined)).toBe("neutral");
    expect(deltaTone(0, "up")).toBe("neutral");
  });
  it("값·델타 글자", () => {
    expect(formatKpiValue(1234567.4, "원")).toBe("1,234,567");
    expect(formatKpiValue(93.456, "%")).toBe("93.5");
    expect(formatKpiValue("김철수")).toBe("김철수");
    expect(formatDelta(-3, "명")).toBe("3명");
    expect(formatDelta(2.54, "%")).toBe("2.5%p");
    expect(formatDelta(120000, "원")).toBe("120,000원");
  });
});

describe("차트 글자", () => {
  it("축 눈금 — 돈은 만·억", () => {
    expect(formatAxisTick(12_000_000, "원")).toBe("1,200만");
    expect(formatAxisTick(350_000_000, "원")).toBe("3.5억");
    expect(formatAxisTick(9_000, "원")).toBe("9,000");
    expect(formatAxisTick(40, "%")).toBe("40%");
    expect(formatAxisTick(1234, "명")).toBe("1,234명");
    expect(formatAxisTick(250_000, "명")).toBe("25만명");
  });
  it("툴팁 값은 줄이지 않는다", () => {
    expect(formatChartValue(12_345_000, "원")).toBe("12,345,000원");
    expect(formatChartValue(12.34, "%")).toBe("12.3%");
    expect(formatChartValue(5)).toBe("5");
  });
  it("가로축 — 한 해의 달은 '3월', 해가 섞이면 '26.03'", () => {
    expect(axisLabels(["2026-03", "2026-04"]).map((l) => l.label)).toEqual(["3월", "4월"]);
    expect(axisLabels(["2025-12", "2026-01"]).map((l) => l.label)).toEqual(["25.12", "26.01"]);
    expect(axisLabels(["2026-03"])[0]!.tip).toBe("2026년 3월");
  });
  it("가로축 — 날짜는 '11/6', 툴팁은 요일까지 · 빈 값은 (없음)", () => {
    const [a, b] = axisLabels(["2026-11-06", null]);
    expect(a).toEqual({ label: "11/6", tip: "2026년 11월 6일 (금)" });
    expect(b).toEqual({ label: "(없음)", tip: "(없음)" });
  });
});

const dataset = (rows: Record<string, string | number | boolean | null>[], truncated = false) => ({
  columns: Object.keys(rows[0] ?? {}),
  rows,
  truncated,
  purpose: "목적",
});

describe("chartPoints · pieSlices", () => {
  it("시리즈 값은 s0·s1 키 · 숫자가 아니면 null", () => {
    const pts = chartPoints(dataset([{ m: "2026-03", a: 3, "b.c": "4" }, { m: "2026-04", a: "x", "b.c": null }]), "m", [
      { column: "a" },
      { column: "b.c" },
    ]);
    expect(pts).toEqual([
      { key: "0", label: "3월", tip: "2026년 3월", s0: 3, s1: 4 },
      { key: "1", label: "4월", tip: "2026년 4월", s0: null, s1: null },
    ]);
  });
  it("원그래프 — 0 이하 제외 · 큰 순 · 많으면 상위 다섯 + 기타(회색)", () => {
    const rows = ["가", "나", "다", "라", "마", "바", "사"].map((name, i) => ({ name, v: 10 - i }));
    rows.push({ name: "아", v: 0 });
    const slices = pieSlices(dataset(rows), "name", "v");
    expect(slices.map((s) => s.name)).toEqual(["가", "나", "다", "라", "마", "기타 2개"]);
    expect(slices[5]!.value).toBe(9);
    expect(slices[5]!.color).toBe(OTHER_COLOR);
    expect(slices.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
  });
  it("원그래프 — 값이 없으면 빈 배열", () => {
    expect(pieSlices(dataset([{ n: "a", v: 0 }]), "n", "v")).toEqual([]);
  });
});

describe("groupBlocks · reportSources", () => {
  const chart = (query: string): ReportBlock => ({ type: "chart", kind: "bar", title: "t", query, x: "x", series: [{ column: "y", label: "y" }] });
  it("이어진 차트만 한 묶음", () => {
    const blocks: ReportBlock[] = [{ type: "summary", text: "s" }, chart("q1"), chart("q2"), { type: "list", items: ["a"] }, chart("q3")];
    expect(groupBlocks(blocks).map((g) => (g.kind === "charts" ? `charts:${g.blocks.length}` : g.block.type))).toEqual([
      "summary",
      "charts:2",
      "list",
      "charts:1",
    ]);
  });
  it("근거 — 블록에 나온 순서, 가리키지 않은 조회는 뒤에 · 일부만 표시", () => {
    const report: SettledReport = {
      title: "t",
      blocks: [
        { type: "table", title: "t", query: "q2", columns: [{ column: "x", label: "x" }] },
        { type: "kpi", items: [{ label: "k", value: 1, ref: { query: "q3", row: 0, column: "x" } }] },
      ],
      datasets: {
        q1: { ...dataset([{ x: 1 }]), purpose: "하나" },
        q2: { ...dataset([{ x: 1 }, { x: 2 }], true), purpose: "둘" },
        q3: { ...dataset([{ x: 1 }]), purpose: "셋" },
      },
    };
    expect(reportSources(report)).toEqual([
      { id: "q2", purpose: "둘", rowCount: 2, truncated: true },
      { id: "q3", purpose: "셋", rowCount: 1, truncated: false },
      { id: "q1", purpose: "하나", rowCount: 1, truncated: false },
    ]);
  });
});
