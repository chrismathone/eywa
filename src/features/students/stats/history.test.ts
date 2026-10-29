import { describe, expect, it } from "vitest";
import { firstMonthWith, mergeHistory, parseHistoryData, withoutPaying, yearlyHistory } from "./history";
import { aywaHistoryMonths, lessonKinds, lessonNameWeights, lessonPaid, lessonPrograms, type HistoryInvoice } from "./history-aywa";
import { lessonProgramClassifier } from "./lesson-program";

describe("지난 기록 — 두 출처 잇기(원장 2026-10-20)", () => {
  it("모양이 틀린 칸은 버리고(0으로 바꾸지 않는다) 추정 칸 이름만 남긴다", () => {
    expect(parseHistoryData({ payingGeneral: 258, payingEie: "x", newReal: -3, estimated: ["payingGeneral", "nope"] })).toEqual({
      payingGeneral: 258,
      estimated: ["payingGeneral"],
    });
    expect(parseHistoryData(null)).toEqual({ estimated: [] });
  });

  it("같은 달은 에이와 칸이 이긴다 · 메이크에듀 재원생 기록은 남는다 · 달 순서", () => {
    const months = mergeHistory([
      { month: "2026-01", source: "aywa", data: { payingGeneral: 330, payingEie: 93 } },
      { month: "2026-01", source: "makeedu", data: { enrolledRecord: 401, payingGeneral: 999, estimated: ["payingGeneral"] } },
      { month: "2025-12", source: "makeedu", data: { payingGeneral: 337, payingEie: 90, enrolledRecord: 432 } },
    ]);
    expect(months.map((m) => m.month)).toEqual(["2025-12", "2026-01"]);
    expect(months[1]).toEqual({ month: "2026-01", payingGeneral: 330, payingEie: 93, enrolledRecord: 401, estimated: [] });
  });

  it("연도별 — 학생 수는 값이 있는 달의 평균, 신규는 합 · 칸마다 평균을 낸 달 수 · 값이 없는 칸은 비운다", () => {
    const years = yearlyHistory([
      { month: "2025-04", payingGeneral: 258, newReal: 22, estimated: ["payingGeneral"] },
      { month: "2025-05", payingGeneral: 347, payingEie: 88, newReal: 27, estimated: [] },
      { month: "2026-01", payingGeneral: 330, payingEie: 93, newReal: 10, enrolledRecord: 401, estimated: [] },
      { month: "2026-02", payingGeneral: 334, newReal: 5, estimated: [] },
    ]);
    expect(years).toEqual([
      { year: "2025", months: 2, fieldMonths: { payingGeneral: 2, payingEie: 1, newReal: 2 }, payingGeneral: 303, payingEie: 88, newReal: 49 },
      { year: "2026", months: 2, fieldMonths: { payingGeneral: 2, payingEie: 1, newReal: 2, enrolledRecord: 1 }, payingGeneral: 332, payingEie: 93, newReal: 15, enrolledRecord: 401 },
    ]);
    expect(firstMonthWith([{ month: "2025-04", estimated: [] }, { month: "2025-05", payingEie: 88, estimated: [] }], "payingEie")).toBe("2025-05");
  });

  it("수납 권한이 없으면 청구 칸(수업료가 청구된 학생)과 그 추정 표시를 뺀다 · 신규·메이크에듀 기록은 남긴다", () => {
    expect(withoutPaying([{ month: "2025-04", payingGeneral: 258, payingTotal: 300, newReal: 22, enrolledRecord: 483, estimated: ["payingGeneral"] }])).toEqual([
      { month: "2025-04", newReal: 22, enrolledRecord: 483, estimated: [] },
    ]);
  });
});

