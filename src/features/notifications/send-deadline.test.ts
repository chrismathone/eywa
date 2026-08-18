/**
 * 발송 실패 "마감" 이벤트 — 마지막 날에만 한 번.
 *
 * 🔴 이 파일이 지키는 두 가지:
 *  ① 아직 여유가 있거나 이미 만료된 건은 **후보가 아니다**(잔소리·불가능한 재촉 방지).
 *  ② 본문이 유실 보정 스윕의 중복키 형식(`{학생} · {MM-DD} — `)과 **겹치지 않는다** —
 *     겹치면 스윕이 "이미 알렸다"로 오인해 정작 실패 알림이 안 나간다.
 */
import { describe, expect, it } from "vitest";
import {
  buildSendDeadlineEvents,
  sendDeadlineBody,
  sendDeadlineDigestBody,
  type SendDeadlineInput,
} from "./events-core";
import { parseNotifiedKey } from "./failed-notify-sweep";

const row = (over: Partial<SendDeadlineInput> = {}): SendDeadlineInput => ({
  reportId: "r1",
  studentId: "s1",
  studentName: "김하늘",
  subjectLabel: "수학",
  reportDate: "2026-08-12",
  daysLeft: 0,
  ...over,
});

describe("buildSendDeadlineEvents", () => {
  it("오늘이 마지막 날인 건만 이벤트가 된다", () => {
    const events = buildSendDeadlineEvents([
      row({ reportId: "r1", daysLeft: 0 }),
      row({ reportId: "r2", daysLeft: 3 }), // 아직 여유 — 화면 배지가 맡는다
      row({ reportId: "r3", daysLeft: -1 }), // 이미 만료 — 되돌릴 수 없다
    ]);
    expect(events.map((e) => e.subjectKey)).toEqual(["r1"]);
  });

  it("dedup 키는 보고서 하나당 하나(bucket 고정) — 날마다 다시 울리지 않는다", () => {
    const [event] = buildSendDeadlineEvents([row()]);
    expect(event.subjectKey).toBe("r1");
    expect(event.bucket).toBe("lastday");
  });

  it("기한이 급한 순(날짜 오름차순)", () => {
    const events = buildSendDeadlineEvents([
      row({ reportId: "late", reportDate: "2026-08-13" }),
      row({ reportId: "early", reportDate: "2026-08-11" }),
    ]);
    expect(events.map((e) => e.subjectKey)).toEqual(["early", "late"]);
  });

  it("후보가 없으면 빈 배열", () => {
    expect(buildSendDeadlineEvents([row({ daysLeft: 2 })])).toEqual([]);
  });
});

describe("본문", () => {
  it("학생·날짜·과목과 '오늘까지'를 함께 말한다", () => {
    const [event] = buildSendDeadlineEvents([row()]);
    const body = sendDeadlineBody(event);
    expect(body).toContain("김하늘");
    expect(body).toContain("2026-08-12");
    expect(body).toContain("수학");
    expect(body).toContain("오늘까지");
  });

  it("🔴 스윕의 중복키 형식과 겹치지 않는다(겹치면 실패 알림이 막힌다)", () => {
    const [event] = buildSendDeadlineEvents([row()]);
    expect(parseNotifiedKey(sendDeadlineBody(event))).toBeNull();
    const digest = sendDeadlineDigestBody(
      buildSendDeadlineEvents([row({ reportId: "r1" }), row({ reportId: "r2", studentName: "이바다" })]),
    );
    expect(parseNotifiedKey(digest)).toBeNull();
  });

  it("집계 본문 — 없으면 null, 한 건이면 건별 문장, 여러 건이면 건수", () => {
    expect(sendDeadlineDigestBody([])).toBeNull();
    const one = buildSendDeadlineEvents([row()]);
    expect(sendDeadlineDigestBody(one)).toBe(sendDeadlineBody(one[0]));
    const many = buildSendDeadlineEvents([
      row({ reportId: "r1" }),
      row({ reportId: "r2", studentName: "이바다" }),
    ]);
    expect(sendDeadlineDigestBody(many)).toContain("2건");
  });
});
