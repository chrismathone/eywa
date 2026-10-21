import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { parseMonthlyEnrolledHtml, parseCount, planEnrolledRecords, defaultFrom, addMonths } = createRequire(import.meta.url)("./monthly-enrolled.cjs");

// 실제 화면(2026-10-21)과 같은 모양 — 머리 칸 안 줄바꿈·주석 · 링크로 감싼 숫자 · '-' · 합계 줄.
const row = (month: string, enrolled: string) => `<tr class="">
  <td class="first" rowspan="1">
            ${month}</td>
  <td class="rtpad"><a href="javascript:void 0;" ym="x" class="btnLinkIn">21 명</a></td>
  <td class="rtpad">
      -
  </td>
  <td class="rtpad"><a href="javascript:void 0;" class="btnLinkOut">41 명</a></td>
  <td class="rtpad">
  ${enrolled}
  </td>
</tr>`;
const page = (rows: string) => `<table class="search"><tr><th>날짜/기준</th></tr></table>
<table class="list grade"><thead><tr class="bg_top">
  <th class="first">날짜</th><th>신규원생
  <!--<br/><span>(등록일기준)</span> --></th><th>휴원생</th><th>퇴원생</th><th>재원생</th></tr></thead>
<tbody>${rows}<tr class="sum"><td class="first">합계</td><td>360 명</td><td>0 명</td><td>435 명</td><td>평균 413.0 명</td></tr></tbody></table>
<table class="list grade"><thead><tr><th>퇴원사유</th><th>인원</th></tr></thead><tbody><tr><td>기타</td><td>5 명</td></tr></tbody></table>`;

describe("parseMonthlyEnrolledHtml", () => {
  it("머리 칸 이름으로 재원생 열을 읽는다 · 합계 줄은 건너뛴다 · '-'는 null", () => {
    expect(parseMonthlyEnrolledHtml(page(row("2025-03", "465 명") + row("2026-10", "1,343 명") + row("2025-01", "-")))).toEqual([
      { month: "2025-03", enrolled: 465 },
      { month: "2026-10", enrolled: 1343 },
      { month: "2025-01", enrolled: null },
    ]);
  });
  it("표가 없으면(로그인 화면 등) 멈춘다", () => {
    expect(() => parseMonthlyEnrolledHtml("<html><form>로그인</form></html>")).toThrow(/찾지 못했습니다/);
  });
  it("달이 아닌 줄·칸 수가 다른 줄은 멈춘다", () => {
    expect(() => parseMonthlyEnrolledHtml(page(row("이상한줄", "1 명")))).toThrow(/알 수 없는 줄/);
    expect(() => parseMonthlyEnrolledHtml(page(`<tr><td>2026-01</td><td>401 명</td></tr>`))).toThrow(/칸 수/);
  });
  it("숫자가 아닌 재원생 칸은 멈춘다", () => {
    expect(() => parseCount("평균 413.0 명")).toThrow();
    expect(parseCount(" 427 명 ")).toBe(427);
  });
});