describe("지난 기록 — 에이와 쪽 월별 값", () => {
  const lesson = (description: string, amount = 100000, kind: unknown = "tuition") => ({ kind, description, amount, paid: amount });
  const inv = (student_id: string, period: string, items: unknown[], status = "paid", amount_total = 100000): HistoryInvoice => ({
    student_id,
    period,
    status,
    category: "tuition",
    line_items: items,
    amount_total,
  });
  const reg = (id: string, enrolledAt: string, o: { merged?: boolean; bookkeeping?: boolean } = {}) => ({
    id,
    enrolledAt,
    merged: o.merged ?? false,
    bookkeeping: o.bookkeeping ?? false,
  });

  it("수업 항목만(에이와 'tuition' · 메이크에듀 '수업' · 종류 없는 옛 항목) · 금액이 있는 항목만 · '[EiE]'로 시작하면 EiE", () => {
    expect(lessonKinds([lesson("[EiE] ROOKIES"), { kind: "material", description: "교재", amount: 30000 }])).toEqual({ general: false, eie: true });
    expect(lessonKinds([lesson("이수진반 초5", 100000, "수업"), lesson("[EiE] Let's Speak", 0)])).toEqual({ general: true, eie: false });
    expect(lessonKinds([{ description: "수학 A", amount: 90000 }])).toEqual({ general: true, eie: false });
    expect(lessonKinds([{ kind: "shuttle", description: "차량비", amount: 30000 }])).toEqual({ general: false, eie: false });
    // 항목이 없는 청구 = 수업료 한 줄(금액이 있을 때만).
    expect(lessonKinds([], 120000)).toEqual({ general: true, eie: false });
    expect(lessonKinds(null, 0)).toEqual({ general: false, eie: false });
  });

  it("취소·환불 청구는 세지 않는다 · 신규는 병합·장부 정리만 남은 등록을 빼고, 실제 신규는 등록 막대와 같은 판정 결과(started)만", () => {
    const invoices = [
      inv("a", "2026-03", [lesson("수학 A")]),
      inv("a", "2026-04", [lesson("수학 A"), lesson("[EiE] Kopi")]),
      inv("b", "2026-03", [lesson("[EiE] Dr.Phonics")], "void"), // 취소 — 수업료가 청구된 학생도, 신규 근거도 아니다
      inv("r", "2026-04", [lesson("수학 R")], "refunded"),
      inv("c", "2026-02", [lesson("수학 B")]), // 등록(3월) 직전 청구 — 등록일만 고쳐진 재원생
      inv("c", "2026-03", [lesson("수학 B")]),
    ];
    const rows = aywaHistoryMonths({
      months: ["2026-03", "2026-04"],
      invoices,
      registrations: [
        reg("a", "2026-03-05"),
        reg("b", "2026-03-10"),
        reg("c", "2026-03-12"), // 직전 달 청구가 있어 판정이 '시작 안 함'(등록일만 고쳐진 재원생)
        reg("d", "2026-04-01"), // 출석만 있다
        reg("f", "2026-04-03"), // 반 수강만(일주일 넘게 다님)
        reg("e", "2026-04-02", { merged: true }),
        reg("k", "2026-04-04", { bookkeeping: true }),
      ],
      // 판정은 `computeRecordCoverage`가 한다 — 병합·장부 정리 학생이 판정에 들어 있어도 모집단에서 빠진다.
      started: new Set(["a", "d", "f", "e", "k"]),
    });
    expect(rows).toEqual([
      { month: "2026-03", data: { payingGeneral: 2, payingEie: 0, payingTotal: 2, newRegistered: 3, newReal: 1, tuitionPaidGeneral: 200000, tuitionPaidEie: 0 } },
      { month: "2026-04", data: { payingGeneral: 1, payingEie: 1, payingTotal: 1, newRegistered: 2, newReal: 2, tuitionPaidGeneral: 100000, tuitionPaidEie: 100000 } },
    ]);
  });

  it("EiE 수업 청구가 하나도 없는 지점은 EiE 칸을 싣지 않는다(없는 프로그램을 0으로 그리지 않게)", () => {
    const invoices = [inv("a", "2026-03", [lesson("수학 A")])];
    const rows = aywaHistoryMonths({ months: ["2026-03"], invoices, registrations: [reg("a", "2026-03-05")], started: new Set(["a"]) });
    expect(rows[0]!.data).not.toHaveProperty("payingEie");
    expect(rows[0]!.data).toMatchObject({ payingGeneral: 1, newReal: 1 });
  });

  it("프로그램 칸 — 수업명으로 수학·인재원 영어·그 밖·모름(EiE 줄은 EiE 칸만) · 두 프로그램이면 양쪽 · 판정기가 없으면 칸을 싣지 않는다", () => {
    const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }, { key: "science", label: "과학" }];
    const invoices = [
      inv("a", "2026-03", [lesson("수학 A"), lesson("중등영어 정규")]),
      inv("b", "2026-03", [lesson("[EiE] Kopi"), lesson("고등모의고사 특강")]), // EiE + 모름
      inv("c", "2026-03", [lesson("초등 과학 탐구")]),
      inv("d", "2026-03", [], "unpaid", 120000), // 항목 없는 청구 = 모름
    ];
    const classify = lessonProgramClassifier(lessonNameWeights(invoices), subjects);
    const [row] = aywaHistoryMonths({ months: ["2026-03"], invoices, registrations: [], started: new Set(), classify });
    expect(row!.data).toMatchObject({ payingGeneral: 4, payingEie: 1, payingMath: 1, payingInjaewon: 1, payingOther: 1, payingUnknown: 2, payingEnglish: 2 });
    expect(lessonPrograms([lesson("[EiE] Kopi")], 0, classify)).toEqual(new Set());
    const [plain] = aywaHistoryMonths({ months: ["2026-03"], invoices, registrations: [], started: new Set() });
    expect(plain!.data).not.toHaveProperty("payingMath");
    expect(plain!.data).not.toHaveProperty("payingEnglish");
  });

  it("영어 묶음(payingEnglish) = 인재원 영어 ∪ EiE — 둘 다 들은 학생은 한 번(원장 2026-10-29 강좌수·재원생 추이 잇기)", () => {
    const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }];
    const invoices = [
      inv("a", "2026-03", [lesson("중등영어 정규"), lesson("[EiE] Kopi")]), // 둘 다 → 1
      inv("b", "2026-03", [lesson("[EiE] Kopi")]),
      inv("c", "2026-03", [lesson("수학 A")]),
    ];
    const classify = lessonProgramClassifier(lessonNameWeights(invoices), subjects);
    const [row] = aywaHistoryMonths({ months: ["2026-03"], invoices, registrations: [], started: new Set(), classify });
    expect(row!.data).toMatchObject({ payingInjaewon: 1, payingEie: 2, payingEnglish: 2, payingMath: 1 });
  });

  it("앞뒤 달로 잇는 달(2025-04 — 원장 2026-10-29) = 그달 청구 ∪ (앞 달 ∩ 뒤 달) · 칸마다 · 끊김 판정엔 안 넣는다 · 표시", () => {
    const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }];
    const invoices = [
      inv("a", "2025-03", [lesson("수학 A")]), inv("a", "2025-05", [lesson("수학 A")]), // 앞뒤 다 → 이음
      inv("b", "2025-03", [lesson("[EiE] Kopi")]), // 앞만 → 안 이음
      inv("c", "2025-04", [lesson("중등영어 정규")]), // 그달 청구 → 그대로
      inv("d", "2025-05", [lesson("[EiE] Kopi")]), // 뒤만 → 안 이음
      inv("e", "2025-03", [lesson("[EiE] Kopi")]), inv("e", "2025-05", [lesson("[EiE] Kopi")]),
    ];
    const classify = lessonProgramClassifier(lessonNameWeights(invoices), subjects);
    const months = ["2025-03", "2025-04", "2025-05"];
    const rows = aywaHistoryMonths({ months, invoices, registrations: [], started: new Set(), classify, skipMonths: new Set(["2025-04"]), bridgeMonths: new Set(["2025-04"]) });
    const apr = rows.find((r) => r.month === "2025-04")!.data;
    expect(apr).toMatchObject({ payingTotal: 3, payingMath: 1, payingInjaewon: 1, payingEie: 1, payingEnglish: 2, bridgedPaying: 1 });
    expect(apr).not.toHaveProperty("skippedPaying");
    // 건너뛰기만 하면 종전대로 비운다 · skipMonths에 없는 이음 달은 무시한다.
    const skipped = aywaHistoryMonths({ months, invoices, registrations: [], started: new Set(), classify, skipMonths: new Set(["2025-04"]) });
    expect(skipped.find((r) => r.month === "2025-04")!.data).toMatchObject({ skippedPaying: 1 });
    expect(skipped.find((r) => r.month === "2025-04")!.data).not.toHaveProperty("payingTotal");
    const plain = aywaHistoryMonths({ months, invoices, registrations: [], started: new Set(), classify, bridgeMonths: new Set(["2025-04"]) });
    expect(plain.find((r) => r.month === "2025-04")!.data).toMatchObject({ payingTotal: 1 });
    expect(plain.find((r) => r.month === "2025-04")!.data).not.toHaveProperty("bridgedPaying");
    expect(mergeHistory([{ month: "2025-04", source: "makeedu", data: apr }])[0]!.bridged).toBe(true);
    // 앞뒤 달 중 하나가 없거나 건너뛴 달이면 잇지 않고 종전대로 비운다.
    const edge = aywaHistoryMonths({ months: ["2025-04", "2025-05"], invoices, registrations: [], started: new Set(), classify, skipMonths: new Set(["2025-04"]), bridgeMonths: new Set(["2025-04"]) });
    expect(edge[0]!.data).toMatchObject({ skippedPaying: 1 });
    const both = aywaHistoryMonths({ months, invoices, registrations: [], started: new Set(), classify, skipMonths: new Set(["2025-04", "2025-05"]), bridgeMonths: new Set(["2025-04"]) });
    expect(both.find((r) => r.month === "2025-04")!.data).toMatchObject({ skippedPaying: 1 });
  });

  it("🔴 과목마다(원장 2026-10-28 *\"과목별로 분리가능한 수준까지\"*) — 그 밖의 과목을 `payingSubject:<키>`로도 · 건너뛴 달은 청구 칸을 비우고 표시만", () => {
    const subjects = [{ key: "math", label: "수학" }, { key: "english", label: "영어" }, { key: "science", label: "과학" }, { key: "korean", label: "국어" }];
    const invoices = [
      inv("a", "2025-03", [lesson("초등 과학 탐구"), lesson("중3 국어 화금2T")]),
      inv("b", "2025-03", [lesson("중2 국어 정규")]),
      inv("a", "2025-04", [lesson("초등 과학 탐구")]),
      inv("c", "2025-05", [lesson("수학 A")]),
    ];
    const classify = lessonProgramClassifier(lessonNameWeights(invoices), subjects);
    const rows = aywaHistoryMonths({
      months: ["2025-03", "2025-04", "2025-05"], invoices, registrations: [reg("c", "2025-04-03")], started: new Set(["c"]), classify, skipMonths: new Set(["2025-04"]),
    });
    expect(rows[0]!.data).toMatchObject({ payingOther: 2, "payingSubject:science": 1, "payingSubject:korean": 2 });
    // 학생 수 칸 없음 — 0이 아니라 '비움' · 실제로 들어온 수업료(돈)는 센다(비우는 것은 청구 건수 — 리뷰 2026-10-28)
    expect(rows[1]!.data).toEqual({ newRegistered: 1, newReal: 1, skippedPaying: 1, tuitionPaidGeneral: 100000 });
    expect(rows[2]!.data).toMatchObject({ payingMath: 1, "payingSubject:science": 0, "payingSubject:korean": 0 });
    const merged = mergeHistory(rows.map((r) => ({ month: r.month, source: "makeedu" as const, data: r.data })));
    expect(merged[0]!.subjects).toEqual({ science: 1, korean: 2 });
    expect(merged[1]!.skipped).toBe(true);
    expect(merged[1]!.payingGeneral).toBeUndefined();
    const [y] = yearlyHistory(merged);
    expect(y!.subjects).toEqual({ science: 1, korean: 1 }); // 값이 있는 달(3·5월) 평균
    expect(y!.subjectMonths).toEqual({ science: 2, korean: 2 });
    expect(withoutPaying(merged)[0]!.subjects).toBeUndefined(); // 수납 권한이 없으면 과목 칸도 뺀다
  });

  it("과목 칸 잇기 — 에이와가 청구 칸을 실으면 과목 묶음도 통째로 그쪽 · 건너뛴 표시도 풀린다 · 모양이 틀린 값은 버린다", () => {
    const merged = mergeHistory([
      { month: "2026-01", source: "makeedu", data: { enrolledRecord: 400, skippedPaying: 1, "payingSubject:korean": 3, "payingSubject:science": 2, "payingSubject:bad": -1 } },
      { month: "2026-01", source: "aywa", data: { payingGeneral: 330, "payingSubject:korean": 9 } },
      { month: "2026-02", source: "makeedu", data: { payingGeneral: 300, "payingSubject:korean": 3 } },
      { month: "2026-02", source: "aywa", data: { payingGeneral: 320, payingOther: 5 } }, // 과목 칸 없는 옛 밤 집계 — 메이크에듀 과목과 섞지 않는다
    ]);
    expect(merged[0]).toMatchObject({ enrolledRecord: 400, payingGeneral: 330, subjects: { korean: 9 } });
    expect(merged[0]!.subjects).toEqual({ korean: 9 });
    expect(merged[0]!.skipped).toBeUndefined();
    expect(merged[1]).toMatchObject({ payingGeneral: 320, payingOther: 5 });
    expect(merged[1]!.subjects).toBeUndefined();
    expect(parseHistoryData({ "payingSubject:": 4, "payingSubject:science": "3" }).subjects).toBeUndefined();
  });

  it("수업료 수납 — 수업 항목의 낸 돈에서 진행 중 환불을 뺀다(취소된 환불은 그대로) · 줄마다 낸 돈이 없으면 머리의 낸 돈을 금액 비율로 · 항목 없는 청구는 머리 전부", () => {
    const refunded = { ...lesson("수학 A", 300000), refunds: [{ status: "active", amount: 100000 }, { status: "cancelled", amount: 50000 }] };
    expect(lessonPaid([refunded, lesson("[EiE] Kopi", 200000), { kind: "교재", description: "교재", amount: 30000, paid: 30000 }], null)).toEqual({ general: 200000, eie: 200000 });
    expect(lessonPaid([{ kind: "tuition", description: "수학 A", amount: 300000 }, { kind: "교재", description: "교재", amount: 100000 }], 200000)).toEqual({ general: 150000, eie: 0 });
    expect(lessonPaid([], 120000)).toEqual({ general: 120000, eie: 0 });
    // 합쳐진 줄 — 환불은 원본 줄마다(맨 위엔 첫 원본 것만 남거나 없다) · 원본들의 환불을 더한다(재리뷰 2026-10-21).
    const merged = {
      ...lesson("수학 A+B", 600000),
      refunds: [{ status: "active", amount: 150000 }],
      sourceItems: [{ description: "수학 A", amount: 300000, refunds: [{ status: "active", amount: 150000 }] }, { description: "수학 B", amount: 300000 }],
    };
    expect(lessonPaid([merged], null)).toEqual({ general: 450000, eie: 0 });
  });
});
