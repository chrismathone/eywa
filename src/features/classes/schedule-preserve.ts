/**
 * 반 수정 시 스케줄 재삽입 값 만들기 — 순수 함수(Vitest).
 *
 * 🔴 왜 필요한가: `updateClass`는 `class_schedules`를 **delete 후 재insert**하는데, 재insert 컬럼에
 *    `valid_to`·`slot_teacher_label`·`slot_room_label`·`period_label`·`merge_group`이 **없었다** →
 *    저장 한 번에 운영 기간·표시 라벨이 소실되고 `valid_from`이 오늘로 리셋됐다.
 *    실측 위험분(injaewon, 전체 939행): valid_to 372 · slot_teacher_label 492 · slot_room_label 342 ·
 *    period_label 0 · merge_group 0. 특강과 무관하게 지금도 데이터를 날리는 버그다.
 *
 * 해법: delete 전에 기존 행을 읽어 두고 **요일+시각 키로 짝지어** 폼이 안 보내는 값을 되살린다.
 *
 * ⚠️ 호출부 계약 3가지 (어기면 이 모듈이 오히려 데이터를 망친다):
 *  ① `prior`에는 **현재 유효한 행만**(`isCurrentSlot`) 넘긴다. 만료 행까지 섞으면 같은 (요일,시작)에
 *     여러 행이 걸려 **지난 학기 강사/강의실 라벨이 현재 행에 되살아난다**(실측: 중복 83그룹 전부
 *     라벨이 서로 다름 — "없음"이 "틀린 값"으로 바뀌는 더 나쁜 회귀). 유효 행만 보면 중복 0그룹이다.
 *  ② 만료 행은 delete 대상에서도 빼야 한다(그 행들이 3~6월 배치 이력이다).
 *  ③ 폼이 표현할 수 없는 슬롯(교시표에 없는 시각)은 그리드가 **자유 시각 행**으로 실어 보낸다 —
 *     incoming에서 빠지면 이 함수는 그 행을 볼 수 없고, 호출부의 delete에 그대로 지워진다.
 */

// 자리(LAB·JJ) 판정 단일 소스. 순수 모듈이라 서버·클라 양쪽에서 안전하다([[#61]]).
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";

export type IncomingSlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId: string | null;
  classroomId: string | null;
  /**
   * 사용자가 시각을 **직접 입력한** 행(자유 시각 입력)인가. true면 종료시각을 사용자가 정한 값 그대로
   * 쓴다. false(=교시 클릭그리드)면 종료시각은 교시표에서 파생된 값이라 **기존 행의 종료시각이 이긴다**
   * (아래 `endTime` 주석 참조 — 시수=돈이라 조용히 줄어드는 것을 막는다).
   */
  explicitTime?: boolean;
  /** 담당 칸에서 **자리(LAB·JJ)** 를 골랐으면 그 이름. 없으면 사람 담당이거나 담임 상속. */
  seatLabel?: string | null;
};

export type PriorSlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  /** 이력 보존용 — 담당/강의실이 바뀌면 옛 값을 마감 행으로 남긴다(planSlotArchives). */
  teacherId?: string | null;
  classroomId?: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  periodLabel: string | null;
  mergeGroup: string | null;
};

/**
 * 폼이 보낸 운영 기간.
 *  · `provided=false` (기간 UI 없는 폼) → 전 행 기존값 보존(신규 행만 오늘~무기한).
 *  · `provided=true`  → `validFrom`은 값이 있을 때만 전 행에 적용(비우면 기존 보존),
 *                       `validTo`는 **비운 것도 명시**로 보고 전 행 무기한(null)으로 만든다.
 *    (종료일을 지워 "무기한으로 되돌리기"가 되려면 이 비대칭이 필요하다.)
 * ⚠️ 시작일은 슬롯마다 다를 수 있다 — 갈리는 반에서 폼이 한 값을 채워 보내면 전 교시가 그 값으로
 *    소급된다. 그래서 편집 화면은 시작일이 갈리면 **칸을 비워** 여기의 "기존 보존" 분기로 떨어뜨린다.
 */
