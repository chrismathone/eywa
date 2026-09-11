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

/** 입학 일정의 종류 — 레벨테스트(입테·레테 포함) / 첫 수업. */
export type AdmissionsKind = "levelTest" | "firstClass";

const LEVEL_TEST = /레벨테스트|입학테스트|입테|레테/;
const FIRST_CLASS = /첫수업/;

/**
 * 캘린더 일정 하나의 입학 일정 종류 — **단일 분류기**. '레벨테스트 및 첫수업 일정' 패널과 KPI '금일입테'가
 * 같은 판정을 쓴다. 취소·예약 차단·운영팀 중요일정·휴가 오버레이는 null.
 * 🔑 제목에 레벨테스트와 첫 수업이 함께 있으면 **레벨테스트**다(그날 입테가 먼저 있다).
 * ⚠️ 메모는 안내문에도 첫 수업 등의 단어가 들어가므로 분류 근거로 쓰지 않는다.
 */
export function admissionsEventKind(
  event: Pick<CalendarEvent, "title" | "tag" | "source">,
): AdmissionsKind | null {
  const title = event.title.replace(/\s+/g, "");
  const tag = event.tag?.name.replace(/\s+/g, "") ?? "";
  if (
    event.source !== "manual" ||
    title.includes("취소") ||
    /예약(금지|차단)/.test(title) ||
    tag.includes("운영팀중요일정")
  )
    return null;
  const text = `${title} ${tag}`;
  if (LEVEL_TEST.test(text)) return "levelTest";
  return FIRST_CLASS.test(text) ? "firstClass" : null;
}

/** 오늘(그날을 덮는) 레벨테스트 — KPI '금일입테'의 카드 숫자와 팝업 목록이 같이 부른다. */
export function todayLevelTests<T extends { kind: AdmissionsKind | null; startDate: string; endDate: string }>(
  events: readonly T[],
  today: string,
): T[] {
  return events.filter((event) => event.kind === "levelTest" && event.startDate <= today && event.endDate >= today);
}

export function upcomingAdmissionsEvents(
  events: CalendarEvent[],
  from: string,
  to: string,
) {
  return events
    .filter(
      (event) =>
        event.endDate >= from &&
        event.startDate <= to &&
        admissionsEventKind(event) !== null,
    )
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
}
