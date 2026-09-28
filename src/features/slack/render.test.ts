import { describe, expect, it } from "vitest";
import { renderActivity, renderAggregate, renderDigest, renderNotification, scrubSensitive } from "./render";

const at = (kst: string) => new Date(`${kst}+09:00`);
const style = { template: "short" as const, appUrl: "https://www.aywa.co.kr", ping: "none" as const };
const notif = { type: "approval_requested", title: "결재 요청", body: "박지현 · 10월 교재 구입 품의", link: "/approvals/1", createdAt: at("2026-09-28T15:00:00") };

describe("알림", () => {
  it("짧게 = 머리 + 한 줄 본문 + 링크", () => {
    expect(renderNotification(notif, style).body).toBe(
      "*[결재 요청] 결재 요청*\n박지현 · 10월 교재 구입 품의\n<https://www.aywa.co.kr/approvals/1|aywa에서 열기>",
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
  it("자세히 = 시각 + 감사로그 링크 · 행위자 없으면 시스템", () => {
    const b = renderActivity({ ...ev, actorName: null }, { ...style, template: "detailed" }).body;
    expect(b).toContain("— 시스템 · 09:05");
    expect(b).toContain("/owner?tab=audit|감사로그에서 보기>");
  });
});

describe("개인정보 가리기", () => {
  it("주민번호·계좌·전화번호 모양", () => {
    expect(scrubSensitive("주민 900101-1234567 끝")).toBe("주민 ******-******* 끝");
    expect(scrubSensitive("계좌 110-123-456789")).toBe("계좌 ***-***-******");
    expect(scrubSensitive("연락처 010-1234-5678")).toBe("연락처 ***-****-****");
    expect(scrubSensitive("연락처 01012345678 끝")).toBe("연락처 *********** 끝");
    expect(scrubSensitive("2026-09-28 · 3-2반")).toBe("2026-09-28 · 3-2반"); // 날짜·짧은 숫자는 그대로
  });
  it("🔴 링크 줄은 가리지 않는다 — 숫자로만 된 uuid 조각이 있어도 주소가 안 깨진다", () => {
    const link = "/approvals/1a2b3c4d-1234-4123-8123-123456789012";
    const body = renderNotification({ ...notif, link, body: "연락처 010-1234-5678" }, style).body;
    expect(body).toContain(`<https://www.aywa.co.kr${link}|aywa에서 열기>`);
    expect(body).toContain("연락처 ***-****-****");
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
      "*[aywa] 3건*\n• *[출결 입력·정정]* 김하늘 — 박소선\n• *[출결 입력·정정]* 이서준 — 박소선\n• *[학생 등록]* 박지우 — 원장",
    );
    const many = Array.from({ length: 12 }, (_, i) => ({ ...items[0], body: `*[출결 입력·정정]* 학생${i} — 박소선` }));
    const text = renderAggregate(many);
    expect(text).toContain("• *[출결 입력·정정]* 학생9 — 박소선");
    expect(text).not.toContain("학생10");
    expect(text).toContain("외 2건\n• 출결 입력·정정 — 박소선 2건");
  });
  it("요약 = 기간 + 시각별 첫 줄", () => {
    const d = renderDigest(items);
    expect(d.split("\n")[0]).toBe("*[aywa] 요약 3건* (9/28 22:10 ~ 9/29 07:00)");
    expect(d).toContain("• 22:10 *[출결 입력·정정]* 김하늘 — 박소선");
  });
  it("요약 줄에 낱개 호출(@here)을 반복하지 않는다", () => {
    const d = renderDigest([{ ...items[0], body: `<!here> ${items[0].body}` }], "here");
    expect(d.match(/<!here>/g)?.length).toBe(1);
  });
});
