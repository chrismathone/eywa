/**
 * 묵은 미납 재대조 판단부 — **돈을 지우는 규칙**이라 단위테스트로 못박는다.
 * 규칙의 출처는 원장 지시(2026-08-31): 대상은 장기미납·상태변경자만 · 없으면 삭제하되 **4회째** · 메모를 남긴다.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const P = require_("./reconcile-plan.cjs") as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const inv = (p: Record<string, unknown> = {}) => ({
  id: "i1",
  student_id: "s1",
  period: "2026-03",
  status: "unpaid",
  amount_total: 654000,
  amount_discount: 0,
  amount_paid: 0,
  notes: null,
  ...p,
});

const TODAY = "2026-08-31";
const WINDOW_FROM = "2026-07"; // 매일 도는 동기화가 보는 가장 이른 달

describe("pickTargets — 누구를 다시 보는가", () => {
  it("① 창 밖에 미수가 남은 청구는 대상", () => {
    const { pairs } = P.pickTargets({ invoices: [inv()], students: [], today: TODAY, windowFrom: WINDOW_FROM });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toBe("장기미납");
  });

  it("🔴 완납·무효는 대상이 아니다(원장: 완납은 당연히 건너뛰고)", () => {
    const rows = [
      inv({ id: "paid", status: "paid", amount_paid: 654000 }),
      inv({ id: "void", status: "void" }),
      inv({ id: "zero", status: "partial", amount_paid: 644000, amount_discount: 10000 }), // 잔액 0
    ];
    const { pairs } = P.pickTargets({ invoices: rows, students: [], today: TODAY, windowFrom: WINDOW_FROM });
    expect(pairs).toHaveLength(0);
  });

  it("창 안(매일 도는 범위)은 대상이 아니다 — 이미 맞춰지고 있다", () => {
    const { pairs } = P.pickTargets({
      invoices: [inv({ period: "2026-08" })],
      students: [],
      today: TODAY,
      windowFrom: WINDOW_FROM,
    });
    expect(pairs).toHaveLength(0);
  });

  it("② 최근 퇴원·휴원자는 **완납이어도** 대상(환불이 거기서 난다)", () => {
    const rows = [inv({ id: "p", status: "paid", amount_paid: 654000, period: "2026-06" })];
    const students = [{ id: "s1", status: "withdrawn", changed_on: "2026-06-20" }];
    const { pairs } = P.pickTargets({ invoices: rows, students, today: TODAY, windowFrom: WINDOW_FROM });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toBe("상태변경");
  });

  it("🔴 ② 축은 **바뀐 달 언저리**만 본다 — 6개월을 통째로 잡으면 완납 수백 건이 딸려 온다", () => {
    const students = [{ id: "s1", status: "withdrawn", changed_on: "2026-06-20" }];
    const far = [inv({ status: "paid", amount_paid: 1, period: "2026-03" })]; // 퇴원 석 달 전 완납
    expect(P.pickTargets({ invoices: far, students, today: TODAY, windowFrom: WINDOW_FROM }).pairs).toHaveLength(0);
    const near = [inv({ status: "paid", amount_paid: 1, period: "2026-05" })]; // 직전 달
    expect(P.pickTargets({ invoices: near, students, today: TODAY, windowFrom: WINDOW_FROM }).pairs).toHaveLength(1);
  });

  it("② 축은 오래된 사람·오래된 달로 번지지 않는다", () => {
    const students = [{ id: "s1", status: "withdrawn", changed_on: "2026-01-05" }]; // 90일보다 전
    expect(
      P.pickTargets({ invoices: [inv({ status: "paid", amount_paid: 1 })], students, today: TODAY, windowFrom: WINDOW_FROM })
        .pairs,
    ).toHaveLength(0);

    const recent = [{ id: "s1", status: "withdrawn", changed_on: "2026-06-20" }];
    expect(
      P.pickTargets({
        invoices: [inv({ status: "paid", amount_paid: 1, period: "2026-01" })], // 바뀐 달 언저리 밖
        students: recent,
        today: TODAY,
        windowFrom: WINDOW_FROM,
      }).pairs,
    ).toHaveLength(0);
  });

  it("재원생은 상태 변경 축에 안 걸린다(완납은 건너뛴다)", () => {
    const students = [{ id: "s1", status: "enrolled", changed_on: "2026-08-20" }];
    expect(
      P.pickTargets({ invoices: [inv({ status: "paid", amount_paid: 1 })], students, today: TODAY, windowFrom: WINDOW_FROM })
        .pairs,
    ).toHaveLength(0);
  });

  it("스크랩할 청구월 범위를 함께 돌려준다", () => {
    const { from, to } = P.pickTargets({
      invoices: [inv({ period: "2026-02" }), inv({ id: "i2", period: "2026-05" })],
      students: [],
      today: TODAY,
      windowFrom: WINDOW_FROM,
    });
    expect(from).toBe("2026-02");
    expect(to).toBe("2026-05");
  });
});

describe("planOutcomes — 있으면 맞추고, 없으면 센다", () => {
  const t = [inv()];

  it("makeedu에 있으면 갱신 대상", () => {
    const r = P.planOutcomes({ targets: t, scrapedKeys: new Set(["s1|2026-03"]), today: TODAY });
    expect(r.upsert).toHaveLength(1);
    expect(r.bump).toHaveLength(0);
  });

  it("🔴 없으면 1회차엔 지우지 않고 센다 + 메모", () => {
    const r = P.planOutcomes({ targets: t, scrapedKeys: new Set(), today: TODAY });
    expect(r.voidable).toHaveLength(0);
    expect(r.bump).toHaveLength(1);
    expect(r.bump[0].count).toBe(1);
    expect(r.bump[0].marker).toContain("확인 안 됨 1/4회");
    expect(r.bump[0].marker).toContain("3회 더");
  });

  it("🔴 4회째에 무효 — 3회는 대기(원장 지시)", () => {
    for (const [n, expectVoid] of [
      [1, false],
      [2, false],
      [3, true],
    ] as const) {
      const prior = `[동기화] 2026-08-24 makeedu에서 확인 안 됨 ${n}/4회 — 대기`;
      const r = P.planOutcomes({ targets: [inv({ notes: prior })], scrapedKeys: new Set(), today: TODAY });
      expect(r.voidable.length === 1, `누적 ${n}회`).toBe(expectVoid);
    }
  });

  it("무효 메모엔 직전 상태·금액이 남는다(되돌릴 근거)", () => {
    const prior = "[동기화] 2026-08-24 makeedu에서 확인 안 됨 3/4회 — 대기";
    const r = P.planOutcomes({ targets: [inv({ notes: prior })], scrapedKeys: new Set(), today: TODAY });
    expect(r.voidable[0].marker).toContain("삭제 확인");
    expect(r.voidable[0].marker).toContain("654,000원");
    expect(r.voidable[0].marker).toContain("unpaid");
  });

  it("🔴 관측을 못 믿는 실행에서는 **세지도 않는다**", () => {
    const low = P.planOutcomes({ targets: t, scrapedKeys: new Set(), coverage: { "2026-03": 0.5 }, today: TODAY });
    expect(low.hold).toHaveLength(1);
    expect(low.bump).toHaveLength(0);

    const bad = P.planOutcomes({ targets: t, scrapedKeys: new Set(), unmatchedRatio: 0.2, today: TODAY });
    expect(bad.hold).toHaveLength(1);
    expect(bad.bump).toHaveLength(0);
  });

  it("다시 나타나면 미확인 기록을 지운다(self-healing)", () => {
    const prior = "[동기화] 2026-08-24 makeedu에서 확인 안 됨 2/4회 — 대기";
    const r = P.planOutcomes({ targets: [inv({ notes: prior })], scrapedKeys: new Set(["s1|2026-03"]), today: TODAY });
    expect(r.upsert[0].clearMarker).toBe(true);
  });
});

describe("메모 다루기 — 사용자 메모를 먹지 않는다", () => {
  it("마커만 갈아 끼운다", () => {
    const notes = "[동기화] 2026-08-24 makeedu에서 확인 안 됨 1/4회\n학부모 요청으로 분납";
    const next = P.withMarker("[동기화] 새 마커", notes);
    expect(next).toBe("[동기화] 새 마커\n학부모 요청으로 분납");
  });

  it("마커가 없던 메모 앞에 붙인다", () => {
    expect(P.withMarker("[동기화] 새 마커", "분납 약속")).toBe("[동기화] 새 마커\n분납 약속");
  });

  it("메모가 없으면 마커만", () => {
    expect(P.withMarker("[동기화] 새 마커", null)).toBe("[동기화] 새 마커");
  });

  it("횟수는 마커에서만 읽는다(사람이 지우면 0 = 삭제가 늦어질 뿐)", () => {
    expect(P.parseMissCount(null)).toBe(0);
    expect(P.parseMissCount("분납 약속")).toBe(0);
    expect(P.parseMissCount("[동기화] 2026-08-24 makeedu에서 확인 안 됨 3/4회")).toBe(3);
  });
});

describe("🔴 다른 스크립트에 넘기는 플래그는 그쪽이 실제로 읽는 이름이어야 한다", () => {
  // 2026-08-31 실측: `--lists=invoices`로 적었는데 scrape는 `--list=`(단수)만 읽는다 →
  // **에러 없이 무시**되어 전 목록을 긁었다(결과는 맞고 시간만 몇 배). 오타가 조용히 넘어가는 자리라 잠근다.
  const read = (f: string) => readFileSync(join(process.cwd(), "scripts", "_makeedu", f), "utf8");

  it("scrape에 넘기는 목록 플래그", () => {
    const caller = read("reconcile-invoices.cjs");
    const flag = /scrape\.cjs"\), "(--[a-z-]+)=/.exec(caller)?.[1];
    expect(flag, "reconcile-invoices가 scrape에 넘기는 플래그").toBeTruthy();
    expect(read("scrape.cjs")).toContain(`startsWith("${flag}=")`);
  });

  it("import-invoices에 넘기는 플래그들", () => {
    const caller = read("reconcile-invoices.cjs");
    const importer = read("import-invoices.cjs");
    expect(caller).toContain("--only-pairs=");
    expect(importer).toContain('startsWith("--only-pairs=")');
    expect(caller).toContain("--no-void-stale");
    expect(importer).toContain('includes("--no-void-stale")');
  });

  it("스크랩 범위 env 이름이 양쪽에서 같다", () => {
    for (const key of ["MAKEEDU_INVOICE_FROM", "MAKEEDU_INVOICE_TO"]) {
      expect(read("reconcile-invoices.cjs"), key).toContain(key);
      expect(read("scrape.cjs"), key).toContain(key);
    }
  });
});

describe("🔴 첫 실전 실행에서 잡힌 두 가지 — 월별 스크랩 · 이름 매칭", () => {
  // 2026-08-31 실측: ① 5개월을 한 번에 요청했더니 makeedu 목록이 **10페이지(≈5,000행)** 에서 멈춰
  //    6,227행 중 5,012행만 걷혔다(뒤쪽 달 2026-06은 33행). ② 화면 표엔 `원생고유번호` 열이 **없다**
  //    (엑셀에만 있다) — 그래서 존재 확인이 전부 빗나가 '있음 0'이 됐다. 둘 다 조용히 틀리는 자리라 잠근다.
  const src = () => readFileSync(join(process.cwd(), "scripts", "_makeedu", "reconcile-invoices.cjs"), "utf8");

  it("한 달씩 따로 긁는다(범위를 한 번에 넘기지 않는다)", () => {
    const code = src();
    expect(code).toMatch(/MAKEEDU_INVOICE_FROM: m,\s*MAKEEDU_INVOICE_TO: m/);
    expect(code, "targetMonths를 돌며 스크랩").toMatch(/for \(const m of targetMonths\)/);
  });

  it("학생 매칭은 이름+학년 매처를 쓴다(원생고유번호에만 기대지 않는다)", () => {
    const code = src();
    expect(code).toContain("L.tieredMatcher");
    expect(code).toContain("L.normalizeName");
  });

  it("이름 매칭에 실패한 학생은 그 회차에 판정하지 않는다", () => {
    expect(src()).toMatch(/unmatchedNames\.has\(L\.normalizeName\(s\.name\)\)/);
  });
});

describe("countMatches — 화면이 말한 수와 맞나(양쪽 다 본다)", () => {
  // 2026-08-31 연동 PC 실측: 2026-03이 "화면 906건인데 1,226행 수집"으로 나왔다. 덜 걷힌 것만 막으면
  // 이 회차가 그대로 판정에 쓰이고, 페이지 경계 중복이 섞였다면 그 학생 금액이 부풀어 저장된다.
  it("딱 맞으면 통과", () => {
    expect(P.countMatches(1306, 1306)).toBe(true);
  });

  it("합계행 몇 줄(5줄·0.5% 이내)은 통과", () => {
    expect(P.countMatches(1310, 1306)).toBe(true);
    expect(P.countMatches(1300, 1306)).toBe(true);
  });

  it("🔴 크게 넘치면 막는다(중복 수집 = 금액 부풀림)", () => {
    expect(P.countMatches(1226, 906)).toBe(false);
  });

  it("🔴 크게 모자라면 막는다(절단 = 삭제 오판)", () => {
    expect(P.countMatches(5012, 6227)).toBe(false);
    expect(P.countMatches(33, 1300)).toBe(false);
  });

  it("화면이 총건수를 안 알려주면 이 판정은 안 한다(다른 가드에 맡긴다)", () => {
    expect(P.countMatches(10, null)).toBe(true);
  });
});
