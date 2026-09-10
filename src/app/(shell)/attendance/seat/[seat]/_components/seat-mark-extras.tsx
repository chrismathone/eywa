"use client";

import { useEffect, useRef, useState } from "react";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";

/**
 * 자리 출석부(랩실·JJ실)의 **결·지 버튼 + 사유 칸** — 두 화면이 쓰는 한 벌.
 *
 * 원장 2026-09-08: *"jj실 출석부도 결석 누르면 사유 입력할 수 있게. 지각도 만들어주고. 다른 출결과
 * 동일하게"* → *"지각 및 사유는 JJ/LAB 둘다 동일"*.
 *
 * 🔴 **두 화면이 이 한 파일을 쓴다** — 랩실·JJ실에 각자 버튼을 그리면 한쪽만 고쳐진다(그 갈림이
 *    바로 오늘 고친 `seatMarkOf` 사고였다).
 * ⚠️ 저장 상태 3종(출석·결석·지각)은 **자리판의 계약 그대로**다 — 조퇴·공결·보강은 출석부 전용이라
 *    여기서 만들지 않는다(`setSeatCell`이 그 값을 거절한다).
 */

/** 결·지 두 개짜리 토글 — 이미 그 상태면 안 그린다(누를 이유가 없다). */
export function SeatMarkButtons({
  cur,
  studentName,
  pending,
  compact,
  onMark,
}: {
  cur: SeatStatus | null;
  studentName: string;
  pending: boolean;
  /** 랩실 카드처럼 자리가 좁으면 true — 크기만 한 단계 작아진다. */
  compact?: boolean;
  onMark: (next: SeatStatus) => void;
}) {
  const size = compact ? "size-5" : "size-6";
  return (
    <>
      {cur !== "absent" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onMark("absent")}
          aria-label={`${studentName} 결석`}
          title="결석"
          className={`border-line bg-card text-text-faint hover:text-att-absent-ink grid ${size} place-items-center rounded-full border text-xs font-bold`}
        >
          결
        </button>
      ) : null}
      {cur !== "late" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => onMark("late")}
          aria-label={`${studentName} 지각`}
          title="지각"
          className={`border-line bg-card text-text-faint hover:text-att-late-ink grid ${size} place-items-center rounded-full border text-xs font-bold`}
        >
          지
        </button>
      ) : null}
    </>
  );
}

/**
 * 사유 칸 — **결석·지각일 때만** 뜬다.
 *
 * 🔑 사유는 **나중에·선택**이다(출결 모드 결석 패널과 같은 계약) — 먼저 상태를 찍고, 사유는 알게 되면
 *    적는다. 그래서 이 칸이 비어 있어도 아무것도 막지 않는다.
 * ⚠️ 컨트롤드 입력에 서버 값을 그대로 물리면 디바운스 저장이 끝날 때마다 커서가 튄다 → 로컬 state를
 *    두고 **바깥 값이 실제로 달라졌을 때만** 맞춘다.
 */
