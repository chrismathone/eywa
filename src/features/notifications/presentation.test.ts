import { describe, expect, it } from "vitest";
import { presentNotification, REPEATED_ABSENCES_LINK } from "./presentation";
import { absenceNotificationLink, buildAbsenceEvents } from "./events-core";
import type { NotificationItem } from "./types";

const item: NotificationItem = {
  id: "n1",
  type: "absence_alert",
  title: "반복 결석 위험 학생",
  body: "정채민·강수정·윤채이 3명이 반복 결석 위험 단계(최근 14일 3회 이상)에 도달했습니다.",
  link: "/retention",
  read: false,
  createdAt: "2026-09-11T00:00:00Z",
};
describe("current notification presentation", () => {
  it("기존 알림의 실제 이름·건수·읽음 상태를 유지하면서 최신 명칭과 도착점으로 바꾼다", () => {
    expect(presentNotification(item)).toEqual({
      ...item,
      title: "반복 결석 학생",
      body: "정채민·강수정·윤채이 학생 3명 · 최근 14일 결석 3회 이상.",
      link: REPEATED_ABSENCES_LINK,
    });
    expect(item.title).toBe("반복 결석 위험 학생");
  });
  it("이미 연결된 학생 상세와 다른 유형의 링크를 덮어쓰지 않는다", () => {
    expect(
      presentNotification({ ...item, link: "/students/s1?tab=attendance" })
        .link,
    ).toBe("/students/s1?tab=attendance");
    const other = {
      ...item,
      type: "classnote_parent_post",
      link: "https://classnote.com/post/1",
    };
    expect(presentNotification(other)).toBe(other);
  });
  it("새 알림은 한 명일 때 그 학생 출결, 여러 명일 때 현황 명단으로 연결한다", () => {
    const events = buildAbsenceEvents([
      { studentId: "s1", studentName: "김", absences: 3 },
      { studentId: "s2", studentName: "이", absences: 5 },
    ]);
    expect(absenceNotificationLink(events.slice(0, 1))).toBe(
      "/students/s1?tab=attendance",
    );
    expect(absenceNotificationLink(events)).toBe(REPEATED_ABSENCES_LINK);
  });
});
