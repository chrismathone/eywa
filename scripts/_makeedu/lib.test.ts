import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const L = require_("./lib.cjs") as {
  normalizeName: (v: unknown) => string;
  stripNameStatusSuffix: (v: unknown) => string;
  billingMonthRange: (a?: {
    anchor?: string | null;
    months?: number;
    today?: string | Date;
  }) => { from: string; to: string };
  summarizeFailures: (
    failed: { domain: string; reason?: string }[] | null | undefined,
    opts?: { maxReason?: number; maxError?: number },
  ) => { domains: string[]; reasons: Record<string, string>; error: string | null };
  splitDuplicatePushRequests: (
    reqs: { requestId: string; consultationId: string }[] | null | undefined,
  ) => {
    unique: { requestId: string; consultationId: string }[];
    duplicates: { requestId: string; consultationId: string }[];
  };
};

// 화면 두 곳(연동 면 · 콜&상담 머리글)에서 같은 상담을 거의 동시에 보내면 대기 행이 둘 생길 수 있다 —
// 워커는 상담 행을 묶음 시작 때 한 번만 읽어 둘 다 제출하므로, 묶음 안에서 첫 요청만 남긴다(2026-10-01).
describe("splitDuplicatePushRequests — 같은 상담은 한 묶음에서 한 번만 제출", () => {
  it("첫 요청만 남기고 순서를 유지한다", () => {
    const { unique, duplicates } = L.splitDuplicatePushRequests([
      { requestId: "r1", consultationId: "c1" },
      { requestId: "r2", consultationId: "c2" },
      { requestId: "r3", consultationId: "c1" },
      { requestId: "r4", consultationId: "c1" },
    ]);
    expect(unique.map((r) => r.requestId)).toEqual(["r1", "r2"]);
    expect(duplicates.map((r) => r.requestId)).toEqual(["r3", "r4"]);
  });

  it("겹침이 없으면 그대로 · 빈 입력도 안전", () => {
    expect(L.splitDuplicatePushRequests([{ requestId: "r1", consultationId: "c1" }]).duplicates).toEqual([]);
    expect(L.splitDuplicatePushRequests(null)).toEqual({ unique: [], duplicates: [] });
  });
});

// 실패했는데 **왜인지 안 남으면** 그 실패는 다음에 또 난다(2026-08-03 06:00 partial 실행 = 원인 추적 불가).
describe("summarizeFailures — 부분 실패의 사유를 DB로 실어 보낸다", () => {
  it("도메인·사유·합본 문자열 세 조각을 만든다", () => {
    const out = L.summarizeFailures([
      { domain: "invoices", reason: "import-invoices.cjs exited 1 — 스크랩 0행" },
      { domain: "textbook_checks", reason: "mirror-textbook-checks.cjs exited 1 — invoices.json 필수 헤더 누락" },
    ]);
    expect(out.domains).toEqual(["invoices", "textbook_checks"]);
    expect(out.reasons.invoices).toContain("스크랩 0행");
    expect(out.error).toContain("invoices: ");
    expect(out.error).toContain("textbook_checks: ");
  });

  it("실패가 없으면 error는 null — 빈 문자열이면 화면이 '원인 있음'으로 오해한다", () => {
    expect(L.summarizeFailures([]).error).toBeNull();
    expect(L.summarizeFailures(null).error).toBeNull();
    expect(L.summarizeFailures(undefined).domains).toEqual([]);
  });

  it("사유가 비어도 도메인은 남기고 '원인 미상'으로 표기한다(조용히 빈칸 금지)", () => {
    const out = L.summarizeFailures([{ domain: "invoices" }]);
    expect(out.domains).toEqual(["invoices"]);
    expect(out.error).toBe("invoices: 원인 미상");
  });

  it("긴 사유는 잘라 컬럼을 넘치지 않게 한다", () => {
    const out = L.summarizeFailures([{ domain: "invoices", reason: "가".repeat(5000) }], {
      maxReason: 50,
      maxError: 80,
    });
    expect(out.reasons.invoices).toHaveLength(50);
    expect(out.error!.length).toBeLessThanOrEqual(80);
  });
});

