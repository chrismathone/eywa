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
  /**
   * LAB 자리 교시의 '따로 수업(*LAB)' 표식(0271a) — **폼이 보냈을 때만** 값이 있다.
   * undefined = 폼이 이 칸을 안 보냈다(옛 탭·다른 입력 경로) → 기존 행 값을 승계한다(`isSpecialProvided`와 같은 규약).
   */
  labSeparate?: boolean;
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
  /** 0271a 표식. 칸을 못 읽었으면 undefined(= false로 본다 — 호출부가 그때는 쓰기에서 칸을 뺀다). */
  labSeparate?: boolean;
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

export type PreservedSlot = Omit<IncomingSlot, "explicitTime" | "labSeparate"> & {
  validFrom: string;
  validTo: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  periodLabel: string | null;
  mergeGroup: string | null;
  /** 최종 표식 — **LAB 자리 교시에서만** true일 수 있다(`resolveLabSeparate`). */
  labSeparate: boolean;
};

/**
 * 강의실 라벨 — **강의실을 바꿨거나 새 교시에 강의실을 골랐으면 그 강의실 이름**, 강의실을 비웠으면 null, 그 외엔 승계.
 * 🔴 같은 사실(강의실)을 FK(`classroom_id`)와 라벨 두 벌로 든다([[#115]]). 예전엔 라벨을 늘 옛 행에서 승계해, 반 수정에서
 *    강의실을 602→605로 바꾸면 FK만 605가 되고 라벨은 602로 남았다 — 설정 화면(FK)은 605, 시간표(라벨 우선)는 602,
 *    시트 가져오기(라벨 비교)도 602로 읽었다(원장 2026-11-02 PL3a *"왜 설정값과 시간표가 다를까? 수요일 605호인데"*).
 *    이름을 모르면(조회 실패) null — 옛 강의실 라벨을 남기는 것보다 FK 이름으로 떨어지는 편이 맞다.
 */
function resolveSlotRoomLabel(
  s: IncomingSlot,
  prior: PriorSlot | undefined,
  roomNames: ReadonlyMap<string, string> | undefined,
): string | null {
  const next = s.classroomId ?? null;
  if (prior && next === (prior.classroomId ?? null)) return prior.slotRoomLabel ?? null;
  return next ? (roomNames?.get(next) ?? null) : null;
}

/** 재삽입 라벨 규칙 — 자리를 골랐으면 그 자리, 자리였다가 풀었으면 null, 그 외엔 승계. */
function resolveSlotTeacherLabel(s: IncomingSlot, prior: PriorSlot | undefined): string | null {
  return s.seatLabel
    ? s.seatLabel
    : specialSlotLabel(prior?.slotTeacherLabel)
      ? null
      : (prior?.slotTeacherLabel ?? null);
}

/**
 * '따로 수업(*LAB)' 표식의 최종 값 — 원장 2026-09-17 *"랩실 옆에 토글키를 두고 토글하게 되면 LAB -> *LAB"*.
 * 🔴 **LAB 자리 교시에서만** 켜질 수 있다 — LAB을 JJ·강사로 바꾸면 표식도 꺼진다(남겨 두면 다시 LAB으로 되돌릴 때
 *    예전 표식이 유령처럼 되살아난다). 폼이 값을 안 보냈으면(undefined) 기존 행 값을 승계한다.
 */
export function resolveLabSeparate(s: IncomingSlot, prior: PriorSlot | undefined): boolean {
  if (specialSlotLabel(resolveSlotTeacherLabel(s, prior)) !== "LAB") return false;
  return s.labSeparate ?? prior?.labSeparate ?? false;
}

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

