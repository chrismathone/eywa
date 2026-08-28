/**
 * 시간표(개발중) — 월별 계획 슬롯의 **공용 계약**.
 *
 * 🔴 이 파일은 병렬 작업의 접점이다(쿼리·화면·비교가 전부 이걸 import한다) — 필드를 바꾸면 세 곳이
 * 동시에 깨진다. 넓히는 것(선택 필드 추가)은 자유롭고, 이름·의미를 바꾸는 것은 세 곳을 함께 고칠 때만.
 *
 * ⚠️ **`class_schedules`(본 시간표)와 모양이 닮았지만 다른 물건이다** — 저쪽은 `valid_from`/`valid_to`로
 * 이력을 담는 **운영 중인 표**(출결·청구·급여 73곳이 읽는다)이고, 이쪽은 **아직 적용되지 않은 계획**이라
 * 앵커가 날짜가 아니라 **달(plan_month)**이다. 둘을 같은 함수에 섞어 넣지 말 것.
 */

/** 'YYYY-MM' — 계획의 앵커. DB check 제약과 같은 모양(0232a). */
export const PLAN_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPlanMonth(v: string | null | undefined): v is string {
  return !!v && PLAN_MONTH_RE.test(v);
}

/** 요일 키 — `class_schedules.day_of_week` enum과 같은 값(그대로 복사해 오므로 어긋나면 안 된다). */
export type PlanDayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const PLAN_DAYS: readonly PlanDayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** 한 칸 = 그 달에 이 반이 이 요일 이 시각에 선다. */
export type PlanSlot = {
  id: string;
  planMonth: string; // 'YYYY-MM'
  classId: string;
  dayOfWeek: PlanDayOfWeek;
  startTime: string; // 'HH:MM' (초는 잘라서 담는다 — 비교가 문자열 동등이라 형식이 갈리면 전부 '변경'이 된다)
  endTime: string; // 'HH:MM'
  teacherId: string | null;
  classroomId: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  periodLabel: string | null;
  mergeGroup: string | null;
  sourceScheduleId: string | null;
};

/** 계획을 새로 만들거나 고칠 때 넘기는 값(id·월은 호출부가 따로 준다). */
export type PlanSlotInput = Omit<PlanSlot, "id" | "planMonth">;

/** 월 목록 한 줄 — 어떤 달이 있고 몇 칸인지(빈 달을 만들 수 있으니 0도 정상). */
export type PlanMonthSummary = {
  month: string; // 'YYYY-MM'
  slotCount: number;
  classCount: number;
  updatedAt: string | null; // ISO — 마지막으로 손댄 시각
};

/** 시각 정규화 — DB의 'HH:MM:SS'와 폼의 'HH:MM'을 한 모양으로. 비교의 전제라 여기 한 곳에서만 자른다. */
export function hhmm(t: string | null | undefined): string {
  const s = String(t ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : s;
}

/** 'YYYY-MM' + n개월. 다음달·다다음달 만들기의 단일 소스(월 넘김을 화면마다 새로 짜지 않게). */
export function addMonths(month: string, n: number): string {
  const m = month.match(PLAN_MONTH_RE);
  if (!m) return month;
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  // Date를 쓰지 않는다 — 말일 보정·시간대가 끼어들 여지를 없앤다(순수 산술).
  const total = y * 12 + (mo - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** 화면 표기 — '2026-09' → '2026년 9월'(UI에 raw 키 노출 금지 규약). */
export function planMonthLabel(month: string): string {
  const m = month.match(PLAN_MONTH_RE);
  return m ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월` : month;
}