export type PeriodOverride = {
  validFrom: string | null;
  validTo: string | null;
  provided: boolean;
  /**
   * 종료일 칸을 **"안 정함"으로 읽으라**는 표시 — 교시마다 종료일이 달라 폼이 칸을 비운 경우.
   * 없으면 빈 종료일 = "전 교시 무기한"(명시)이라 갈리던 종료일이 한 번에 지워진다.
   * ⚠️ 이 표시가 켜진 동안에는 "전 교시를 무기한으로 되돌리기"를 이 폼으로 할 수 없다(보존 우선).
   */
  keepValidTo?: boolean;
};

export type PreservedSlot = Omit<IncomingSlot, "explicitTime"> & {
  validFrom: string;
  validTo: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  periodLabel: string | null;
  mergeGroup: string | null;
};

const hm = (t: string) => String(t).slice(0, 5);
const isWeekendDay = (d: string) => d === "sat" || d === "sun";

/**
 * 교시표에 **실재하는 (시작,종료) 짝** 집합(평일/주말). 키는 `periodPairKey`.
 *
 * 🔴 왜 필요한가(원장 2026-08-13 *"중등E_초등 브릿지 C2는 스케줄 수정 자체가 안 되네 … 저장했는데
 * 자꾸 원복이 되네"*): 영어 평일 교시표엔 **시작시각이 같은 교시가 둘**이다 — EiE 4교시(16:20~17:00)와
 * IJW 1교시(16:20~17:20). 아래 종료시각 규칙이 "폼 값 무시, 기존 행 유지"라, 그 둘 사이 이동은
 * `요일|시작`이 같아 짝이 지어지고 **종료시각이 옛 값으로 되돌려져** 저장이 아무 일도 안 한 게 된다
 * (실측: C2가 오늘 여러 번 저장됐는데 마감 행 0·신규 구간 0·감사로그 0 = 전부 무시됨).
 */
export type PeriodPairs = { weekday: ReadonlySet<string>; weekend: ReadonlySet<string> };
export const periodPairKey = (startTime: string, endTime: string): string =>
  `${hm(startTime)}|${hm(endTime)}`;

/** 이 슬롯의 (시작,종료)가 그 요일 종류의 교시표에 **정확히** 있는가. */
function inPeriodTable(
  slot: { dayOfWeek: string; startTime: string; endTime: string },
  pairs: PeriodPairs | undefined,
): boolean {
  if (!pairs) return false;
  const table = isWeekendDay(slot.dayOfWeek) ? pairs.weekend : pairs.weekday;
  return table.has(periodPairKey(slot.startTime, slot.endTime));
}

/**
 * 폼이 보낸 **종료시각을 믿어도 되는가**.
 *
 * 기본 규칙은 여전히 "클릭그리드의 종료시각은 교시표 파생이라 기존 행이 이긴다"다 — 저장된 실제 수업
 * 길이(16:20~17:20 = 60분)가 그리드의 교시 값(40분)으로 조용히 줄면 **급여 시수가 준다**.
 * 다만 그 보호는 **그리드가 그 슬롯을 정확히 복원하지 못했을 때만** 의미가 있다:
 *  · 기존 행이 교시표의 정확한 짝이면 → 그리드가 (시작,종료) 짝 매칭으로 **그 교시를 그대로 복원**했다
 *    (`buildPeriodMatcher`, 2026-08-13 [[#106]] 수정). 그러니 폼이 다른 종료시각을 보냈다는 건
 *    **사용자가 다른 교시를 골랐다**는 뜻이다 → 폼 값을 쓴다.
 *  · 기존 행이 교시표 밖(레거시 16:20~17:10 같은 값)이면 → 그리드는 **시작시각 폴백**으로 밖에 못
 *    그렸으니 종료시각은 추측이다 → 기존 행을 지킨다(지금까지의 보호 그대로).
 * ⚠️ `pairs`를 안 넘기면 **예전 동작**(항상 기존 행 우선)으로 떨어진다 — 교시표를 모르는 호출부가
 *    시수를 잘라먹지 않게 하는 안전한 기본값이다.
 */
