"use client";

import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * '일괄 출석'(빠른 출결) 버튼 — 지금 보이는 학생 중 **아직 출결 기록이 없는 칸만** 출석으로 찍는다.
 *
 * 원장 2026-08-18: *"수학 수업 보고서 표 모드에서 학생, 반 옆에 '일괄 출석' 라벨 추가. 일괄 출석
 * 누르면 전부 출석으로 체크. 추후에 지각·결석으로 담당이 변경 가능하게."* (+ 카드 모드도 같은 자리)
 * → 표 모드는 표 머리글 `학생 · 반` 칸, 카드 모드는 좌측 학생 목록 머리 `학생 · 반별` 줄. 두 화면이
 *   같은 버튼·같은 숫자를 쓰도록 **여기 한 벌**로 둔다(따로 만들면 두 화면이 다른 수를 말한다).
 *
 * 🔴 **확인창이 없다**(원장이 ECS에서 "창 없이 한 번에"로 확정, 2026-08-14). 이미 찍힌 출결은 절대
 *    건드리지 않는 비파괴 동작이라 되돌릴 일이 안 생긴다 — 그래서 한 번에 끝낸다.
 * 🔴 **지각·결석 일괄은 없다**(같은 이유로 ECS에서 뺐다) — 값을 고르는 단계가 생기면 창 열기 →
 *    고르기 → 누르기 세 동작이 된다. 찍은 뒤 개별 학생을 지각·결석으로 바꾸는 길은 출결 알약
 *    ([attendance-pills.tsx](./attendance-pills.tsx))에 그대로 열려 있고, 여기서 그 길을 잠그지 않는다.
 * ⚠️ 숫자는 **명이 아니라 칸**이다(한 학생이 두 반이면 2) — 실제로 기록되는 칸 수라야 라벨이 사실이다.
 *    툴팁이 그 사실을 밝힌다. 0이면 비활성 = 누를 게 없다는 걸 눌러보기 전에 알린다.
 */
export type BulkPresentProps = {
  /** 기록 없는 칸 수 — 라벨에 그대로 붙는다. 0이면 비활성. */
  count: number;
  /** 이미 출결이 찍혀 손대지 않는 칸 수 — 0건일 때 "왜 0인지"를 말하기 위한 재료. */
  alreadyMarked: number;
  /** 저장 왕복 중 — 연타 방지. */
  busy: boolean;
  onApply: () => void;
};

export function BulkPresentButton({ count, alreadyMarked, busy, onApply }: BulkPresentProps) {
  const t = useSheetT();
  const tf = useSheetTf();
  const disabled = count === 0 || busy;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onApply}
      title={
        count > 0
          ? tf("os.present.title", { n: count })
          : alreadyMarked > 0
            ? t("os.present.allDone")
            : t("os.present.none")
      }
      className={`rounded-pill border px-1.5 py-px text-[10px] font-bold whitespace-nowrap transition ${
        disabled
          ? "border-line text-text-faint cursor-default"
          : "border-primary text-primary hover:bg-primary-soft cursor-pointer"
      }`}
    >
      {busy ? t("os.present.busy") : `${t("os.present.btn")}${count > 0 ? ` ${count}` : ""}`}
    </button>
  );
}
