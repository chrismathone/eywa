import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterSessionTermRows, shareClassIdsOf, TERM_ONLY_KEYS } from "./term-filter";

/**
 * 회차 확정 상단의 **'보기' 필터** — 확정 · 배분 · 몫을 드롭다운 하나에서 여러 개 고른다(원장 2026-10-07 *"JJ/LAB 몫 조정 따로 된거
 * 필터링 할 수 있게 회차 확정 상단에 필터 줄것. 확정 / 배분 / 몫 3개를 하나의 드랍다운으로 묶고 중복 체크가능하게"*).
 */
type Row = Parameters<typeof filterSessionTermRows>[0][number] & { id: string };
const row = (id: string, over: Partial<Row> = {}): Row => ({
  id, studentName: id, className: "A반", classId: "c-a", studentGrade: "중1", note: null, subject: "english",
  confirmedSessions: 8, termState: "term", allocatedAmount: 100000, allocationStale: false, ...over,
});
// A반(몫 조정한 반): 확정·배분 끝 / 미확정 / 미배분 · B반: 미확정+미배분 / 끝 · C반(수학): 미확정
const ROWS: Row[] = [
  row("a-done"),
  row("a-open", { confirmedSessions: null }),
  row("a-pending", { allocatedAmount: null }),
  row("b-both", { classId: "c-b", className: "B반", confirmedSessions: null, allocatedAmount: null }),
  row("b-done", { classId: "c-b", className: "B반" }),
  row("m-open", { classId: "c-m", className: "수학반", subject: "math", confirmedSessions: null }),
  row("x-noclass", { classId: null, className: null }),
];
const SHARE = new Set(["c-a"]);
const ids = (input: Parameters<typeof filterSessionTermRows>[1]) => filterSessionTermRows(ROWS, input).filtered.map((r) => r.id);

