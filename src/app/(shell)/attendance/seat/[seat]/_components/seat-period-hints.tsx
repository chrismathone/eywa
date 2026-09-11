import type { SeatStatus } from "@/features/attendance/seat/server/actions";

/**
 * 자리 출석부(랩실·JJ실)의 **같은 날 교시 사이 신호** 줄 — 앞 교시 결석 · 다음 행선지 · 마지막 수업(표시 전용).
 * `seat-mark-extras.tsx`(출결 버튼·사유 팝업)에서 떼어 냈다 — 저장 조각과 섞일 이유가 없고, 두 표(랩실 카드·JJ 행)가
 * 이 한 벌을 그대로 쓴다(적대 리뷰 2026-09-11: 한 파일 200줄).
 */

/**
 * 같은 날 교시 사이 신호 **한 묶음** — 표 두 벌이 그대로 물려 받는다(props를 셋으로 늘리지 않는다).
 * 🔴 다음 행선지·마지막 수업은 **로그인 화면과 공개 PIN 랩실**(`PIN_NOTE_SEATS`, 원장 2026-09-10 *"seat/lab에서도
 *    자리 출석부와 동일해야해"*)에서 채워진다 — JJ실 PIN엔 안 내려간다(그 문은 새 정보를 더하지 않는다).
 *    안 채워지면 그 줄을 안 그린다(기본값을 지어내지 않는다).
 */
export type SeatPeriodHintData = {
  /** `classId|studentId` → 앞 교시 시각("HH:MM"). 상태로 안 걸러진 채 온다. */
  prevAbsentByCell?: Readonly<Record<string, string>>;
  /** 학생 id → **오늘 남은 다음 수업** 시작시각("HH:MM"). 이 자리만이 아니라 오늘 전 과목을 본다. */
  nextStartByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → 그 다음 수업의 **강의실 이름**(등록된 정본). 모르면 키가 없다.
   * 🔴 방을 모르면 **시각만** 적는다 — 지어내지 않는다([[#115]]: 라벨이 번호만일 때 정본으로 정규화).
   */
  nextRoomByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → true — 이 교시가 오늘 **마지막 수업**이라고 **확인된** 학생(원장 2026-09-11 *"LAB이나 JJ가 마지막
   * 수업인 학생들은 '마지막 수업'이라고 표시하자"*).
   * 🔴 `nextStartByStudent`에 없다고 마지막이 아니다 — 조회 안 함·실패·대상 밖이면 여기도 비어 있다(모름 ≠ 없음).
   */
  lastByStudent?: Readonly<Record<string, true>>;
  /** 툴팁에 적을 자리 이름(랩실·JJ실) — raw 키(`jj`)를 화면에 내보내지 않는다. */
  seatName: string;
};

/**
 * **같은 날 교시 사이 신호** 한 줄 — 랩실·JJ실이 쓰는 한 벌(원장 2026-09-10:
 * *"이 학생이 이전수업에 결석이였으면 …"* · *"이후에 수업이 남아있으면 다음 수업이 있다고 표시해줘"*).
 *
 * 🔴 **표시만 한다** — 이 줄이 무엇을 자동으로 찍지 않는다. 결석은 사람이 버튼을 누를 때만 찍힌다.
 * 🔴 앞 교시 결석은 **아직 안 찍힌 칸에만** 적는다 — 이미 찍힌 칸 옆에 서면 어느 것이 이 교시의
 *    사실인지 헷갈린다(지난 결석 줄과 같은 규약).
 * ⚠️ 임계값 이름("직전"·"방금") 대신 **실제 교시 시각**을 적는다([[#121]]) — 당번이 그 칩을 눌러
 *    눈으로 대조할 수 있어야 한다.
 * ⚠️ '다음'은 오늘 **전 과목**의 다음 수업이다(이 자리 교시만이 아니다, 2026-09-10). 그래도 아무것도 안 적힌
 *    줄이 "오늘 수업이 더 없다"는 뜻은 아니다 — 조회 안 함(JJ실 PIN)·실패·대상 밖일 수 있다. 그래서
 *    **'마지막 수업'은 조회가 확인한 학생에게만**(`last`, 원장 2026-09-11) 적고, 부재로 추측하지 않는다.
 *
 * 🔴 **한 줄에 이어 붙이지 말 것 · `truncate` 금지.** 이 줄이 들어가는 JJ 표 출결 칸은 콘텐츠 폭이
 *    **≈80px**다(열 최소 440px × 20%, 그 20%는 「결석 사유」 4글자가 겨우 들어가게 잡은 수치다).
 *    둘을 `·`로 잇고 자르면 뒤쪽 '다음 17:20'이 **어떤 창 폭에서도 화면에 안 나온다**(적대 리뷰 2026-09-10).
 *    그래서 **각자 제 줄**에서 어절 단위로 접힌다(`break-keep`) — 줄이 늘어도 안 보이는 것보단 낫다.
 */
export function SeatPeriodHints({
  prevAbsentStart,
  nextStart,
  nextRoom,
  last,
  seatName,
  cur,
}: {
  /** 그 학생의 바로 앞 교시가 결석이면 그 교시 시각("HH:MM"), 아니면 null. */
  prevAbsentStart: string | null | undefined;
  /** 오늘 남은 다음 수업 시작시각("HH:MM"), 없으면 null. */
  nextStart: string | null | undefined;
  /** 그 다음 수업의 강의실 이름 — 모르면 시각만 적는다(지어내지 않는다). */
  nextRoom?: string | null;
  /** 이 교시가 오늘 마지막 수업이라고 **확인됐나** — 모르면 undefined(아무것도 안 적는다). */
  last?: boolean;
  seatName: string;
  cur: SeatStatus | null;
}) {
  const showPrev = !!prevAbsentStart && cur === null;
  // 🔴 '마지막 수업'은 **확인된 사실**일 때만 — 다음 수업이 있으면 그쪽이 이긴다(둘은 함께 설 수 없다).
  const showLast = !nextStart && last === true;
  if (!showPrev && !nextStart && !showLast) return null;
  return (
    <>
      {showPrev ? (
        <p
          className="text-att-absent-ink/80 text-xs leading-tight font-semibold break-keep"
          title={`오늘 ${seatName} ${prevAbsentStart} 교시에 결석으로 찍혀 있습니다`}
        >
          앞 교시({prevAbsentStart}) 결석
        </p>
      ) : null}
      {nextStart ? (
        <p
          className="text-text-dim text-xs leading-tight font-semibold break-keep"
          title={
            nextRoom
              ? `${seatName} 수업이 끝나면 오늘 ${nextStart} ${nextRoom} 수업이 있습니다`
              : `${seatName} 수업이 끝나면 오늘 ${nextStart} 수업이 있습니다 — 강의실이 시간표에 없습니다`
          }
        >
          {/* 🔴 '다음 17:20'은 무엇을 하라는 말인지 안 읽힌다(원장 2026-09-10) — **시각 + 어디로**를 적는다.
              방을 모르면 시각만(지어낸 방 이름은 아이를 엉뚱한 데로 보낸다). */}
          {nextStart} {nextRoom ? `${nextRoom} 이동` : "다음 수업"}
        </p>
      ) : showLast ? (
        <p
          className="text-text-dim text-xs leading-tight font-semibold break-keep"
          title={`${seatName} 수업이 오늘 마지막 수업입니다 — 시간표 기준 오늘 남은 수업이 없습니다`}
        >
          마지막 수업
        </p>
      ) : null}
    </>
  );
}