describe("planEnrolledRecords", () => {
  const scraped = [
    { month: "2026-01", enrolled: 401 },
    { month: "2026-02", enrolled: 424 },
    { month: "2026-03", enrolled: 428 },
    { month: "2026-04", enrolled: 427 },
    { month: "2026-05", enrolled: 424 },
    { month: "2026-06", enrolled: null },
    { month: "2026-09", enrolled: 346 },
    { month: "2026-10", enrolled: 343 },
    { month: "2026-11", enrolled: 350 },
    { month: "2026-12", enrolled: 352 },
  ];
  const fin = (value: number) => ({ value, writtenIn: "2026-10" });
  const base = { "2026-01": fin(401), "2026-02": fin(424), "2026-03": fin(428) };
  const tags = (rows: { month: string; action: string }[]) => rows.map((r) => `${r.month}:${r.action}`);
  it("앞 달 대조가 맞으면 없는 달만 넣는다 · '-'는 건너뛴다 · 지금 달 뒤는 안 넣는다", () => {
    const { checks, rows } = planEnrolledRecords({ scraped, existing: base, from: "2026-04", to: "2026-12", thisMonth: "2026-10" });
    expect(checks.map((c: { month: string }) => c.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(tags(rows)).toEqual(["2026-04:insert", "2026-05:insert", "2026-06:empty", "2026-07:missing", "2026-08:missing", "2026-09:insert", "2026-10:insert"]);
  });
  it("대조가 하나라도 다르면 전부 멈춘다", () => {
    expect(() => planEnrolledRecords({ scraped, existing: { ...base, "2026-02": fin(999) }, from: "2026-04", to: "2026-10", thisMonth: "2026-10" })).toThrow(/대조 실패.*2026-02/);
  });
  it("대조할 확정 값이 3달보다 적으면 쓰지 않는다", () => {
    expect(() => planEnrolledRecords({ scraped, existing: {}, from: "2026-04", to: "2026-10", thisMonth: "2026-10" })).toThrow(/0달뿐/);
    expect(() => planEnrolledRecords({ scraped, existing: { "2026-03": fin(428) }, from: "2026-04", to: "2026-10", thisMonth: "2026-10" })).toThrow(/1달뿐/);
  });
  it("값이 바뀐 달은 지난달·이번 달만 고치고, 그 앞은 알리기만(덮어쓰기 옵션이면 고친다)", () => {
    const existing = { ...base, "2026-04": fin(400), "2026-09": fin(340), "2026-10": fin(330) };
    const plan = (overwrite: boolean) =>
      planEnrolledRecords({ scraped, existing, from: "2026-04", to: "2026-10", thisMonth: "2026-10", overwrite }).rows.filter((r: { action: string }) => r.action !== "missing" && r.action !== "empty");
    expect(tags(plan(false))).toEqual(["2026-04:conflict", "2026-05:insert", "2026-09:update", "2026-10:update"]);
    expect(plan(true)[0]).toEqual({ month: "2026-04", action: "update", value: 427, before: 400 });
  });
  it("한 달을 건너뛰어도 진행 중에 쓴 값은 대조에서 빠지고 확정값으로 고친다", () => {
    // 10월 21일에 10월 진행 중 값 343을 썼고, 11월 실행을 빠뜨린 채 12월에 돈다(메이크에듀 10월 확정값은 345).
    const existing = { ...base, "2026-09": fin(346), "2026-10": { value: 343, writtenIn: "2026-10" } };
    const late = scraped.map((r) => (r.month === "2026-10" ? { ...r, enrolled: 345 } : r));
    expect(defaultFrom(existing, "2026-12")).toBe("2026-10");
    const { checks, rows } = planEnrolledRecords({ scraped: late, existing, from: "2026-10", to: "2026-12", thisMonth: "2026-12" });
    expect(checks.map((c: { month: string }) => c.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-09"]);
    expect(tags(rows)).toEqual(["2026-10:update", "2026-11:insert", "2026-12:insert"]);
    // 진행 중 값이 대조 구간에 있어도 막지 않는다(그 달은 대조에서 뺀다).
    expect(() => planEnrolledRecords({ scraped: late, existing, from: "2026-11", to: "2026-12", thisMonth: "2026-12" })).not.toThrow();
  });
  it("진행 중 값이 확정값과 같으면 같은 값으로 다시 써서 확정한다(이번 달은 그대로)", () => {
    const existing = { ...base, "2026-09": fin(346), "2026-10": { value: 343, writtenIn: "2026-10" }, "2026-11": { value: 350, writtenIn: "2026-11" } };
    const { rows } = planEnrolledRecords({ scraped, existing, from: defaultFrom(existing, "2026-11"), to: "2026-11", thisMonth: "2026-11" });
    expect(tags(rows)).toEqual(["2026-10:confirm", "2026-11:same"]);
  });
  it("기본 시작 달 = 지난달(더 앞에 진행 중 값이 없으면)", () => {
    expect(defaultFrom(base, "2026-10")).toBe("2026-09");
  });
  it("달 더하기는 해를 넘는다", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });
});