export function SeatReasonInput({
  value,
  status,
  studentName,
  disabled,
  onChange,
}: {
  value: string | null;
  status: SeatStatus | null;
  studentName: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const outside = useRef(value ?? "");
  useEffect(() => {
    const next = value ?? "";
    if (next !== outside.current) {
      outside.current = next;
      setText(next);
    }
  }, [value]);

  if (status !== "absent" && status !== "late") return null;
  const label = status === "absent" ? "결석 사유" : "지각 사유";
  return (
    <input
      value={text}
      disabled={disabled}
      maxLength={60}
      aria-label={`${studentName} ${label}`}
      placeholder={label}
      onChange={(e) => {
        setText(e.target.value);
        outside.current = e.target.value;
        onChange(e.target.value);
      }}
      className="border-line bg-card placeholder:text-text-faint w-full rounded-md border px-1.5 py-0.5 text-xs disabled:opacity-60"
    />
  );
}

/**
 * **지난 결석 사유** 한 줄 — 원장 2026-09-08 *"JJ와 LAB 수업의 경우 이전수업이 결석인 경우에 사유를
 * 확인할 수 있도록"*.
 *
 * 🔴 오늘 칸이 이미 찍혔으면 안 보여 준다 — 오늘 사유 칸 바로 옆에 지난 사유가 나란히 서면 어느 것이
 *    오늘 것인지 헷갈린다(그게 지금 고치고 있는 종류의 버그다).
 * ⚠️ 사유가 없으면 날짜만 적는다 — "결석했는데 사유는 안 적혀 있다"도 알아야 할 사실이다.
 */
export function PrevAbsenceHint({
  prev,
  cur,
}: {
  prev: { date: string; note: string | null } | null | undefined;
  cur: SeatStatus | null;
}) {
  if (!prev || cur !== null) return null;
  const md = monthDay(prev.date);
  return (
    <p
      className="text-att-absent-ink/80 truncate text-xs"
      title={`지난 수업(${prev.date}) 결석${prev.note ? ` · ${prev.note}` : " — 사유 미기재"}`}
    >
      지난 결석 {md}
      {prev.note ? ` · ${prev.note}` : ""}
    </p>
  );
}

/**
 * 같은 날 교시 사이 신호 **한 묶음** — 표 두 벌이 그대로 물려 받는다(props를 셋으로 늘리지 않는다).
 * 🔴 `nextStartByStudent`는 **로그인 화면에서만** 채워진다(비로그인 PIN엔 새 정보를 안 내려보낸다).
 */
export type SeatPeriodHintData = {
  /** `classId|studentId` → 앞 교시 시각("HH:MM"). 상태로 안 걸러진 채 온다. */
  prevAbsentByCell?: Readonly<Record<string, string>>;
  /** 학생 id → 오늘 이 자리에서 다시 오는 다음 교시 시각("HH:MM"). */
  nextStartByStudent?: Readonly<Record<string, string>>;
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
 * ⚠️ '다음'은 **이 자리 교시만** 본다. 그래서 아무것도 안 적힌 줄은 "오늘 수업이 더 없다"가 아니라
 *    "이 방에는 더 안 온다"이고, 그 사실을 툴팁이 밝힌다.
 *
 * 🔴 **한 줄에 이어 붙이지 말 것 · `truncate` 금지.** 이 줄이 들어가는 JJ 표 출결 칸은 콘텐츠 폭이
 *    **≈80px**다(열 최소 440px × 20%, 그 20%는 「결석 사유」 4글자가 겨우 들어가게 잡은 수치다).
 *    둘을 `·`로 잇고 자르면 뒤쪽 '다음 17:20'이 **어떤 창 폭에서도 화면에 안 나온다**(적대 리뷰 2026-09-10).
 *    그래서 **각자 제 줄**에서 어절 단위로 접힌다(`break-keep`) — 줄이 늘어도 안 보이는 것보단 낫다.
 */
export function SeatPeriodHints({
  prevAbsentStart,
  nextStart,
  seatName,
  cur,
}: {
  /** 그 학생의 바로 앞 교시가 결석이면 그 교시 시각("HH:MM"), 아니면 null. */
  prevAbsentStart: string | null | undefined;
  /** 오늘 이 자리에서 다시 오는 다음 교시 시각("HH:MM"), 없으면 null. */
  nextStart: string | null | undefined;
  seatName: string;
  cur: SeatStatus | null;
}) {
  const showPrev = !!prevAbsentStart && cur === null;
  if (!showPrev && !nextStart) return null;
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
          className="text-text-dim text-xs leading-tight break-keep"
          title={`오늘 ${seatName} ${nextStart} 교시 명단에도 있습니다 — 이 자리 교시만 봅니다`}
        >
          다음 {nextStart}
        </p>
      ) : null}
    </>
  );
}

/** "2026-09-04" → "9/4". 이미 KST 날짜 문자열이라 파싱하지 않는다(타임존 되밀림 금지). */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}