export function formEndTimeWins(
  incoming: IncomingSlot,
  prior: PriorSlot | undefined,
  pairs?: PeriodPairs,
): boolean {
  if (incoming.explicitTime) return true; // 자유 시각 행 = 사용자가 직접 적은 값
  if (!prior) return true; // 새 슬롯은 폼 값이 유일한 근거
  return inPeriodTable(prior, pairs) && inPeriodTable(incoming, pairs);
}

/** 짝짓기 키 — 요일|시작(HH:MM)|종료(HH:MM). DB는 HH:MM:SS로 돌려주므로 잘라서 맞춘다. */
export function slotKey(s: { dayOfWeek: string; startTime: string; endTime: string }): string {
  return `${s.dayOfWeek}|${hm(s.startTime)}|${hm(s.endTime)}`;
}

/** 느슨한 키 — 요일|시작. 폼이 보내는 종료시각은 **교시표 값**이라 저장된 종료시각과 다를 수 있다. */
function startKey(s: { dayOfWeek: string; startTime: string }): string {
  return `${s.dayOfWeek}|${hm(s.startTime)}`;
}

/**
 * 이 스케줄 행이 지금도 유효한가(= 폼이 편집하는 대상). `valid_to`가 지난 행은 **운영 이력**이라
 * 폼이 건드리지 않는다(조회·짝짓기·삭제 전부에서 제외).
 */
export function isCurrentSlot(validTo: string | null | undefined, today: string): boolean {
  return !validTo || String(validTo).slice(0, 10) >= today;
}

function enqueue(map: Map<string, PriorSlot[]>, key: string, p: PriorSlot): void {
  const arr = map.get(key);
  if (arr) arr.push(p);
  else map.set(key, [p]);
}