describe("보기 필터 — 하나의 값에서 여러 개", () => {
  it("아무것도 안 고르면 전부 · 하나씩은 종전 두 드롭다운과 같은 줄", () => {
    expect(ids({})).toHaveLength(ROWS.length);
    expect(ids({ only: "open" })).toEqual(["a-open", "b-both", "m-open"]);
    expect(ids({ only: "pending" })).toEqual(["a-pending", "b-both"]);
  });

  it("몫 = 그 달 자리 몫을 조정한 반의 줄 전부(반마다 조정하니 그 반 학생이 모두 선다)", () => {
    expect(ids({ only: "share", shareClassIds: SHARE })).toEqual(["a-done", "a-open", "a-pending"]);
  });

  it("🔴 여럿을 고르면 모두에 해당하는 줄만 — 미확정이면서 미배분 · 몫 조정한 반의 미확정", () => {
    expect(ids({ only: "open,pending" })).toEqual(["b-both"]);
    expect(ids({ only: "open,share", shareClassIds: SHARE })).toEqual(["a-open"]);
    expect(ids({ only: "pending,share", shareClassIds: SHARE })).toEqual(["a-pending"]);
    expect(ids({ only: "open,pending,share", shareClassIds: SHARE })).toEqual([]);
  });

  it("괄호 속 수는 서로를 거르지 않는다(과목·검색까지만) — 몫은 줄 수가 아니라 반 수", () => {
    const all = filterSessionTermRows(ROWS, { shareClassIds: SHARE });
    expect([all.openCount, all.pendingCount, all.shareCount]).toEqual([3, 2, 1]);
    const narrowed = filterSessionTermRows(ROWS, { only: "open,share", shareClassIds: SHARE });
    expect([narrowed.openCount, narrowed.pendingCount, narrowed.shareCount]).toEqual([3, 2, 1]);
    // 과목으로 좁히면 그 과목 안에서 다시 센다 — 수학에는 몫을 조정한 반이 없다.
    const math = filterSessionTermRows(ROWS, { subject: "math", shareClassIds: SHARE });
    expect([math.openCount, math.pendingCount, math.shareCount]).toEqual([1, 0, 0]);
    expect(filterSessionTermRows(ROWS, { shareClassIds: new Set(["c-a", "c-b"]) }).shareCount).toBe(2);
  });

  it("🔴 몫 재료를 모르면(권한 없음 · 조회 실패) 몫 필터는 꺼진 것으로 읽는다 — 표가 통째로 비지 않는다", () => {
    for (const shareClassIds of [null, undefined]) {
      const out = filterSessionTermRows(ROWS, { only: "share", shareClassIds });
      expect(out.shareOnly).toBe(false);
      expect(out.only).toEqual([]);
      expect(out.filtered).toHaveLength(ROWS.length);
      expect(out.shareCount).toBe(0);
    }
    // 아는데 조정한 반이 없으면 그건 '없음'이다 — 켜진 채로 0줄.
    const none = filterSessionTermRows(ROWS, { only: "share", shareClassIds: new Set() });
    expect(none.shareOnly).toBe(true);
    expect(none.filtered).toEqual([]);
  });

  it("켜진 필터는 선택지 순서로 정리된다 — 주소·엑셀 링크·드롭다운 값이 같은 한 벌 · 모르는 값은 버린다", () => {
    expect(TERM_ONLY_KEYS).toEqual(["open", "pending", "share", "carry"]);
    expect(filterSessionTermRows(ROWS, { only: "share,open", shareClassIds: SHARE }).only).toEqual(["open", "share"]);
    expect(filterSessionTermRows(ROWS, { only: " pending , nope,,all", shareClassIds: SHARE }).only).toEqual(["pending"]);
    expect(filterSessionTermRows(ROWS, { only: "" }).only).toEqual([]);
  });

  it("옛 주소(드롭다운이 둘이던 때의 `allocation=pending` · `confirmation=open`)도 그대로 읽고 새 꼴로 정리한다", () => {
    const old = filterSessionTermRows(ROWS, { allocation: "pending", confirmation: "open" });
    expect(old.filtered.map((r) => r.id)).toEqual(["b-both"]);
    expect(old.only).toEqual(["open", "pending"]);
    expect(old.pendingOnly && old.openOnly).toBe(true);
    // 섞여 들어와도 합쳐 읽는다.
    expect(filterSessionTermRows(ROWS, { only: "share", confirmation: "open", shareClassIds: SHARE }).only).toEqual(["open", "share"]);
    expect(filterSessionTermRows(ROWS, { allocation: "other", confirmation: "nope" }).only).toEqual([]);
  });

  it("반이 없는 줄은 몫 필터에 걸리지 않는다 · 재료 → 반 id 집합", () => {
    expect(ids({ only: "share", shareClassIds: SHARE })).not.toContain("x-noclass");
    expect(shareClassIdsOf(null)).toBeNull();
    expect(shareClassIdsOf(undefined)).toBeNull();
    expect([...shareClassIdsOf({ adjusted: { "c-a": [{}], "c-b": [{}] } })!]).toEqual(["c-a", "c-b"]);
    expect(shareClassIdsOf({ adjusted: {} })!.size).toBe(0);
  });
});

