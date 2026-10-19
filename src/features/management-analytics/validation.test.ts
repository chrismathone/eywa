import { describe, expect, it } from "vitest";
import { decodeCsv, parseCsv } from "./csv";
import { normalizeData } from "./normalize";
import { prepareCsv, suggestMapping } from "./prepare";
import { SAMPLE_CSV } from "./sample";
import { sampleOptions } from "./test-fixtures";
import { MAX_FILE_BYTES, MAX_ROWS, analysisOptionsSchema, normalizeDate } from "./contract";

describe("CSV reader and privacy", () => {
  it("reads BOM, CRLF, escaped quotes, commas and embedded newlines", () => {
    expect(parseCsv('\uFEFFa,b\r\n"x,y","say ""hello""\nnext"\r\n')).toEqual([["a", "b"], ["x,y", 'say "hello"\nnext']]);
  });
  it.each(['a,a\nx,y', 'a,\nx,y', 'a,b\nx', 'a\n"unfinished', 'a\n"x"junk', 'a\nx"y', 'a\n\0'])
    ("rejects malformed CSV without including source values: %s", (text) => expect(() => parseCsv(text)).toThrow());
  it("bounds file bytes, cells, columns and rows", () => {
    expect(() => decodeCsv(new ArrayBuffer(MAX_FILE_BYTES + 1), "utf-8")).toThrow();
    expect(() => parseCsv(`a\n${"x".repeat(2049)}`)).toThrow();
    expect(() => parseCsv(Array.from({ length: 51 }, (_, i) => `c${i}`).join(","))).toThrow();
    expect(() => parseCsv(`a\n${"x\n".repeat(MAX_ROWS + 1)}`)).toThrow();
  });
  it("rejects invalid UTF-8 and supports Korean Windows encoding", () => {
    const bytes = new Uint8Array([0xb0, 0xa1]).buffer;
    expect(() => decodeCsv(bytes, "utf-8")).toThrow();
    expect(decodeCsv(bytes, "euc-kr")).toBe("가");
  });
  it("drops private columns locally, preserves leading-zero identifiers and escapes selected values", () => {
    const csv = '원생고유번호,입학일,퇴원일,이름,전화\n00123,2026-09-01,,비공개,01012345678';
    const mapping = suggestMapping("enrollments", parseCsv(csv)[0]);
    const clean = prepareCsv(csv, "enrollments", mapping);
    expect(clean).toContain('"00123"');
    expect(clean).not.toMatch(/비공개|01012345678|이름|전화/);
    expect(parseCsv(clean)[0]).toEqual(["student_id", "started_on", "ended_on"]);
  });
  it("never treats the source payment item category as payment/refund", () => {
    expect(suggestMapping("payments", ["구분", "실제낸금액", "수납일"]).kind).toBe("");
    expect(() => prepareCsv("a,b\nx,y", "enrollments", { student_id: "a", started_on: "b", ended_on: "b" })).toThrow();
  });
});

describe("business validation", () => {
  it.each(["2026-02-29", "2026-13-01", "2026-09-31", "09/01/2026", "2026-09-01T01:00:00Z"])("rejects invalid or ambiguous date %s", (value) => expect(normalizeDate(value)).toBeNull());
  it("normalizes explicit year-first dates and preserves leap day", () => {
    expect(normalizeDate("2024.2.29")).toBe("2024-02-29");
    expect(normalizeDate("2026/9/1")).toBe("2026-09-01");
  });
  it("rejects reversed/future coverage, unconfirmed data, and more than 24 months", () => {
    for (const change of [{ from: "2026-10-01" }, { asOf: "2026-09-29" }, { from: "2024-09-01" }, { completeHistory: false }, { sameTenant: false }])
      expect(analysisOptionsSchema.safeParse({ ...sampleOptions(), ...change }).success).toBe(false);
  });
  it.each([
    ['P001,S001,2026-09-01,999,payment', "동일 식별자"],
    ['NEW,missing,2026-09-01,100,payment', "입퇴원 이력에 없는"],
    ['NEW,S001,2026-10-01,100,payment', "날짜"],
    ['NEW,S001,2026-09-01,-100,refund', "양수"],
    ['NEW,S001,2026-09-01,1.5,payment', "정수"],
    ['NEW,S001,2026-09-01,"1,00",payment', "정수"],
    ['NEW,S001,2026-09-01,1000000001,payment', "10억원"],
    ['NEW,S001,2026-09-01,100,수업', "구분"],
    ['=FORMULA,S001,2026-09-01,100,payment', "식별 코드"],
  ])("rejects a bad transaction: %s", (row, message) => {
    const result = normalizeData({ ...SAMPLE_CSV, payments: SAMPLE_CSV.payments + row }, sampleOptions());
    expect(result.issueCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.message.includes(message))).toBe(true);
    expect(JSON.stringify(result.issues)).not.toContain("=FORMULA");
  });
  it("accepts duplicate normalization and comma thousands, but rejects overlapping enrollments", () => {
    const normalized = normalizeData({ ...SAMPLE_CSV, payments: SAMPLE_CSV.payments + 'P001,S001,2026/9/1,"300,000",payment' }, sampleOptions());
    expect(normalized.issueCount).toBe(0);
    expect(normalized.quality.payments.duplicates).toBe(2);
    expect(normalizeData({ ...SAMPLE_CSV, enrollments: SAMPLE_CSV.enrollments + 'S001,2026-09-01,\n' }, sampleOptions()).issueCount).toBeGreaterThan(0);
  });
  it("caps issue details while retaining total errors and excludes source PII", () => {
    const payments = "transaction_id,student_id,paid_on,amount,kind\n" + "PRIVATE_NAME,S001,invalid,10,payment\n".repeat(75);
    const r = normalizeData({ ...SAMPLE_CSV, payments }, sampleOptions());
    expect(r.issueCount).toBe(75); expect(r.issues).toHaveLength(50);
    expect(JSON.stringify(r.issues)).not.toContain("PRIVATE_NAME");
  });
  it("retains more than 1000 rows without silent truncation", () => {
    const payments = "transaction_id,student_id,paid_on,amount,kind\n" + Array.from({ length: 1001 }, (_, i) => `P${i},S001,2026-09-01,1,payment`).join("\n");
    const r = normalizeData({ ...SAMPLE_CSV, payments }, sampleOptions());
    expect(r.issueCount).toBe(0); expect(r.data.payments).toHaveLength(1001);
  });
});
