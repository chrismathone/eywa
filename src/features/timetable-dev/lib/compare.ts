/**
 * 시간표(개발중) — **월별 계획 비교**(9월 계획 ↔ 10월 계획)의 순수 로직.
 *
 * 원장 지시(2026-08-28): *"다음달 다다음달 시간표도 미리 만들어서 관리하고싶음"* + **월별 시간표를
 * 비교할 수 있는 기능**. 두 달을 나란히 놓고 "무엇이 늘고, 빠지고, 바뀌었나"를 한 장으로 본다.
 *
 * 🔴 **이 파일은 IO를 하지 않는다** — 두 달치 `PlanSlot[]`을 받아 diff만 낸다(Vitest로 경계를 잠근다).
 *    조회는 화면이, 저장은 서버 액션이 한다. 비교 규칙이 화면마다 갈리는 것을 막는 단일 소스다.
 *
 * ## 매칭 앵커 = `classId + dayOfWeek + startTime`
 * DB 유니크(0231a: `tenant_id, plan_month, class_id, day_of_week, start_time`)에서 **달만 뺀 축**이다.
 * 달을 빼야 "9월의 이 칸"과 "10월의 이 칸"이 같은 칸으로 만난다.
 *
 * ⚠️ **시각은 반드시 `hhmm()`으로 정규화한 뒤 비교한다.** DB는 `time`이라 'HH:MM:SS'로 오고 폼은
 *    'HH:MM'을 준다 — 한 쪽만 초가 붙으면 앵커가 어긋나 **모든 칸이 "삭제 + 추가"로 뒤집히고**
 *    남은 필드 비교도 전부 '변경'이 된다(거짓 결과). 정규화는 여기 한 곳에서만 한다.
 *
 * ⚠️ **시작시각이 같은 교시가 둘 있을 수 있다**([[#106]] EiE 4교시 16:20~17:00 / IJW 1교시 16:20~17:20).
 *    앵커에 `classId`가 들어 있어 **같은 반 안에서는 (요일,시작)이 유니크**하므로 안전하다 —
 *    다른 반이 같은 시각에 서는 것은 애초에 다른 행이다. 그리고 **한쪽에만 있는 시각은 '변경'이 아니라
 *    추가/삭제**다(끝시각만 다르다고 같은 칸으로 묶으면 EiE 4교시가 IJW 1교시로 둔갑한다).
 *
 * ## 비교하지 않는 필드
 * `id`·`planMonth`·`sourceScheduleId`는 **달마다 당연히 다르다** — 넣으면 모든 행이 '변경'이 되어
 * 비교가 통째로 무의미해진다. `startTime`·`classId`·`dayOfWeek`는 앵커라 정의상 같다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { PLAN_DAYS, hhmm, type PlanDayOfWeek, type PlanSlot } from "@/features/timetable-dev/types";

/** 한 칸의 운명. `same`도 행으로 남긴다 — "안 바뀐 것"을 세야 "몇 칸 중 몇 칸이 바뀌었나"가 나온다. */
export type PlanDiffKind = "added" | "removed" | "changed" | "same";

export type PlanSlotChange = {
  field: keyof PlanSlot;
  before: string | null;
  after: string | null;
};

export type PlanDiffRow = {
  kind: PlanDiffKind;
  classId: string;
  dayOfWeek: PlanDayOfWeek;
  /** 정규화된 'HH:MM'(앵커). 원본 문자열이 아니라 이 값이 화면·정렬의 기준이다. */
  startTime: string;
  before?: PlanSlot;
  after?: PlanSlot;
  /** `changed`일 때만 채워진다. 나머지 kind는 항상 빈 배열. */
  changes: PlanSlotChange[];
};