// 이 범위가 곧 "동기화가 볼 수 있는 세계"다. 여기서 한 달을 놓치면 그 달이 통째로 동결된다.
describe("billingMonthRange — 스크랩할 청구월 범위", () => {
  // 🔴🔴 2026-07-31 실측 사고 — makeedu는 **선청구**라 달력 7월에 이미 청구월이 2026-08이었다.
  // 달력으로 계산해 2026-05~07을 넣었더니 **살아있는 2026-08이 통째로 빠졌고**, 그 달 360건이
  // 한 번도 갱신되지 않아 미수 ₩54M이 옛 스냅샷으로 굳었다. 앵커는 반드시 makeedu가 말하는 청구월이다.
  it("앵커(화면의 현재 청구월)를 기준으로 잡는다 — 달력 월이 아니다", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", months: 3, today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
  });

  it("앵커가 `YYYYMM` 형식이어도 읽는다", () => {
    expect(L.billingMonthRange({ anchor: "202608", months: 2, today: "2026-07-31" })).toEqual({
      from: "2026-07",
      to: "2026-08",
    });
  });

  // 화면 값을 못 읽었을 때 달력 당월만 잡으면 같은 사고가 재현된다 → 선청구를 감안해 한 달 더 넓게.
  it("앵커가 없으면 달력 당월 +1까지 본다(선청구 대비, 빈 달은 무해)", () => {
    expect(L.billingMonthRange({ anchor: null, months: 3, today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
    expect(L.billingMonthRange({ months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });

  // 화면 값이 과거로 굳어 있는 이상 상황 — 그걸 그대로 믿으면 현재 달을 또 놓친다.
  it("앵커가 달력 당월보다 과거면 달력 당월을 쓴다", () => {
    expect(L.billingMonthRange({ anchor: "2026-05", months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-07",
      to: "2026-07",
    });
  });

  it("1개월이면 앵커 달만", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", months: 1, today: "2026-07-31" })).toEqual({
      from: "2026-08",
      to: "2026-08",
    });
  });

  // 🔴 연말 경계 — 여기서 틀리면 12월 청구가 통째로 안 잡힌다.
  it("연을 넘어간다", () => {
    expect(L.billingMonthRange({ anchor: "2026-01", months: 3, today: "2025-12-20" })).toEqual({
      from: "2025-11",
      to: "2026-01",
    });
    expect(L.billingMonthRange({ anchor: "2026-02", months: 6, today: "2026-01-10" })).toEqual({
      from: "2025-09",
      to: "2026-02",
    });
  });

  it("월은 항상 2자리(makeedu 입력 형식 YYYY-MM)", () => {
    const r = L.billingMonthRange({ anchor: "2026-10", months: 3, today: "2026-09-15" });
    expect(r).toEqual({ from: "2026-08", to: "2026-10" });
    expect(r.from).toMatch(/^\d{4}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}$/);
  });

  // env `MAKEEDU_INVOICE_MONTHS`를 사람이 손으로 넣는 자리라 쓰레기 값이 실제로 들어올 수 있다.
  it("0·음수·NaN은 최소 1개월로 클램프한다", () => {
    for (const bad of [0, -3, NaN])
      expect(L.billingMonthRange({ anchor: "2026-08", months: bad, today: "2026-07-31" })).toEqual({
        from: "2026-08",
        to: "2026-08",
      });
  });

  it("미지정(undefined)은 기본 3개월", () => {
    expect(L.billingMonthRange({ anchor: "2026-08", today: "2026-07-31" })).toEqual({
      from: "2026-06",
      to: "2026-08",
    });
  });

  it("인자 없이도 죽지 않는다(달력 폴백)", () => {
    const r = L.billingMonthRange();
    expect(r.from).toMatch(/^\d{4}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 2026-07-31 실측 사고 — makeedu는 목록에서 원생 상태를 **이름 뒤 괄호**로 표시한다(`강윤서(퇴)`).
// 재원생만 보던 시절엔 볼 일이 없다가, 원생상태를 '전체'로 바꾸는 순간 나타나 매칭을 깨뜨렸다
// (3,459라인 중 350건 = 10% 미매칭). 매칭이 깨지면 그 청구가 "makeedu에 없다"로 읽혀 **삭제된다** —
// 강윤서·박수빈·김나율A·김경진이 실제로 그렇게 무효 처리됐다(makeedu엔 멀쩡히 있는데도).
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeName — 상태 접미사", () => {
  it("makeedu의 상태 접미사를 벗겨 aywa 이름과 매칭된다", () => {
    expect(L.normalizeName("강윤서(퇴)")).toBe(L.normalizeName("강윤서"));
    expect(L.normalizeName("박수빈(퇴)")).toBe("박수빈");
    for (const suf of ["(퇴)", "(퇴원)", "(휴)", "(휴원)", "(졸)", "(졸업)"])
      expect(L.normalizeName(`김경진${suf}`)).toBe("김경진");
  });

  it("접미사 뒤 공백도 흡수한다", () => {
    expect(L.normalizeName("김나율A(퇴) ")).toBe("김나율a");
  });

  // ⚠️ 괄호를 통째로 벗기면 aywa의 실제 이름(`박소선 (테스트)`)이 다른 사람과 충돌한다.
  it("상태 표시가 아닌 괄호는 **건드리지 않는다**(충돌 방지)", () => {
    expect(L.normalizeName("박소선 (테스트)")).toBe("박소선(테스트)");
    expect(L.normalizeName("원일(테스트)")).toBe("원일(테스트)");
    expect(L.normalizeName("박소선 (테스트)")).not.toBe(L.normalizeName("박소선"));
  });

  it("이름 중간의 상태 표기는 접미사가 아니므로 남긴다", () => {
    expect(L.normalizeName("김(퇴)수")).toBe("김(퇴)수");
  });

  it("기존 동작(공백 제거·소문자)은 그대로", () => {
    expect(L.normalizeName(" 이 윤 슬 ")).toBe("이윤슬");
    expect(L.normalizeName("Kim A")).toBe("kima");
    expect(L.normalizeName(null)).toBe("");
  });

  it("stripNameStatusSuffix는 표시용 원형을 유지한다(공백·대소문자 보존)", () => {
    expect(L.stripNameStatusSuffix("박소선 (테스트)")).toBe("박소선 (테스트)");
    expect(L.stripNameStatusSuffix("강윤서(퇴)")).toBe("강윤서");
  });
});
