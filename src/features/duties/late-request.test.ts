import { describe, expect, it } from "vitest";
import { DUTY_REQUEST_SOURCE, lateRequestPrefill, openLateRequest, requestSubject } from "./late-request";

const item = (o: Partial<Parameters<typeof lateRequestPrefill>[0][number]>) => ({ kind: "attendance", cycle: "2026-11-07", dueAt: "2026-11-07T15:00:00Z", studentId: "s1", studentName: "김하나", classId: "c1", className: "초5 A반", subject: "math" as string | null, ...o });
const owner = { id: "t1", name: "이선생" };

describe("lateRequestPrefill — 지연 의무 → 처리 요청 초안", () => {
  it("받는 사람은 담당자 한 명 · 근거 학생은 지연이 있는 학생(겹침 없이 · 그 담당자 몫)", () => {
    const p = lateRequestPrefill([item({}), item({ kind: "report_send", cycle: "2026-11-08" }), item({ studentId: "s2", studentName: "박둘" }), item({ studentId: null, studentName: null, kind: "report_send" })], owner, "2026-11-10")!;
    expect(p.assigneeIds).toEqual(["t1"]);
    expect(p.students).toEqual([{ id: "s1", name: "김하나", assigneeId: "t1" }, { id: "s2", name: "박둘", assigneeId: "t1" }]);
    expect(p.title).toBe("이선생 선생님 — 기한 지난 업무 4건 처리");
    expect(p.source).toBe("duty:late:math");
    expect(lateRequestPrefill([item({}), item({ subject: "english" })], owner, "2026-11-10")!.source).toBe(DUTY_REQUEST_SOURCE);
    expect(p.dueOn).toBe("2026-11-12");
  });
  it("내용 = 반마다 학생별 업무와 날 · 월간은 달 · 신규생 정착은 항목 이름 · 반 이름은 제목(h3)이 아니다 · 글자는 이스케이프", () => {
    const p = lateRequestPrefill([
      item({}), item({ cycle: "2026-11-08" }),
      item({ kind: "counsel_monthly", cycle: "2026-10", dueAt: "2026-10-31T14:59:59Z" }),
      item({ kind: "newcomer_call", cycle: "month1_call", dueAt: "2026-11-05T14:59:59Z", classId: null, className: null, studentName: "<b>최" }),
    ], owner, "2026-11-10")!;
    expect(p.body).toContain("<strong>김하나</strong> — 월 학부모 상담 10월 / 출결 입력 11/7 · 11/8");
    expect(p.body).toContain("<strong>반 공통</strong>");
    expect(p.body).toContain("&lt;b&gt;최</strong> — 신규생 정착 콜 1개월 콜(기한 11/5)");
    expect(p.body).not.toMatch(/<h\d/);
  });
  it("지연이 없으면 초안도 없다", () => { expect(lateRequestPrefill([], owner, "2026-11-10")).toBeNull(); });
});

describe("openLateRequest — 이미 보낸 요청", () => {
  const w = (o: object) => ({ id: "w1", source: DUTY_REQUEST_SOURCE, status: "working" as const, createdAt: "2026-11-09T01:00:00Z", steps: [{ user: { id: "t1" } }], ...o }) as Parameters<typeof openLateRequest>[0][number];
  it("그 선생님이 담당인, 끝나지 않은, 업무 완성도에서 만든 요청만 · 가장 최근 것", () => {
    expect(openLateRequest([w({}), w({ id: "w2", createdAt: "2026-11-10T01:00:00Z" })], "t1")?.id).toBe("w2");
    expect(openLateRequest([w({ status: "closed" }), w({ status: "cancelled" }), w({ source: "check:absence" }), w({ steps: [{ user: { id: "t2" } }] })], "t1")).toBeNull();
  });
  it("한 과목 요청은 그 과목만 덮는다 · 과목을 가리지 않는 요청은 늘 덮는다 · 과목을 안 물으면 전부", () => {
    const english = [w({ source: "duty:late:english" })];
    expect(openLateRequest(english, "t1", "math")).toBeNull();
    expect(openLateRequest(english, "t1", "english")?.id).toBe("w1");
    expect(openLateRequest(english, "t1", null)).toBeNull();
    expect(openLateRequest(english, "t1")?.id).toBe("w1");
    expect(openLateRequest([w({})], "t1", "math")?.id).toBe("w1");
    expect(requestSubject([{ subject: "math" }, { subject: "math" }])).toBe("math");
    expect(requestSubject([{ subject: "math" }, { subject: null }])).toBeNull();
  });
});