export type PlanDiff = {
  rows: PlanDiffRow[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  sameCount: number;
};

/**
 * 실제로 비교하는 필드 — **앵커(반·요일·시작시각)와 신원(id·월·출처)을 제외한 전부**.
 * 새 컬럼이 `PlanSlot`에 생기면 여기에 넣을지 한 번 판단할 것(안 넣으면 조용히 '동일'로 샌다).
 */
export const PLAN_COMPARED_FIELDS = [
  "endTime",
  "teacherId",
  "classroomId",
  "slotTeacherLabel",
  "slotRoomLabel",
  "periodLabel",
  "mergeGroup",
] as const;

export type PlanComparedField = (typeof PLAN_COMPARED_FIELDS)[number];

/** 화면 표기 — UI에 raw 키(`slotTeacherLabel`)를 내보내지 않는다(CLAUDE.md 규약). */
export const PLAN_FIELD_LABEL: Record<PlanComparedField, string> = {
  endTime: "종료시각",
  teacherId: "강사",
  classroomId: "강의실",
  slotTeacherLabel: "표기 강사",
  slotRoomLabel: "표기 강의실",
  periodLabel: "교시",
  mergeGroup: "합반",
};

export const PLAN_DIFF_KINDS: readonly PlanDiffKind[] = ["added", "removed", "changed", "same"];

export const PLAN_DIFF_KIND_LABEL: Record<PlanDiffKind, string> = {
  added: "추가",
  removed: "삭제",
  changed: "변경",
  same: "동일",
};

/**
 * 구분 → **의미색 캐논의 tone**(`src/lib/design/semantic-color.ts`).
 *
 * 🔴 색을 여기서 고르지 않는다 — 뜻만 고르고 색은 캐논이 정한다(화면 파일에 상태 색 맵을 새로 만들지
 * 말라는 규약의 준수 지점). 추가=정상적으로 늘어난 것(positive) · 삭제=사라진 것(critical) ·
 * 변경=사람이 확인해야 하는 것(caution) · 동일=지나간 배경(inert).
 * 요약 카드와 목록 배지가 **같은 표**를 읽어야 두 곳의 색이 어긋나지 않는다.
 */
export const PLAN_DIFF_TONE: Record<PlanDiffKind, SemanticTone> = {
  added: "positive",
  removed: "critical",
  changed: "caution",
  same: "inert",
};

const COMPARED_SET: ReadonlySet<string> = new Set<string>(PLAN_COMPARED_FIELDS);

function isComparedField(field: keyof PlanSlot): field is PlanComparedField {
  return COMPARED_SET.has(field);
}

/**
 * 값 정규화 — 비교 직전 한 번만.
 *  · 시각은 `hhmm()`('09:00:00' ↔ '09:00'이 같은 값이 되게).
 *  · 빈 문자열은 **null과 같은 것으로** 본다. 폼이 지운 칸을 `''`로 저장하고 복사는 `null`을 넣어
 *    같은 "없음"이 두 모양으로 갈리는데, 그걸 '변경'으로 세면 아무것도 안 바꾼 달이 전부 빨개진다.
 */
function normalizeField(field: PlanComparedField, slot: PlanSlot): string | null {
  const raw = slot[field];
  if (field === "endTime") {
    const t = hhmm(typeof raw === "string" ? raw : "");
    return t === "" ? null : t;
  }
  const s = raw == null ? "" : String(raw).trim();
  return s === "" ? null : s;
}

function anchorKey(classId: string, day: PlanDayOfWeek, startTime: string): string {
  return `${classId}|${day}|${hhmm(startTime)}`;
}

/**
 * 앵커 → 슬롯. **먼저 온 행이 이긴다**(first-wins).
 *
 * DB 유니크가 있어 정상 데이터에는 중복이 없지만, 같은 표를 읽는 시간표 축의 규약이 "앞을 유지"라
 * ([[#106]] — 시작시각 키 Map에서 뒤엣것이 앞을 덮어 수업이 다른 칸으로 옮겨 보였던 사고) 여기서도
 * 같은 규약을 쓴다. 화면마다 다른 행을 대표로 집으면 같은 데이터가 화면마다 다르게 읽힌다.
 */
function indexSlots(slots: readonly PlanSlot[]): Map<string, PlanSlot> {
  const m = new Map<string, PlanSlot>();
  for (const s of slots) {
    const k = anchorKey(s.classId, s.dayOfWeek, s.startTime);
    if (!m.has(k)) m.set(k, s);
  }
  return m;
}

function diffFields(before: PlanSlot, after: PlanSlot): PlanSlotChange[] {
  const out: PlanSlotChange[] = [];
  for (const field of PLAN_COMPARED_FIELDS) {
    const b = normalizeField(field, before);
    const a = normalizeField(field, after);
    if (b !== a) out.push({ field, before: b, after: a });
  }
  return out;
}

const DAY_INDEX = new Map<string, number>(PLAN_DAYS.map((d, i) => [d, i]));

/** 결정적 정렬 — 요일 → 시작시각 → 반 id. (사람이 읽는 반 이름 정렬은 이름을 아는 화면이 한다.) */
function byAnchor(x: PlanDiffRow, y: PlanDiffRow): number {
  const dx = DAY_INDEX.get(x.dayOfWeek) ?? PLAN_DAYS.length;
  const dy = DAY_INDEX.get(y.dayOfWeek) ?? PLAN_DAYS.length;
  if (dx !== dy) return dx - dy;
  if (x.startTime !== y.startTime) return x.startTime < y.startTime ? -1 : 1;
  if (x.classId !== y.classId) return x.classId < y.classId ? -1 : 1;
  return 0;
}

/**
 * 두 달의 계획을 비교한다.
 *
 * @param before 기준 달(왼쪽 — 보통 이른 달)
 * @param after  비교 달(오른쪽 — 보통 늦은 달)
 *
 * 방향이 뜻을 가진다: `before`에만 있으면 **삭제**, `after`에만 있으면 **추가**다.
 * 화면에서 두 달을 맞바꾸면 추가/삭제가 그대로 뒤집힌다(의도된 것 — 어느 쪽이 기준인지 라벨로 밝힐 것).
 */
export function comparePlans(before: PlanSlot[], after: PlanSlot[]): PlanDiff {
  const beforeIx = indexSlots(before ?? []);
  const afterIx = indexSlots(after ?? []);

  const rows: PlanDiffRow[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let sameCount = 0;

  for (const key of new Set([...beforeIx.keys(), ...afterIx.keys()])) {
    const b = beforeIx.get(key);
    const a = afterIx.get(key);
    const anchor = b ?? a;
    if (!anchor) continue; // 도달 불가(키는 둘 중 한 곳에서 왔다) — 타입 좁히기용.

    const base = {
      classId: anchor.classId,
      dayOfWeek: anchor.dayOfWeek,
      startTime: hhmm(anchor.startTime),
    };

    if (b && !a) {
      rows.push({ kind: "removed", ...base, before: b, changes: [] });
      removedCount += 1;
      continue;
    }
    if (!b && a) {
      rows.push({ kind: "added", ...base, after: a, changes: [] });
      addedCount += 1;
      continue;
    }
    if (!b || !a) continue;

    const changes = diffFields(b, a);
    if (changes.length > 0) {
      rows.push({ kind: "changed", ...base, before: b, after: a, changes });
      changedCount += 1;
    } else {
      rows.push({ kind: "same", ...base, before: b, after: a, changes: [] });
      sameCount += 1;
    }
  }

  rows.sort(byAnchor);
  return { rows, addedCount, removedCount, changedCount, sameCount };
}

/** 이름 해석기 — 화면이 id → 사람이 읽는 이름을 넘긴다(없으면 raw id 대신 "이름 미상"). */
export type PlanNameResolver = (kind: "teacher" | "classroom", id: string) => string | null;

/**
 * 한 필드 값의 화면 표기. **uuid를 절대 그대로 내보내지 않는다**(UI에 raw 키 노출 금지).
 * 합반(`mergeGroup`)은 uuid라 값 자체가 사람에게 뜻이 없어 `describePlanChange`가 따로 말로 푼다.
 */
export function formatPlanFieldValue(
  field: PlanComparedField,
  value: string | null,
  resolve?: PlanNameResolver,
): string {
  if (value == null) return "없음";
  if (field === "teacherId") return resolve?.("teacher", value) ?? "이름 미상";
  if (field === "classroomId") return resolve?.("classroom", value) ?? "이름 미상";
  if (field === "mergeGroup") return "합반 묶음";
  return value;
}

/**
 * 변경 한 줄을 사람 말로 — `{ label: "강사", text: "김철수 → 이영희" }`.
 *
 * 합반만 예외다: uuid를 "A → B"로 보여줘 봐야 읽히지 않으므로 **무슨 일이 일어났는지**를 적는다
 * (묶임 / 해제 / 다른 묶음으로 이동).
 */
export function describePlanChange(
  change: PlanSlotChange,
  resolve?: PlanNameResolver,
): { label: string; text: string } {
  const { field, before, after } = change;
  if (!isComparedField(field)) {
    // 비교 대상이 아닌 필드는 emit되지 않는다 — 방어적 폴백(라벨이 없으면 값만이라도 보이게).
    return { label: String(field), text: `${before ?? "없음"} → ${after ?? "없음"}` };
  }
  const label = PLAN_FIELD_LABEL[field];
  if (field === "mergeGroup") {
    if (before == null && after != null) return { label, text: "합반으로 묶임" };
    if (before != null && after == null) return { label, text: "합반 해제" };
    return { label, text: "다른 합반으로 이동" };
  }
  return {
    label,
    text: `${formatPlanFieldValue(field, before, resolve)} → ${formatPlanFieldValue(field, after, resolve)}`,
  };
}