describe("배선 — 화면과 엑셀이 같은 줄 집합", () => {
  // 줄바꿈은 LF로 맞춰 읽는다 — 여러 줄 문자열을 찾는 단언이 CRLF로 받은 작업본에서도 같게 돈다.
  const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

  it("회차 확정 상단의 상태 필터는 드롭다운 하나(다중 선택)다 — 확정 · 배분 드롭다운을 따로 되살리지 않는다", () => {
    const face = read("src/app/(shell)/billing/_components/session-terms-face.tsx");
    expect(face).toContain('paramName="only"\n          multiple');
    expect(face).not.toContain('paramName="confirmation"');
    expect(face).not.toContain('paramName="allocation"');
    // 옛 주소의 두 파라미터는 고르는 순간 지운다(남으면 지운 필터가 되살아난다).
    expect(face).toContain('clearParams={["confirmation", "allocation"]}');
    // 몫 항목은 자리 몫 줄이 서는 화면에만(같은 조회 · 같은 문).
    expect(face).toContain("...(seatShare ? [{ value: \"share\"");
    expect(face).toContain("shareClassIds: shareClassIdsOf(seatShare)");
    // 페이지가 주소의 값을 넘긴다.
    expect(read("src/app/(shell)/billing/page.tsx")).toContain("only={sp.only}");
  });

  it("🔴 엑셀 내보내기도 같은 필터를 같은 재료로 지난다 — 화면에 보이는 줄과 파일의 줄이 갈리지 않는다", () => {
    const face = read("src/app/(shell)/billing/_components/session-terms-face.tsx");
    expect(face).toContain('...(onlyKeys.length > 0 ? { only: onlyKeys.join(",") } : {}),');
    const route = read("src/app/api/exports/session-terms/route.ts");
    expect(route).toContain('const only = url.searchParams.get("only") ?? undefined;');
    expect(route).toContain('parseMulti(only).includes("share") ? loadSeatShareSummary(period) : null,');
    expect(route).toContain("shareClassIds: shareClassIdsOf(seatShare),");
    // 몫으로 걸러 달라는데 재료를 못 읽었으면(권한은 있는 계정) 파일을 내주지 않는다 — 전체 줄이 걸러진 척 실리지 않게.
    expect(route).toContain('if (parseMulti(only).includes("share") && !seatShare && (await attendanceSalaryAdminOrNull())) {');
    expect(route).toContain("{ status: 503 }");
  });

  it("사용 설명서의 번호가 이 드롭다운을 가리킨다 — 이름을 바꾸면 설명서 촬영이 '칸이 화면에 없음'으로 멈춘다", () => {
    const face = read("src/app/(shell)/billing/_components/session-terms-face.tsx");
    expect(face).toContain('ariaLabel="확정·배분·몫 보기 필터"');
    const manual = JSON.parse(read("docs/manual/pages/billing/sessions.json")) as { callouts: { n: number; target: { css?: string } }[] };
    expect(manual.callouts.map((c) => c.n)).toEqual(manual.callouts.map((_, i) => i + 1));
    expect(manual.callouts.some((c) => c.target.css === '[aria-label^="확정·배분·몫 보기 필터"]')).toBe(true);
    // 없어진 두 드롭다운을 가리키는 번호가 남지 않았다.
    expect(JSON.stringify(manual)).not.toMatch(/확정 상태 필터|배분 상태 필터|미확정만 보기|미배분만 보기/);
  });
});

describe("보기 필터 — 이월 재확인(2026-11-09)", () => {
  // 확정 5시수(120,000) · 배분 120,000 · 10월로 24,000을 넘겨 둠 → 더 받은 몫 0이라 무효.
  const out = { amount: 24000, toClassId: "c-b", toClassName: "B반", toPeriod: "2026-10", note: null, at: null };
  const inn = (valid: boolean, orphan = false) => ({ amount: 24000, fromPeriod: "2026-08", fromClassName: "A반", note: null, valid, ...(orphan ? { orphan } : {}) });
  const CARRY: Row[] = [
    row("ok"),
    row("send-bad", { amount: 120000, allocatedAmount: 120000, carryOut: out }),
    row("send-ok", { amount: 96000, allocatedAmount: 120000, carryOut: out }),
    row("send-orphan", { amount: 96000, allocatedAmount: 120000, carryOut: { ...out, landing: "orphan" } }),
    row("recv-bad", { amount: 120000, carryIns: [inn(false)] }),
    row("recv-orphan", { amount: 120000, carryIns: [inn(true, true)] }),
    row("recv-ok", { amount: 120000, carryIns: [inn(true)] }),
  ];
  it("보낸 이월 무효·받을 반 없음 · 받은 이월 무효·받을 곳 없음만 — 표 표식과 같은 기준", () => {
    const r = filterSessionTermRows(CARRY, { only: "carry" });
    expect(r.filtered.map((x) => x.id)).toEqual(["send-bad", "send-orphan", "recv-bad", "recv-orphan"]);
    expect(r.carryCount).toBe(4);
    expect(r.only).toEqual(["carry"]);
    // 다른 필터와는 '모두에 해당'으로 묶인다.
    expect(filterSessionTermRows(CARRY, { only: "carry,open" }).filtered).toEqual([]);
  });
});
