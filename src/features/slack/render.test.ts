import { describe, expect, it } from "vitest";
import { renderActivity, renderAggregate, renderDigest, renderNotification, scrubSensitive } from "./render";
import { moneyFacts } from "./money-facts";

const at = (kst: string) => new Date(`${kst}+09:00`);
const style = { template: "short" as const, appUrl: "https://www.aywa.co.kr", ping: "none" as const };
const notif = { type: "approval_requested", title: "결재 요청", body: "박지현 · 10월 교재 구입 품의", link: "/approvals/1", createdAt: at("2026-09-28T15:00:00") };

describe("알림", () => {
  it("짧게 = 머리 + 한 줄 본문 + 링크", () => {
    expect(renderNotification(notif, style).body).toBe(
      "*[결재 요청] 결재 요청*\n박지현 · 10월 교재 구입 품의\n<https://www.aywa.co.kr/approvals/1|에이와에서 열기>",
    );
  });
  it("자세히 + 받는 사람(멘션) + @here", () => {
    const r = renderNotification(notif, { ...style, template: "detailed", ping: "here" }, ["<@U123>"]);
    expect(r.body.startsWith("<!here> *[결재 요청]")).toBe(true);
    expect(r.body).toContain("받는 사람: <@U123>");
    expect(r.groupLabel).toBe("결재 요청");
  });
  it("제목 속 <!channel>은 호출이 되지 않는다", () => {
    expect(renderNotification({ ...notif, title: "<!channel> 긴급" }, style).body).not.toContain("<!channel>");
  });
});

describe("활동", () => {
  const ev = { label: "학생 등록", opaque: false, targetLabel: "김하늘(중2)", actorName: "박소선", createdAt: at("2026-09-28T09:05:00") };
  it("짧게 = [라벨] 대상 — 누가", () => {
    expect(renderActivity(ev, style)).toEqual({ body: "*[학생 등록]* 김하늘(중2) — 박소선", groupLabel: "학생 등록 — 박소선" });
  });
  it("돈 계열(opaque)은 대상을 싣지 않는다", () => {
    expect(renderActivity({ ...ev, label: "청구서 생성", opaque: true, targetLabel: "김하늘 450,000원" }, style).body).toBe(
      "*[청구서 생성]* — 박소선",
    );
  });
  it("자세히 = 시각 · 감사로그 링크 · 이름은 첫 줄에 한 번만(원장 2026-09-29 중복 표기)", () => {
    const b = renderActivity({ ...ev, actorName: null }, { ...style, template: "detailed" }).body;
    expect(b).toBe("*[학생 등록]* 김하늘(중2) — 시스템\n_09:05_ · <https://www.aywa.co.kr/owner?tab=audit|감사로그에서 보기>");
    expect(b.match(/시스템/g)).toHaveLength(1);
  });
  const facts = {
    brief: ["김하늘", "중등M 중1 A", "9/28(월) 17:15"],
    rows: [{ label: "학생", value: "김하늘 (칠성중1)" }, { label: "반", value: "중등M 중1 A · 수학" }],
    href: "/students/s1",
  };
  it("facts = 짧게 한 줄에 누구의 무엇 · 자세히는 표 줄 + 학생 화면 링크 · 첫 줄은 두 모양이 같다", () => {
    const e = { ...ev, label: "수업보고서 저장", targetLabel: null, category: "reports", facts };
    const short = renderActivity(e, style).body;
    expect(short).toBe("📝 *[수업보고서 저장]* 김하늘 · 중등M 중1 A · 9/28(월) 17:15 — 박소선");
    const long = renderActivity(e, { ...style, template: "detailed" }).body;
    expect(long.split("\n")[0]).toBe(short);
    expect(long).toContain(">학생  김하늘 (칠성중1)");
    expect(long).toContain("<https://www.aywa.co.kr/students/s1|에이와에서 열기>");
  });
  it("대상 칸에 이미 든 이름은 다시 붙이지 않는다", () => {
    const e = { ...ev, label: "보강 예약", targetLabel: "김하늘 · 중등M 중1 A", facts };
    expect(renderActivity(e, style).body).toBe("*[보강 예약]* 김하늘 · 중등M 중1 A · 9/28(월) 17:15 — 박소선");
  });
  it("돈 계열(opaque)은 facts도 싣지 않는다", () => {
    const b = renderActivity({ ...ev, opaque: true, facts }, { ...style, template: "detailed" }).body;
    expect(b).not.toContain("김하늘");
  });
  it("지출결의서는 분류·지출일·금액만(원장 2026-09-29 ③) — 제목은 여전히 안 싣는다", () => {
    const money = moneyFacts("expense_create", { amount: 125000, currency: "KRW", category: "운영비", expenseDate: "2026-09-28", memo: "010-1234-5678" });
    const e = { ...ev, label: "지출결의서 작성", opaque: true, targetLabel: "복사기 토너 구입", facts, moneyFacts: money };
    expect(renderActivity(e, style).body).toBe("*[지출결의서 작성]* 운영비 · 지출일 9/28(월) · ₩125,000 — 박소선");
    const d = renderActivity(e, { ...style, template: "detailed" }).body;
    expect(d).toContain(">금액  ₩125,000");
    expect(d).not.toContain("토너");
    expect(d).not.toContain("김하늘");
  });
  it("공백·점으로 끊은 휴대폰 번호 · 하이픈 없는 긴 숫자(계좌)도 가린다 — 금액의 쉼표 숫자는 그대로", () => {
    expect(scrubSensitive("010 1234 5678 / 010.1234.5678")).toBe("5678 / 5678");
    expect(scrubSensitive("계좌 110123456789 · ₩1,234,567,890")).toBe("계좌 6789 · ₩1,234,567,890");
  });
  it("카드번호(공백) · 유선 번호도 뒤 4자리만", () => {
    expect(scrubSensitive("카드 1234 5678 9012 3456 · 02 123 4567 · 053.123.4567")).toBe("카드 3456 · 4567 · 4567");
  });
  it("자세히의 메모 내용도 전화번호 모양은 가려서 나간다", () => {
    const e = { ...ev, label: "특이사항 수정", facts: { brief: ["특이사항 입력"], rows: [{ label: "특이사항 후", value: "010-1234-5678 엄마 연락" }], href: null } };
    const d = renderActivity(e, { ...style, template: "detailed" }).body;
    expect(d).toContain("엄마 연락");
    expect(d).not.toContain("010-1234-5678");
  });
  it("지출 금액 수정은 이전 → 이후 · 모르는 분류·다른 돈 계열은 열리지 않는다", () => {
    expect(moneyFacts("expense_update", { amount: 90000, amountBefore: 100000, category: "매입" })?.brief).toEqual(["매입", "₩100,000 → ₩90,000"]);
    expect(moneyFacts("expense_create", { category: "비밀", amount: -1 })).toBeUndefined();
    expect(moneyFacts("invoice_create", { amount: 450000 })).toBeUndefined();
    expect(moneyFacts("expense_delete", { amount: 450000 })).toBeUndefined();
  });
});

