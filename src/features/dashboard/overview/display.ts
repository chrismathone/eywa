import { isCancelledEventTitle } from "@/features/calendar/cancelled";
import type { CalendarEvent } from "@/features/calendar/types";

/** 대시보드 표시용 분류. 실제 계정 권한은 바꾸지 않는다. */
export function staffDisplayRole(user: { id: string; system_role: string }, isChinsanTenant: boolean) {
  // 박소선은 운영 관리자에 포함(2026-09-11). 동명이인이나 개명에 영향받지 않도록 ID로 판정.
  if (
    isChinsanTenant && user.id === "fcf735fa-edf7-4095-8fa6-724285a018ed" &&
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
 * 캘린더 일정 하나의 입학 일정 종류 — **단일 분류기**. '레벨테스트 및 첫수업 일정' 패널과 KPI '전일 입테'가
 * 같은 판정을 쓴다. 취소·예약 차단·운영팀 중요일정·휴가 오버레이는 null.
 * 🔑 제목에 레벨테스트와 첫 수업이 함께 있으면 **레벨테스트**다(그날 입테가 먼저 있다).
 * ⚠️ 메모는 안내문에도 첫 수업 등의 단어가 들어가므로 분류 근거로 쓰지 않는다.
 * 🔴 취소된 일정은 여기서 null — 건수·콜&상담 연결·상담 진행(입테 단계)이 이 함수를 지나므로 **살아 있는 일정만** 센다.
 *    목록에 취소선으로 남길 종류는 {@link admissionsEventBaseKind}(원장 2026-09-30).
 */
export function admissionsEventKind(
  event: Pick<CalendarEvent, "title" | "tag" | "source">,
): AdmissionsKind | null {
  return isCancelledEventTitle(event.title) ? null : admissionsEventBaseKind(event);
}

/**
 * 취소 여부를 **보지 않은** 입학 일정 종류 — 취소된 일정을 목록의 원래 열(입학 테스트·첫 수업)에 취소선으로 남기는 데만 쓴다.
 * 🔴 건수·연결·자동 동작엔 쓰지 말 것({@link admissionsEventKind}).
 */
export function admissionsEventBaseKind(
  event: Pick<CalendarEvent, "title" | "tag" | "source">,
): AdmissionsKind | null {
  const title = event.title.replace(/\s+/g, "");
  const tag = event.tag?.name.replace(/\s+/g, "") ?? "";
  if (
    event.source !== "manual" ||
    /예약(금지|차단)/.test(title) ||
    tag.includes("운영팀중요일정")
  )
    return null;
  const text = `${title} ${tag}`;
  if (LEVEL_TEST.test(text)) return "levelTest";
  return FIRST_CLASS.test(text) ? "firstClass" : null;
}

/** 운영실 일정 한 줄의 종류 필드 — `kind`는 살아 있는 일정만, 취소된 일정은 `cancelledKind`에 원래 종류. */
type KindFields = { kind: AdmissionsKind | null; cancelledKind?: AdmissionsKind | null };

/** 취소된 일정 줄인가(목록에 취소선으로 남긴 줄). */
export const isCancelledAdmissionsRow = (event: KindFields) => event.kind === null && !!event.cancelledKind;

/** 목록에서 이 줄이 들어갈 열 — 살아 있으면 `kind`, 취소됐으면 원래 종류. */
export const admissionsListKind = (event: KindFields): AdmissionsKind | null =>
  event.kind ?? event.cancelledKind ?? null;

/**
 * 그날(을 덮는) 레벨테스트 — KPI '전일 입테'의 카드 숫자(원장 2026-10-22 *"금일 입테 -> 전일 입테로 바꿔. 측정하는것도 전일 입테로"* —
 * 그날 = 어제). **취소된 일정은 없다**(`kind`가 null).
 */
export function levelTestsOn<T extends { kind: AdmissionsKind | null; startDate: string; endDate: string }>(
  events: readonly T[],
  day: string,
): T[] {
  return events.filter((event) => event.kind === "levelTest" && event.startDate <= day && event.endDate >= day);
}

/**
 * 운영실 '레벨테스트 및 첫수업 일정' 줄 = **오늘부터**. 일정 배열엔 KPI '전일 입테'를 위해 어제 레벨테스트도 실린다(2026-10-22) —
 * 패널 목록·건수·빈 판정은 이 함수를 지난다(어제 줄이 '예정' 목록에 끼지 않게).
 */
export function upcomingAdmissionsRows<T extends { endDate: string }>(rows: readonly T[], today: string): T[] {
  return rows.filter((row) => row.endDate >= today);
}

/**
 * KPI '전일 입테'의 카드·팝업 재료(원장 2026-09-30 · 2026-10-22 금일 → 전일) — 숫자는 `active`(살아 있는 것만), 팝업 목록은 `rows`
 * (취소된 것도 **시간 순서 그대로** 끼워 취소선으로 보인다), 카드 보조 줄은 `cancelled`("취소 1").
 * 카드와 팝업이 이 함수 한 번의 결과를 같이 쓴다.
 */
export function levelTestListOn<T extends KindFields & { startDate: string; endDate: string }>(
  events: readonly T[],
  day: string,
): { active: T[]; rows: T[]; cancelled: number } {
  const active = levelTestsOn(events, day);
  const rows = events.filter(
    (event) => admissionsListKind(event) === "levelTest" && event.startDate <= day && event.endDate >= day,
  );
  return { active, rows, cancelled: rows.length - active.length };
}

/**
 * 창 안의 입학 일정(날짜·시각 순) — **취소된 일정도 포함**한다(목록에 취소선으로 남긴다, 원장 2026-09-30).
 * 호출부는 연결·건수에 `admissionsEventKind`(취소 = null)를 쓸 것.
 */
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
        admissionsEventBaseKind(event) !== null,
    )
    .sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) ||
        (a.startTime ?? "").localeCompare(b.startTime ?? "") ||
        a.id.localeCompare(b.id),
    );
}
