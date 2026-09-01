/**
 * **주간 ⇄ 월간 왕복이 보고 있던 기간을 잃지 않게** 하는 순수 규칙
 * (원장 2026-09-01 상단 바 통일의 후속 — 적대적 리뷰에서 왕복이 깨지는 것을 잡았다).
 *
 * 두 방향은 **서로의 역함수여야 한다.** 아니면 '달력'을 눌렀다가 '주간'으로 돌아왔을 때 다른 주에
 * 서 있게 되고, 사람은 자기가 뭘 잘못 눌렀는지 모른다.
 *
 * ⚠️ 여기 있는 것은 **주소를 정하는 규칙뿐**이다 — 그리기·권한·조회는 각 화면이 한다.
 */
import { addDays, monthOf } from "@/lib/date-kst";
import { mondayOf } from "@/features/timetable/lib/week";

/**
 * 주간 → 월간: 그 주가 **속한 달**.
 *
 * 🔴 월요일의 달이 아니라 **그 주 목요일의 달**이다. 주가 달을 걸치면 월요일만 보고 정하는 건 거짓이
 *    된다 — 실제로 2026-08-31(월) 주는 7일 중 5일이 9월인데, 월요일만 보면 **9월 1일 아침에 '달력'을
 *    누른 사람이 오늘이 없는 8월 화면 + '과거 조회' 배지**를 봤다.
 *    목요일 기준은 ISO 8601이 "그 주가 어느 해인가"를 정하는 방식과 같은 결이고, 7일 중 4일 이상이
 *    있는 달과 **항상** 일치한다(다수결과 어긋나지 않는다).
 */
export function monthOfWeek(weekMonday: string): string {
  // ⚠️ 먼저 월요일로 맞춘다 — 주 안의 아무 날짜가 들어와도 답이 같아야 한다(주소로 들어오는 값은
  //    월요일이라는 보장이 없다). 2026-08-01(토)을 그냥 +3하면 8월이 되지만 그 주는 7월 주다.
  return monthOf(addDays(mondayOf(weekMonday), 3));
}

export type FaceWeek = { monday: string; dates: string[] };

/**
 * 월간 → 주간: 어느 주를 열까. 순서대로 —
 *
 * ① **왔던 주**(주간에서 넘어왔으면 주소가 `week=`로 들고 온다) — 왕복이 제자리로 돌아온다.
 *    단 그 주가 **지금 보는 달의 주**일 때만이다(달을 옮긴 뒤면 남의 달 주소다).
 * ② 이번 달을 보고 있으면 **오늘 주**.
 * ③ 아니면 그 달에서 **수업이 있는 첫 주** — 그 달 첫 주는 통째로 비어 있을 수 있고(8월처럼 1일이
 *    토요일이면 달력이 그 행을 아예 안 그린다) 빈 주로 보내면 "왜 아무것도 없지"가 된다.
 * ④ 그것도 없으면(그 달에 수업이 0건 — 신설 반의 과거 달·종강 반의 미래 달) **그 달 첫 주**.
 *    🔴 여기서 null로 떨어뜨리면 주간 시트가 오늘 주로 가서, 이 함수가 막으려던 바로 그 일
 *    ("8월을 훑다가 아무 예고 없이 이번 주로 튄다")이 난다.
 *
 * null은 **그 달에 주 자체가 없을 때뿐**이다(조회가 비었을 때 — 호출부가 반 목록으로 떨어뜨린다).
 */
export function weekForMonth(input: {
  /** 지금 보고 있는 달 "YYYY-MM". */
  month: string;
  /** 오늘(KST, 서버가 준 값). */
  today: string;
  /** 주소가 들고 온 "왔던 주"의 월요일 — 없으면 null. */
  fromWeek: string | null;
  weeks: readonly FaceWeek[];
  /** 그 날짜에 이 반 수업이 있나. */
  hasClassOn: (date: string) => boolean;
}): string | null {
  const { month, today, fromWeek, weeks, hasClassOn } = input;
  if (fromWeek && monthOfWeek(fromWeek) === month) return mondayOf(fromWeek);
  if (monthOf(today) === month) return mondayOf(today);
  return weeks.find((w) => w.dates.some(hasClassOn))?.monday ?? weeks[0]?.monday ?? null;
}

/**
 * 그 날 이 반 수업이 있나 — **달력이 주 행을 그릴지**와 **'주간'이 어느 주로 갈지**가 같은 판정을
 * 써야 한다. 두 벌로 들면 한쪽만 고쳤을 때 *달력이 안 그리는 주*로 '주간'이 보낸다.
 */
export function hasClassOnDate(slotsByDate: Record<string, unknown[] | undefined>, date: string): boolean {
  return (slotsByDate[date]?.length ?? 0) > 0;
}

/** 주소로 실려 온 "왔던 주" — 모양이 아니면 버린다(손으로 고친 주소가 화면을 깨지 않게). */
export function readFromWeek(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