describe("개인정보 가리기", () => {
  it("주민번호·계좌·전화번호 모양", () => {
    expect(scrubSensitive("주민 900101-1234567 끝")).toBe("주민 900101-1****** 끝");
    expect(scrubSensitive("계좌 110-123-456789")).toBe("계좌 6789");
    expect(scrubSensitive("연락처 010-1234-5678")).toBe("연락처 5678");
    expect(scrubSensitive("연락처 01012345678 끝")).toBe("연락처 5678 끝");
    expect(scrubSensitive("2026-09-28 · 3-2반")).toBe("2026-09-28 · 3-2반"); // 날짜·짧은 숫자는 그대로
  });
  it("🔴 링크 줄은 가리지 않는다 — 숫자로만 된 uuid 조각이 있어도 주소가 안 깨진다", () => {
    const link = "/approvals/1a2b3c4d-1234-4123-8123-123456789012";
    const body = renderNotification({ ...notif, link, body: "연락처 010-1234-5678" }, style).body;
    expect(body).toContain(`<https://www.aywa.co.kr${link}|에이와에서 열기>`);
    expect(body).toContain("연락처 5678");
  });
});

describe("묶음·요약", () => {
  const items = [
    { body: "*[출결 입력·정정]* 김하늘 — 박소선", groupLabel: "출결 입력·정정 — 박소선", createdAt: at("2026-09-28T22:10:00") },
    { body: "*[출결 입력·정정]* 이서준 — 박소선", groupLabel: "출결 입력·정정 — 박소선", createdAt: at("2026-09-28T22:11:00") },
    { body: "*[학생 등록]* 박지우 — 원장", groupLabel: "학생 등록 — 원장", createdAt: at("2026-09-29T07:00:00") },
  ];
  it("묶음 = 앞 10건은 한 줄씩(누가·무엇을), 넘치면 나머지는 종류별 건수", () => {
    expect(renderAggregate(items)).toBe(
      "*[에이와] 3건*\n• *[출결 입력·정정]* 김하늘 — 박소선\n• *[출결 입력·정정]* 이서준 — 박소선\n• *[학생 등록]* 박지우 — 원장",
    );
    const many = Array.from({ length: 12 }, (_, i) => ({ ...items[0], body: `*[출결 입력·정정]* 학생${i} — 박소선` }));
    const text = renderAggregate(many);
    expect(text).toContain("• *[출결 입력·정정]* 학생9 — 박소선");
    expect(text).not.toContain("학생10");
    expect(text).toContain("외 2건\n• 출결 입력·정정 — 박소선 2건");
  });
  it("요약 = 기간 + 시각별 첫 줄", () => {
    const d = renderDigest(items);
    expect(d.split("\n")[0]).toBe("*[에이와] 요약 3건* (9/28 22:10 ~ 9/29 07:00)");
    expect(d).toContain("• 22:10 *[출결 입력·정정]* 김하늘 — 박소선");
  });
  it("요약 줄에 낱개 호출(@here)을 반복하지 않는다", () => {
    const d = renderDigest([{ ...items[0], body: `<!here> ${items[0].body}` }], "here");
    expect(d.match(/<!here>/g)?.length).toBe(1);
  });
});
