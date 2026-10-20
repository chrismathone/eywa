"use client";

import { skipParentRide } from "../../ride-change/server/parent-ride-actions";
import { DIRECTION_LABEL, type Direction } from "../../types";
import { ReasonDialog } from "./reason-dialog";
import { useRideDates } from "./ride-dates-context";

/**
 * 학부모 '등원만/하원만 타지 않기' — 누르면 **짧은 사유**를 받고 저장한다(사용자 2026-09-29).
 * 저장되면 카드의 그 구간이 흐려지고 "등원차를 타지 않습니다"가 뜬다 — 다시 타려면 [등원 수정하기]에서 시간을 고른다.
 */
export function SkipRideButton({
  studentId,
  onDate,
  direction,
}: {
  studentId: string;
  onDate: string;
  direction: Direction;
}) {
  const word = DIRECTION_LABEL[direction];
  const dates = useRideDates();
  return (
    <ReasonDialog
      // 두 줄('등원만' / '타지 않기')로 접어 폭을 줄인다.
      triggerClassName="border-danger text-danger flex shrink-0 flex-col items-center rounded-md border px-1.5 py-0.5 text-xs leading-tight font-bold"
      trigger={
        <>
          <span>{word}만</span>
          <span>타지 않기</span>
        </>
      }
      title={`${word}만 타지 않기`}
      description={`${dates ? `선택한 ${dates.length}일 모두 같은 내용으로 바뀌어요. ` : ""}이유를 짧게 남겨 주세요. 학원 선생님이 확인해요.`}
      confirmLabel={`${word} 안 하기`}
      placeholder="예: 병원 진료가 있어 직접 데려가요"
      onSubmit={(reason) => skipParentRide({ studentId, onDate, ioKind: direction, reason, dates })}
    />
  );
}