function take(
  map: Map<string, PriorSlot[]>,
  key: string,
  used: Set<PriorSlot>,
): PriorSlot | undefined {
  const q = map.get(key);
  while (q && q.length > 0) {
    const c = q.shift()!;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  return undefined;
}

/**
 * incoming ↔ prior 1:1 짝짓기 — **정확 키(요일|시작|종료) 전부 → 그다음 느슨한 키(요일|시작)** 순서.
 * `preserveScheduleFields`와 `planSlotArchives`가 **같은 짝**을 봐야 "새 행은 오늘부터"와
 * "옛 행은 어제까지"가 짝이 맞는다(어긋나면 이력에 구멍이나 중복 구간이 생긴다).
 */
function matchIncomingToPrior(incoming: IncomingSlot[], prior: PriorSlot[]): (PriorSlot | undefined)[] {
  const exact = new Map<string, PriorSlot[]>();
  const loose = new Map<string, PriorSlot[]>();
  for (const p of prior) {
    enqueue(exact, slotKey(p), p);
    enqueue(loose, startKey(p), p);
  }
  const used = new Set<PriorSlot>();
  const matched: (PriorSlot | undefined)[] = incoming.map((s) => take(exact, slotKey(s), used));
  incoming.forEach((s, i) => {
    if (!matched[i]) matched[i] = take(loose, startKey(s), used);
  });
  return matched;
}

/** 이 슬롯의 **이력 있는 값**이 바뀌었나 — 담당·강의실·(폼 값이 이기는) 종료시각. */
function slotChanged(incoming: IncomingSlot, prior: PriorSlot, pairs?: PeriodPairs): boolean {
  if ((incoming.teacherId ?? null) !== (prior.teacherId ?? null)) return true;
  if ((incoming.classroomId ?? null) !== (prior.classroomId ?? null)) return true;
  // 종료시각은 **폼 값이 이길 때만** 실제로 바뀐다(formEndTimeWins) — 판정을 preserveScheduleFields와
  // 반드시 같은 함수로 할 것. 어긋나면 값은 바뀌는데 마감 행이 안 남거나(이력 구멍) 그 반대가 된다.
  if (formEndTimeWins(incoming, prior, pairs) && hm(incoming.endTime) !== hm(prior.endTime)) return true;
  return false;
}

/** `YYYY-MM-DD`의 전날. 마감일(valid_to)은 **바뀌기 전날**이라 새 행과 구간이 안 겹친다. */
export function dayBefore(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * 담당·강의실이 바뀌거나 슬롯이 사라질 때 **옛 배치를 마감 행으로 남긴다**(원장 2026-08-04:
 * *"시간표에서 주차변경시에 실제로 일어났던 모든것이 반영되도록"*).
 *
 * 🔴 지금까지는 같은 행을 덮어써서 **지난 주를 봐도 지금 담당·강의실이 보였다**. 무기한 슬롯이 587행이라
 *    대부분의 반이 여기 해당했다. 행을 쪼개면 시간표 쿼리(그 주 유효 구간 필터)가 그대로 과거를 그린다.
 *
 * ⚠️ **오늘 만들어진 행은 마감하지 않는다**(`validFrom >= today`) — 마감일이 시작일보다 빨라지는
 *    거꾸로 된 구간이 생기고, 하루에 두 번 고치면 쓰레기 행이 쌓인다.
 * ⚠️ 반환 행은 **그대로 insert**한다(호출부가 현재 유효 행을 delete한 뒤 재삽입하는 구조라, 마감 행도
 *    같은 insert에 실어야 한 번의 왕복으로 끝난다).
 */
export function planSlotArchives(input: {
  incoming: IncomingSlot[];
  /** ⚠️ **현재 유효한 행만**(preserveScheduleFields와 같은 계약). */
  prior: PriorSlot[];
  /** KST 오늘 — 마감일은 이 날의 전날. */
  today: string;
  /** 교시표의 (시작,종료) 짝 — 종료시각 변경 판정용(`formEndTimeWins`). 없으면 예전 동작. */
  periodPairs?: PeriodPairs;
}): (PriorSlot & { validTo: string })[] {
  const matched = matchIncomingToPrior(input.incoming, input.prior);
  const keptPairs = new Map<PriorSlot, IncomingSlot>();
  input.incoming.forEach((s, i) => {
    const p = matched[i];
    if (p) keptPairs.set(p, s);
  });
  const cutoff = dayBefore(input.today);
  const out: (PriorSlot & { validTo: string })[] = [];
  for (const p of input.prior) {
    // 오늘 시작한 행은 과거가 없다 — 마감하면 거꾸로 된 구간이 된다.
    if (p.validFrom && String(p.validFrom).slice(0, 10) >= input.today) continue;
    const pair = keptPairs.get(p);
    // 짝이 없으면 '사라진 슬롯'(그 배치는 어제까지 있었다), 짝이 있어도 값이 바뀌었으면 옛 값을 남긴다.
    if (pair && !slotChanged(pair, p, input.periodPairs)) continue;
    out.push({ ...p, validTo: cutoff });
  }
  return out;
}

export function preserveScheduleFields(input: {
  incoming: IncomingSlot[];
  /** ⚠️ **현재 유효한 행만**(위 계약 ①). 만료 행을 섞으면 옛 라벨이 되살아난다. */
  prior: PriorSlot[];
  period: PeriodOverride;
  /** KST 오늘 — 승계할 기존값도 폼 지정도 없는 신규 슬롯의 valid_from. */
  today: string;
  /** 교시표의 (시작,종료) 짝 — `planSlotArchives`에 넘긴 것과 **같은 값**이어야 한다. */
  periodPairs?: PeriodPairs;
}): PreservedSlot[] {
  // 같은 키가 여러 행일 수 있어(중복 슬롯) 큐로 두고 하나씩 소비 = 1:1 승계.
  // 1차 = 정확 키(요일|시작|종료). 2차 = (요일|시작) — 폼이 보내는 종료시각은 교시표에서 파생되므로
  // 저장된 값과 다를 수 있다(실측: 살아있는 45행이 시작 일치·종료 불일치, **전부 라벨 보유**).
  const matched = matchIncomingToPrior(input.incoming, input.prior);

  return input.incoming.map((s, i) => {
    const prior = matched[i];
    // 🔴 담당·강의실이 바뀌었으면 **오늘부터 새 구간**이다(옛 값은 planSlotArchives가 어제까지로 마감).
    //    기존값을 그대로 승계하면 같은 행을 덮어쓰는 셈이라 지난 주에도 새 담당이 보인다.
    //    단 오늘 시작한 행은 쪼갤 과거가 없어 그대로 승계한다(하루 두 번 수정 시 구간 폭발 방지).
    const splitToday =
      !!prior &&
      slotChanged(s, prior, input.periodPairs) &&
      !(prior.validFrom && String(prior.validFrom).slice(0, 10) >= input.today);
    const inheritedFrom = splitToday ? input.today : (prior?.validFrom ?? input.today);
    const validFrom = input.period.provided
      ? (input.period.validFrom ?? inheritedFrom)
      : inheritedFrom;
    // 종료일: 값이 들어오면 언제나 전 행에 적용(폼 안내 그대로). **비어 있을 때만** 해석이 갈린다 —
    // 평소엔 "명시적 무기한"(되돌리기), keepValidTo면 "안 정함"(교시별 기존값 유지).
    const keepTo = input.period.keepValidTo === true && input.period.validTo === null;
    const validTo =
      input.period.provided && !keepTo ? input.period.validTo : (prior?.validTo ?? null);
    // 종료시각: 규칙은 `formEndTimeWins` 한 곳에 있다 — 기존 행이 교시표의 정확한 짝이면 폼 값(=사용자가
    // 고른 교시)이 이기고, 교시표 밖(그리드가 시작시각 폴백으로만 그린 행)이면 기존 행을 지킨다
    // (16:20~17:20 수업이 교시표 17:00으로 40분이 되면 급여 시수가 조용히 줄어든다).
    const endTime = formEndTimeWins(s, prior, input.periodPairs)
      ? hm(s.endTime)
      : hm(prior?.endTime ?? s.endTime);
    return {
      dayOfWeek: s.dayOfWeek,
      startTime: hm(s.startTime),
      endTime,
      teacherId: s.teacherId,
      classroomId: s.classroomId,
      validFrom: String(validFrom).slice(0, 10),
      validTo: validTo ? String(validTo).slice(0, 10) : null,
      // 🔴 라벨은 **자리(LAB·JJ)일 때만** 폼이 건드린다. 그냥 폼 값으로 덮으면 시트 임포트가 넣은
      //    강사 닉네임 라벨(Anna·Elsa… 실측 492행)이 반 메모 한 줄 수정에 통째로 날아간다 — 이 모듈이
      //    존재하는 이유가 그 사고 방지다. 그래서 ① 자리를 골랐으면 그 자리로 ② 자리였는데 사람/담임으로
      //    바꿨으면 지우고(안 지우면 화면엔 사람인데 라벨은 LAB인 유령이 남는다) ③ 그 외엔 승계.
      slotTeacherLabel: s.seatLabel
        ? s.seatLabel
        : specialSlotLabel(prior?.slotTeacherLabel)
          ? null
          : (prior?.slotTeacherLabel ?? null),
      slotRoomLabel: prior?.slotRoomLabel ?? null,
      periodLabel: prior?.periodLabel ?? null,
      mergeGroup: prior?.mergeGroup ?? null,
    } satisfies PreservedSlot;
  });
}
