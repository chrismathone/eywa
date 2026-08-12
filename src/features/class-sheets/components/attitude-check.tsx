"use client";

/**
 * 태도 **체크 칸** — 누를 때마다 매우 좋음 → 좋음 → 보통 → 안좋음 → 매우 안좋음 → 선택 안 함
 * (원장 2026-08-11 *"태도도 마찬가지."*). 순서는 [ATTITUDE](@/features/onescreen/attitude) 그대로다.
 *
 * ⚠️ **옛 표기는 지우지도, 순환에 끼우지도 않는다.** 실데이터에 `완`·`최고`·`최고 책없음` 같은 자유입력이
 *    남아 있어(태도가 출결 대용으로 쓰이던 시절) 값은 그대로 보여 주되, 손대는 순간 새 눈금 첫 값으로
 *    옮긴다. 순환에 끼우면 다시 만들 수도 없는 값이 단계로 살아남아 영영 안 없어진다.
 * ⚠️ 출결과 달리 여기엔 '지울 수 없는 기록'이 없다 — 태도는 시수·급여에 안 닿아서 선택 안 함이 그냥 저장된다.
 */
import { ATTITUDE } from "@/features/onescreen/attitude";
import { nextCycleValue } from "../lib/mark-cycle";
import { SHEET_BOX, SHEET_BOX_READONLY } from "../ui-box";

export function AttitudeCheck({
  value,
  studentName,
  canEdit,
  onSet,
}: {
  value: string | null;
  studentName: string;
  canEdit: boolean;
  onSet: (next: string | null) => void;
}) {
  // 읽기 전용 행도 **값은 보여준다**(옛 표기 포함) — 숨기면 기록이 증발한다.
  if (!canEdit) return <span className={SHEET_BOX_READONLY}>{value ?? "—"}</span>;

  const known = value !== null && (ATTITUDE as readonly string[]).includes(value);
  return (
    <button
      type="button"
      onClick={() => onSet(nextCycleValue(value, ATTITUDE))}
      aria-label={`${studentName} 태도 — ${value ?? "선택 안 함"}`}
      title={
        known || value === null
          ? "클릭할 때마다 매우 좋음 → 좋음 → 보통 → 안좋음 → 매우 안좋음 → 선택 안 함"
          : `이전 표기 "${value}" — 누르면 새 눈금(매우 좋음)으로 바뀝니다`
      }
      className={`${SHEET_BOX} hover:bg-bg-soft inline-flex w-full cursor-pointer items-center justify-center px-0.5 transition ${
        value === null ? "text-text-faint" : known ? "text-foreground" : "text-text-dim"
      }`}
    >
      <span className="truncate">{value ?? "—"}</span>
    </button>
  );
}