/**
 * 이 슬롯의 **이력 있는 값**이 바뀌었나 — 담당·강의실·(폼 값이 이기는) 종료시각.
 *
 * 🔴 '따로 수업(*LAB)' 표식은 **여기 넣지 않는다**(원장 2026-09-18 *"분명히 pl1b에서 설정을 했는데 반영되지 않음"*).
 *    9/17엔 표식도 "오늘부터 새 구간"으로 갈랐는데, 그러면 켠 날 이전 요일(이번 주 화요일)은 옛 행이라 통합뷰가
 *    `LAB` 그대로였다 — 설정했는데 지금 보는 시간표에 안 뜬다. 표식은 **표시 전용**(lab-separate.ts)이라 이력으로
 *    남길 사실이 아니다 → 그 행을 **제자리에서 고친다**(재삽입 값은 `resolveLabSeparate`가 그대로 싣는다).
 *    담당·강의실이 함께 바뀐 저장은 종전대로 가르고, 새 행이 표식을 들고 간다.
 */
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
  /**
   * 폼이 보낸 운영 **종료일**이 오늘보다 앞이면(= 이미 끝난 구간으로 저장) 값이 바뀐 짝은 **마감 행을 안 만든다**.
   * 재삽입 행이 옛 시작일 그대로 그 구간을 덮으므로(`preserveScheduleFields`의 `endedBeforeToday`), 마감 행을
   * 함께 만들면 같은 구간이 두 줄이 된다. 사라진 슬롯의 마감은 그대로다(그건 "어제까지 있었다"가 맞다).
   */
  periodValidTo?: string | null;
}): (PriorSlot & { validTo: string })[] {
  const matched = matchIncomingToPrior(input.incoming, input.prior);
  const keptPairs = new Map<PriorSlot, IncomingSlot>();
  input.incoming.forEach((s, i) => {
    const p = matched[i];
    if (p) keptPairs.set(p, s);
  });
  const cutoff = dayBefore(input.today);
  const endedBeforeToday =
    !!input.periodValidTo && String(input.periodValidTo).slice(0, 10) < input.today;
  const out: (PriorSlot & { validTo: string })[] = [];
  for (const p of input.prior) {
    // 오늘 시작한 행은 과거가 없다 — 마감하면 거꾸로 된 구간이 된다.
    if (p.validFrom && String(p.validFrom).slice(0, 10) >= input.today) continue;
    const pair = keptPairs.get(p);
    // 짝이 없으면 '사라진 슬롯'(그 배치는 어제까지 있었다), 짝이 있어도 값이 바뀌었으면 옛 값을 남긴다.
    if (pair && !slotChanged(pair, p, input.periodPairs)) continue;
    // 이미 끝난 구간으로 저장하는 중이면 그 짝은 재삽입 행이 옛 시작일 그대로 덮는다 — 마감 행을 또 만들지 않는다.
    if (pair && endedBeforeToday) continue;
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
  /** 강의실 id → 이름 — 강의실을 바꾼 교시의 라벨을 새 강의실로 맞춘다(`resolveSlotRoomLabel`). */
  roomNames?: ReadonlyMap<string, string>;
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
    // 🔴 가른 행은 **오늘부터**다 — 수정 폼은 늘 운영 기간을 보내고(교시 시작일이 같으면 그 날짜로 채운다),
    //    그 값이 이기면 새 행이 9/1부터 시작해 **어제까지로 마감한 옛 행과 겹친다**. 토글을 누를 때마다 겹친 행이
    //    하나씩 늘었다(적대적 리뷰 2026-09-17 — 담당·강의실 변경에도 있던 결함). 폼이 **오늘보다 뒤** 날짜를 보냈을
    //    때만 그 날짜가 이긴다(개강을 미루는 명시 입력).
    //    **오늘 이미 가른 행**(시작일 = 오늘)도 같다 — 같은 날 한 번 더 저장하면 splitToday는 거짓이지만, 그 행 뒤엔
    //    어제까지로 마감한 옛 행이 있어 폼 시작일(9/1)로 늘리면 다시 겹친다.
    const formFrom = input.period.provided ? input.period.validFrom : null;
    const startedToday = !!prior?.validFrom && String(prior.validFrom).slice(0, 10) === input.today;
    // 종료일: 값이 들어오면 언제나 전 행에 적용(폼 안내 그대로). **비어 있을 때만** 해석이 갈린다 —
    // 평소엔 "명시적 무기한"(되돌리기), keepValidTo면 "안 정함"(교시별 기존값 유지).
    const keepTo = input.period.keepValidTo === true && input.period.validTo === null;
    const validTo =
      input.period.provided && !keepTo ? input.period.validTo : (prior?.validTo ?? null);
    // 🔴 **이미 끝난 구간이면 오늘로 당기지 않는다**(재리뷰 2026-09-17) — "어제부로 반을 끝내며 담당도 바로잡는"
    //    저장에서 시작일만 오늘이 되면 `시작 9/17 > 종료 8/31`인 **역전 행**이 되고, 그 행은 어떤 날짜 창 조회에도
    //    안 걸려 화면에서 통째로 사라진다(다음 저장의 삭제 대상에서도 빠진다 — 유령 행).
    const endedBeforeToday = !!validTo && String(validTo).slice(0, 10) < input.today;
    const validFrom =
      (splitToday || startedToday) && !endedBeforeToday
        ? formFrom && String(formFrom).slice(0, 10) > input.today
          ? formFrom
          : input.today
        : (formFrom ?? inheritedFrom);
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
      slotTeacherLabel: resolveSlotTeacherLabel(s, prior),
      slotRoomLabel: resolveSlotRoomLabel(s, prior, input.roomNames),
      periodLabel: prior?.periodLabel ?? null,
      mergeGroup: prior?.mergeGroup ?? null,
      labSeparate: resolveLabSeparate(s, prior),
    } satisfies PreservedSlot;
  });
}

/**
 * 감사로그용 — 이번 저장에서 '따로 수업(*LAB)' 표식이 **켜지거나 꺼진** 교시(`preserveScheduleFields`와 같은 짝).
 * 새로 만든 LAB 교시를 켠 채로 넣은 것도 "켬"으로 센다(없던 표식이 생겼다).
 */
export function labSeparateChanges(
  incoming: IncomingSlot[],
  prior: PriorSlot[],
): { dayOfWeek: string; startTime: string; on: boolean }[] {
  const matched = matchIncomingToPrior(incoming, prior);
  const out: { dayOfWeek: string; startTime: string; on: boolean }[] = [];
  incoming.forEach((s, i) => {
    const p = matched[i];
    const next = resolveLabSeparate(s, p);
    if (next !== (p?.labSeparate ?? false)) out.push({ dayOfWeek: s.dayOfWeek, startTime: hm(s.startTime), on: next });
  });
  return out;
}
