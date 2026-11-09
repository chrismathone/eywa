import { describe, expect, it } from "vitest";
import { LINE_KEY, claimedKeys, claimsOf, courseOfLine, keysOverlap, lineIds, lineIdsOverlap, refundTag, unallocId } from "./refund-keys";
import cases from "./refund-keys-overlap.cases.json";

const inv = "11111111-1111-1111-1111-111111111111";
const eng = { kind: "수업", classId: "c1", description: "중등E Jane" };
const math = { kind: "수업", classId: "c2", description: "중2 수학 A" };
const book = { kind: "교재", description: "워크북" };

describe("퇴원보고서 환불 줄 키(리뷰 2026-10-29)", () => {
  it("줄 내용 기준 — 순서가 바뀌거나 줄이 끼어도 같은 줄은 같은 키", () => {
    const [e, m] = lineIds([eng, math]);
    expect(lineIds([math, book, eng])).toEqual([m, lineIds([book])[0], e]);
    expect(LINE_KEY.test(`${inv}#${e}`)).toBe(true);
    expect(LINE_KEY.test(`${inv}#all`)).toBe(true);
    expect(LINE_KEY.test(`${inv}#0;drop`)).toBe(false);
    // 미배분 납부 — 청구 전체 · 과목 몫 · 나머지(리뷰 r2 D-10 · DB 줄 키 검사와 같은 글자)
    for (const id of ["unalloc", "unalloc:math", "unalloc:english.math", "unalloc:~math", "unalloc:~english.subject_1"]) expect(LINE_KEY.test(`${inv}#${id}`), id).toBe(true);
    for (const id of ["unalloc:", "unalloc:~", "unalloc:Math!", "unalloc:a..b", "unalloc:~~math"]) expect(LINE_KEY.test(`${inv}#${id}`), id).toBe(false);
    expect(unallocId()).toBe("unalloc");
    expect(unallocId({ subjects: ["math", "english", "math"] })).toBe("unalloc:english.math");
    expect(unallocId({ except: ["math"] })).toBe("unalloc:~math");
  });
  it("🔴 겹침 규칙 사례표 — DB withdrawal_refund_keys_overlap과 같은 파일·같은 답(PGlite r2-scenarios K) · 양방향(리뷰 r2 D-1 ⅱ)", () => {
    const A = "cccccccc-0000-4000-8000-000000000001", B = "cccccccc-0000-4000-8000-000000000002";
    const real = (key: string) => key.replace(/^X#/, `${A}#`).replace(/^Y#/, `${B}#`);
    const miss = (cases as [string, string, boolean, string][]).filter(([a, b, want]) => keysOverlap(real(a), real(b)) !== want || keysOverlap(real(b), real(a)) !== want);
    expect(miss).toEqual([]);
    expect((cases as unknown[]).length).toBeGreaterThanOrEqual(20);
    // 줄 식별값만으로도 같은 규칙
    expect(lineIdsOverlap("unalloc:math", "unalloc:english")).toBe(false);
    expect(lineIdsOverlap("k1", "k1-3")).toBe(true);
  });
  it("같은 식별값 줄은 차례 번호", () => {
    const [a, b] = lineIds([book, book]);
    expect(b).toBe(`${a}-1`);
  });
  it("표식 읽기 — 줄 표식 · 옛 표식(청구 전체)", () => {
    expect(claimedKeys(refundTag("r", [`${inv}#abc`, `${inv}#d-1`]))).toEqual([`${inv}#abc`, `${inv}#d-1`]);
    expect(claimedKeys(`퇴원보고서 환불 승인 · report:r · invoice:${inv}`)).toEqual([`${inv}#*`]);
    expect(claimedKeys("다른 문서")).toEqual([]);
  });
  it("🔴 잡힘 판정(리뷰 r2 D-1·D-2) — 다른 묶음은 겹침 규칙 전체 · 이 묶음은 표식 키가 지금 줄에 있으면 그 줄만, 없어졌으면 겹침으로(정확하지 않음)", () => {
    const ids = [...lineIds([eng, math, book, book]), "unalloc"];
    const refs = (got: { ref: string | null }[]) => got.map((x) => x.ref);
    const exact = (got: { exact: boolean }[]) => got.map((x) => x.exact);
    // 다른 묶음 — 형제 · 미배분 ↔ 줄 · 옛 표식 · 지금 없는 줄 · all → 겹침(같은 돈 두 번 막기)
    expect(refs(claimsOf(ids, [[ids[0]!, "A"]], "other"))).toEqual(["A", null, null, null, "A"]); // 실제 줄 ↔ 미배분은 겹친다
    expect(refs(claimsOf(ids, [[ids[3]!, "B"]], "other"))).toEqual([null, null, "B", "B", "B"]);
    for (const k of ["*", "zzz", "all"]) expect(refs(claimsOf(ids, [[k, "C"]], "other")), k).toEqual(["C", "C", "C", "C", "C"]);
    expect(refs(claimsOf(ids, [["unalloc", "D"]], "other"))).toEqual(["D", "D", "D", "D", "D"]);
    expect(refs(claimsOf(ids, undefined, "other"))).toEqual([null, null, null, null, null]);
    // 이 묶음 — 표식 키가 지금 줄에 있으면 그 줄만(형제·미배분은 따로 정할 다른 돈 · DB도 같은 묶음 안 겹침은 막지 않는다)
    const own = claimsOf(ids, [[ids[3]!, "B"]], "own");
    expect(refs(own)).toEqual([null, null, null, "B", null]);
    expect(exact(own)).toEqual([false, false, false, true, false]);
    // 표식 키가 없어졌으면(수납명 변경 · 미배분이 줄에 배분됨) 겹치는 줄을 담은 것으로 — 정확하지 않음(DB가 원장 결정을 다시 묻는다)
    const stale = claimsOf(ids.slice(0, 4), [["unalloc", "U"]], "own", false); // 미배분이 0이 됨(줄에 배분)
    expect(refs(stale)).toEqual(["U", "U", "U", "U"]);
    expect(exact(stale)).toEqual([false, false, false, false]);
    expect(refs(claimsOf(ids, [["zzz", "R"]], "own"))).toEqual(["R", "R", "R", "R", "R"]);
    // 🔴 미배분이 아직 남아 있으면 이 묶음의 (다른 과목) 미배분 키는 실제 줄을 잡지 않는다 — 다른 보고서 과목 몫을 낡은 키로 읽어 줄을 담지 않게
    const shares = [...ids.slice(0, 4), "unalloc:english"];
    expect(refs(claimsOf(shares, [["unalloc:math", "M"]], "own", true))).toEqual([null, null, null, null, null]);
    // 미배분이 0이 됐으면(줄에 배분됨) 실제 줄까지 담는다(정확하지 않음)
    expect(refs(claimsOf(ids.slice(0, 4), [["unalloc:math", "M"]], "own", false))).toEqual(["M", "M", "M", "M"]);
    // 범위가 바뀜(과목 몫 → 청구 전체 · I5) — 미배분 줄은 겹침으로 담는다(원장이 다시 정한다)
    expect(refs(claimsOf([...ids.slice(0, 4), "unalloc"], [["unalloc:math", "M"]], "own", true))).toEqual([null, null, null, null, "M"]);
    // 정확히 담은 요청서가 있으면 그 요청서가 앞(DB claimed 갈래는 그 요청서 표식으로 정확함을 본다)
    const two = claimsOf(ids, [["zzz", "R"], [ids[0]!, "S"]], "own");
    expect(two[0]).toEqual({ ref: "S", exact: true, all: ["S", "R"] });
  });
  it("줄 → 반: 반 이름으로 시작하는 수납명(김덕현 11월) · 가장 긴 이름 · classId 우선", () => {
    const courses = [
      { classId: "m1", className: "중등M 중2 EL3N" },
      { classId: "e1", className: "중등E_중2 심화" },
      { classId: "e0", className: "중등E_중2" },
    ];
    expect(courseOfLine({ description: "중등E_중2 심화 Jane 월수목 16:20-18:10" }, courses)?.classId).toBe("e1");
    expect(courseOfLine({ description: "중등M 중2 EL3N 화금" }, courses)?.classId).toBe("m1");
    expect(courseOfLine({ description: "중등E_중2" }, courses)?.classId).toBe("e0");
    expect(courseOfLine({ description: "중등E_중2심화반" }, courses)).toBeNull();
    expect(courseOfLine({ description: "SRS 프로그램 사용료" }, courses)).toBeNull();
    expect(courseOfLine({ classId: "m1", description: "중등E_중2 심화 Jane" }, courses)?.classId).toBe("m1");
    expect(courseOfLine({ classId: "gone", description: "중등E_중2 심화 Jane" }, courses)?.classId).toBe("e1");
  });
});
