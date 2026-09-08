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

/** "2026-09-04" → "9/4". 이미 KST 날짜 문자열이라 파싱하지 않는다(타임존 되밀림 금지). */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}
