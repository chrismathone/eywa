/**
 * 셔틀 명단 계산 — **순수 함수**(IO 없음, Vitest). "그날 누가 타는가"는 화면·인쇄·출결 신호가
 * 모두 같은 답을 내야 하므로 여기 한 곳에서만 만든다.
 *
 * 🔑 축이 **셋**이고 각각 다른 사실이다 — 섞으면 거짓이 남는다(0229a 머리 주석):
 *    · 정기 배정(`shuttle_riders.weekdays`)      = 요일 규칙   ← 평소
 *    · 일회성 예외(`shuttle_ride_exceptions`)    = 그날만의 덧셈·뺄셈(오늘만 탐/안 탐)
 *    · 등하원 기록(`shuttle_boardings`)          = 실제로 일어난 일
 *    명단 = **요일 매칭 − skip + add**, 그 위에 기록을 겹쳐 "예정 vs 실제"를 만드는 게 이 모듈의 일이다.
 */
import { weekdayIndexOf } from "@/lib/date-kst";
import {
  SHUTTLE_DAYS,
  dayLabel,
  type BoardingStatus,
  type DayCode,
  type Direction,
  type RideExceptionKind,
  type ShuttleRun,
  type ShuttleRider,
} from "./types";

/** 0=일 … 6=토 → DayCode. SHUTTLE_DAYS는 월~일 순서라 인덱스를 직접 쓰면 안 된다. */
const BY_INDEX: DayCode[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** YYYY-MM-DD → 요일 코드. UTC 파싱이라 서버 TZ 무관(date-kst 규약 승계). */
export function dayCodeOf(ymd: string): DayCode {
  return BY_INDEX[weekdayIndexOf(ymd)]!;
}

/**
 * 요일 압축 표기 — `["mon","wed","thu"]` → `"월수목"`. makeedu 표기와 같은 모양이라
 * 이관 뒤에도 눈이 익다. 월~일 고정 순서로 정렬해 입력 순서에 흔들리지 않는다.
 * 7개 전부면 `"매일"`, 월~금 전부(주말 없음)면 `"평일"`로 줄인다(가장 흔한 두 경우).
 */
export function compactWeekdays(days: readonly string[]): string {
  const set = new Set(days);
  const ordered = SHUTTLE_DAYS.filter((d) => set.has(d));
  if (ordered.length === 0) return "";
  if (ordered.length === 7) return "매일";
  const weekdaysOnly = ["mon", "tue", "wed", "thu", "fri"];
  if (ordered.length === 5 && weekdaysOnly.every((d) => set.has(d))) return "평일";
  return ordered.map(dayLabel).join("");
}

/** 그 배정이 이 날짜에 해당하는가 — 요일 규칙만 본다(휴일·결석·일회성 예외는 아래에서 겹친다). */
export function ridesOn(rider: Pick<ShuttleRider, "weekdays">, ymd: string): boolean {
  return rider.weekdays.includes(dayCodeOf(ymd));
}

/**
 * 그날 하루치 예외 한 건(0229a). 조회가 학생 표시 정보까지 붙여 넘긴다 —
 * `add` 줄은 정기 배정이 없어 **이름의 출처가 여기뿐**이다.
 */
export type RideException = {
  id: string;
  studentId: string;
  studentName: string;
  schoolGrade: string;
  /** 재원/퇴원 등 — 화면이 회색 처리에 쓴다. ⚠️ **지어내지 않는다**(조회가 아는 값을 그대로). */
  studentStatus: string;
  kind: RideExceptionKind;
  ioKind: Direction;
  /** `add`일 때만. 어디서 타는지 모르면 기사가 못 태운다. */
  runStopId: string | null;
  memo: string | null;
  /**
   * 누가 건 변경인가(0321a `actor_kind`) — 셔틀 화면이 '학부모 변경'/'직원 변경'을 갈라 보인다(사용자 2026-10-06).
   * 모르면(옛 줄 · 조회 안 함) 생략.
   */
  actorKind?: RideActorKind | null;
  actorName?: string | null;
};

export type RideActorKind = "parent" | "staff";

/** 그 줄이 오늘 어떤 상태인가 — 화면 표식·진행 카운트가 함께 읽는다. */
export type RideDayKind =
  /** 평소대로 요일 규칙에 걸린 줄. */
  | "regular"
  /** 오늘만 추가로 타는 줄(정기 배정에 없다). */
  | "added"
  /** 정기 배정엔 있지만 오늘은 안 타는 줄. 🔴 **지우지 않고 회색으로 남긴다**. */
  | "skipped"
  /**
   * 정기 배정엔 있지만 오늘은 **같은 방향의 '오늘만 승하차'로 대체된** 줄(다른 정류장·다른 차).
   * 🔑 '오늘 안 탐'과 같게 다룬다 — 진행 카운트·기록 매칭·버튼에서 빠진다. 다른 점은 이유뿐이다
   *    (안 타는 게 아니라 **다른 곳에서** 탄다). 학부모 문장에서는 아예 빠진다(대체한 줄이 말한다).
   * 🔴 이게 없던 동안(2026-09-04 '오늘 안 탐' 입구를 닫은 뒤) 같은 회차에서 정류장만 바꾸면 평소 줄이
   *    기록을 채가 "18:31 칠성초 정문에서 내렸어요"처럼 **없던 일**을 학부모에게 보였다.
   */
  | "replaced";

/** 오늘 태울 줄이 아니다(회색 · 진행 카운트 제외 · 탑승 버튼 없음) — 'skipped'·'replaced'를 한 판정으로. */
export function isInactiveDay(kind: RideDayKind): boolean {
  return kind === "skipped" || kind === "replaced";
}

/** 그날 그 회차에서 타기로 되어 있는 사람들(정류장 순서 → 이름 순). */
export type PlannedRide = {
  runId: string;
  runNo: number;
  runStopId: string;
  stopName: string;
  atTime: string | null;
  rider: ShuttleRider;
  dayKind: RideDayKind;
  /** 예외에 적힌 사유(있을 때만). 사유는 **선택**이라 대개 null이다. */
  exceptionMemo: string | null;
  /** 예외 되돌리기에 쓰는 id — 예외로 생긴/막힌 줄에만 있다. */
  exceptionId: string | null;
  /** 그 예외를 건 사람의 종류·이름(있을 때만). */
  exceptionBy?: { kind: RideActorKind; name: string | null } | null;
};

/**
 * 그날 명단 = **요일 매칭 − skip + add**.
 *
 * 🔴 **skip은 줄을 지우지 않는다** — 회색 표식으로 남긴다. 명단에서 통째로 사라지면 셔틀 선생님이
 *    *"원래 타던 애가 왜 없지"* 를 확인할 길이 없다(연락을 못 받은 건지 오늘만 빠진 건지 구분 불가).
 *    화면에서 덜어내는 건 **진행 카운트**뿐이다(`countProgress`).
 * 🔑 skip + add가 **같이 올 수 있다**(0229a: "오늘은 저기 말고 여기서") — 옛 자리는 회색으로 남고
 *    새 자리에 '오늘만 탑승' 줄이 생긴다. 둘 다 보여야 기사가 어디로 갈지 안다.
 * ⚠️ `add`가 이미 요일 규칙에 걸려 있는 사람을 가리키면 **줄을 두 번 만들지 않는다**(같은 학생이
 *    한 회차에 두 줄이면 시수·진행이 두 번 세어진다). 그 경우 예외는 조용히 무시된다.
 */
const byOf = (e: RideException | undefined) =>
  e?.actorKind ? { kind: e.actorKind, name: e.actorName ?? null } : null;

export function plannedRidesOn(
  run: ShuttleRun,
  ymd: string,
  exceptions: readonly RideException[] = [],
): PlannedRide[] {
  const skipKey = (studentId: string, io: Direction) => `${studentId}|${io}`;
  const skips = new Map<string, RideException>();
  // 그날 같은 학생·같은 방향의 '오늘만 승하차' — **어느 회차든**(다른 차로 가는 것도 대체다: 하원을 두 번 할 수는 없다).
  const addsByStudentIo = new Map<string, RideException>();
  const addsByRunStop = new Map<string, RideException[]>();
  for (const e of exceptions) {
    if (e.kind === "skip") {
      skips.set(skipKey(e.studentId, e.ioKind), e);
    } else if (e.runStopId) {
      addsByStudentIo.set(skipKey(e.studentId, e.ioKind), e);
      const list = addsByRunStop.get(e.runStopId) ?? [];
      list.push(e);
      addsByRunStop.set(e.runStopId, list);
    }
  }

  const out: PlannedRide[] = [];
  for (const stop of [...run.stops].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const regular = stop.riders.filter((r) => ridesOn(r, ymd));
    for (const rider of regular) {
      const hit = skips.get(skipKey(rider.studentId, rider.ioKind));
      // 🔑 '오늘 안 탐'이 먼저다. 그다음 같은 방향 '오늘만 승하차'가 **다른 칸**을 가리키면 이 줄은 대체됐다
      //    (같은 칸을 가리키면 아래에서 그 add가 무시되고 이 줄이 그대로 산다 — 중복 줄 금지 규칙).
      const add = hit ? undefined : addsByStudentIo.get(skipKey(rider.studentId, rider.ioKind));
      const replaced = !!add && add.runStopId !== stop.id;
      out.push({
        runId: run.id,
        runNo: run.runNo,
        runStopId: stop.id,
        stopName: stop.stopName,
        atTime: stop.atTime,
        rider,
        dayKind: hit ? "skipped" : replaced ? "replaced" : "regular",
        exceptionMemo: hit?.memo ?? (replaced ? add!.memo : null),
        // 대체된 줄엔 되돌리기 id를 달지 않는다 — 되돌리는 건 '오늘만 승하차' 줄(그 예외)이다.
        exceptionId: hit?.id ?? null,
        exceptionBy: byOf(hit ?? (replaced ? add : undefined)),
      });
    }
    for (const add of addsByRunStop.get(stop.id) ?? []) {
      // 이미 오늘 타기로 되어 있는 사람이면 예외는 없는 것으로 친다(중복 줄 금지).
      if (regular.some((r) => r.studentId === add.studentId && r.ioKind === add.ioKind)) continue;
      out.push({
        runId: run.id,
        runNo: run.runNo,
        runStopId: stop.id,
        stopName: stop.stopName,
        atTime: stop.atTime,
        // 정기 배정이 없는 사람이라 배정 행이 없다 — 화면이 쓰는 모양만 맞춰 세운다.
        // ⚠️ `id`에 예외 id를 그대로 쓰지 않는다(배정 id로 오인해 삭제 액션에 넘기면 엉뚱한 걸 지운다).
        rider: {
          id: `exception:${add.id}`,
          studentId: add.studentId,
          studentName: add.studentName,
          schoolGrade: add.schoolGrade,
          ioKind: add.ioKind,
          weekdays: [dayCodeOf(ymd)],
          memo: null,
          studentStatus: add.studentStatus,
        },
        dayKind: "added",
        exceptionMemo: add.memo,
        exceptionId: add.id,
        exceptionBy: byOf(add),
      });
    }
  }
  return out;
}

/**
 * 예정 × 기록 대조 — 일별 화면과 출결 신호가 함께 쓴다.
 *
 * ⚠️ 기록이 없는 예정은 `null`(아직 안 찍음)이지 미탑승이 **아니다**. 안 찍힌 걸 미탑승으로 읽으면
 *    아침 내내 전원이 미탑승으로 보이고, 그 상태가 출결 신호로 새어나간다.
 */
export type RideRow = {
  key: string;
  runId: string;
  /** 예정에 없던 추가 탑승이면 null(그날만 태운 학생이라 노선 칸이 없다). */
  runStopId: string | null;
  studentId: string;
  studentName: string;
  stopName: string;
  atTime: string | null;
  ioKind: Direction;
  /** 기록이 아직 없으면 null. */
  status: BoardingStatus | null;
  memo: string | null;
  /** 이미 찍힌 기록의 id — 지우기(clearBoarding)에 쓴다. */
  logId: string | null;
  /** 오늘만의 예정 변경(0229a). 기록(`status`)과 **다른 축**이다. */
  dayKind: RideDayKind;
  exceptionMemo: string | null;
  exceptionId: string | null;
  /** 그날 변경을 건 사람(학부모/직원) — 줄 표식이 갈라 보인다. */
  exceptionBy?: { kind: RideActorKind; name: string | null } | null;
};

/**
 * 🔑 대조 키는 **(학생, 회차, 승/하차)** — 노선 칸(run_stop)이 아니다.
 *    `shuttle_boardings`의 유니크 인덱스가 그 축이고, 그래야 정류장을 옮겨도 그날 기록이 붙어 있다
 *    (칸 축으로 맞추면 노선을 고친 순간 그날 찍은 기록이 통째로 "추가 탑승"으로 떨어져 나간다).
 */
export type BoardingLogLike = {
  id: string;
  studentId: string;
  runId: string | null;
  ioKind: Direction;
  status: BoardingStatus;
  memo: string | null;
  stopLabel?: string | null;
};

export function mergePlanAndLog(
  planned: readonly PlannedRide[],
  logs: readonly BoardingLogLike[],
): RideRow[] {
  const key = (studentId: string, runId: string | null, io: Direction) =>
    `${studentId}|${runId ?? ""}|${io}`;
  const byKey = new Map(logs.map((l) => [key(l.studentId, l.runId, l.ioKind), l]));

  const build = (p: PlannedRide, hit: BoardingLogLike | undefined): RideRow => ({
    // 🔴 화면 key는 **대조 키와 달라야 한다** — 한 회차 안에서 skip + add를 같이 걸면(정류장을 그날만
    //    바꾸는 흔한 경우) 같은 (학생·회차·방향)으로 **두 줄**이 생긴다. 대조 키를 그대로 쓰면 React
    //    key가 겹쳐 줄이 뒤섞인다. 오늘만 타는 줄에만 예외 id를 덧붙여 가른다(그 줄은 날짜·학생·방향당
    //    하나뿐이라 0229a 유니크가 충돌 불가를 보장한다).
    key: p.dayKind === "added" ? `${key(p.rider.studentId, p.runId, p.rider.ioKind)}|+${p.exceptionId}` : key(p.rider.studentId, p.runId, p.rider.ioKind),
    runId: p.runId,
    runStopId: p.runStopId,
    studentId: p.rider.studentId,
    studentName: p.rider.studentName,
    stopName: p.stopName,
    atTime: p.atTime,
    ioKind: p.rider.ioKind,
    status: hit?.status ?? null,
    memo: hit?.memo ?? null,
    logId: hit?.id ?? null,
    dayKind: p.dayKind,
    exceptionMemo: p.exceptionMemo,
    exceptionId: p.exceptionId,
    exceptionBy: p.exceptionBy ?? null,
  });

  // 🔴 **오늘 타는 줄이 기록을 먼저 가져간다.** 같은 (학생·회차·방향)에 skip 줄과 add 줄이 함께 있으면
  //    기록은 하나뿐인데(0229a 유니크), 정류장 순서대로 집으면 **회색 줄이 기록을 채가고** 정작 태운
  //    자리는 '미기록'으로 남는다. 그래서 두 번 훑는다: 먼저 오늘 타는 줄, 남은 것만 회색 줄로.
  const rows: RideRow[] = new Array<RideRow>(planned.length);
  const take = (p: PlannedRide) => {
    const k = key(p.rider.studentId, p.runId, p.rider.ioKind);
    const hit = byKey.get(k);
    if (hit) byKey.delete(k);
    return hit;
  };
  // 🔑 'replaced'(오늘만 승하차로 대체된 평소 줄)도 회색 줄과 같이 **나중에** 집는다 — 먼저 집으면
  //    다른 정류장에서 찍은 기록을 평소 정류장 이름으로 보여준다(2026-09-27 수정한 결함).
  planned.forEach((p, i) => {
    if (!isInactiveDay(p.dayKind)) rows[i] = build(p, take(p));
  });
  planned.forEach((p, i) => {
    if (isInactiveDay(p.dayKind)) rows[i] = build(p, take(p));
  });

  // 예정에 없는데 기록이 있는 것 = 추가 탑승(그날만 태운 학생). 반드시 남긴다 — 안 그리면 실제로
  // 태운 아이가 명단에서 사라진다.
  for (const leftover of byKey.values()) {
    if (!leftover.runId) continue; // 회차가 지워진 옛 기록 — 이 회차 화면의 줄이 아니다
    rows.push({
      key: key(leftover.studentId, leftover.runId, leftover.ioKind),
      runId: leftover.runId,
      runStopId: null,
      studentId: leftover.studentId,
      studentName: "",
      stopName: leftover.stopLabel ?? "",
      atTime: null,
      ioKind: leftover.ioKind,
      status: leftover.status,
      memo: leftover.memo,
      logId: leftover.id,
      // 예정에 없던 기록이라 오늘의 **예정 변경**과는 무관하다 — 예외로 생긴 줄이 아니다.
      dayKind: "regular",
      exceptionMemo: null,
      exceptionId: null,
    });
  }
  return rows;
}

