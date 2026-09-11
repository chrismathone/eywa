import type { CalendarEvent } from "@/features/calendar/types";

/** 대시보드 표시용 분류. 실제 계정 권한은 바꾸지 않는다. */
export function staffDisplayRole(user: { id: string; system_role: string }) {
  // 박소선은 운영 관리자에 포함(2026-09-11). 동명이인이나 개명에 영향받지 않도록 ID로 판정.
  if (
    user.id === "fcf735fa-edf7-4095-8fa6-724285a018ed" &&
    user.system_role === "master"
  )
    return "admin";
  return user.system_role;
}

/** 날짜만 있는 값은 UTC 요일로 계산해 브라우저 시간대에 따라 전날로 밀리지 않게 한다. */
export function dashboardDate(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${date.slice(2).replaceAll("-", ".")} (${"일월화수목금토"[day]})`;
}

export function upcomingAdmissionsEvents(
  events: CalendarEvent[],
  from: string,
  to: string,
) {
  return events
    .filter((event) => {
      const title = event.title.replace(/\s+/g, "");
      const tag = event.tag?.name.replace(/\s+/g, "") ?? "";
      return (
        event.source === "manual" &&
        event.endDate >= from &&
        event.startDate <= to &&
        !title.includes("취소") &&
        !/예약(금지|차단)/.test(title) &&
        !tag.includes("운영팀중요일정") &&
        // 메모는 안내문에도 첫 수업 등의 단어가 들어가므로 분류 근거로 쓰지 않는다.
        /레벨테스트|입학테스트|입테|레테|첫수업/.test(`${title} ${tag}`)
      );
    })
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
}
