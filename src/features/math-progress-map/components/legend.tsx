import { LEGEND_ORDER, STATUS_FILL, STATUS_LABEL } from "../palette";

/** 상태 범례 — 완료 · 진행 중 · 미학습 · 예정 · 휴강/계획 없음. 분기 색은 범례에 없다(자리 표시일 뿐 상태가 아니다). */
export function Legend() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1" aria-label="상태 범례">
      {LEGEND_ORDER.map((s) => (
        <li key={s} className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
          <span
            className="inline-block size-3 rounded-full"
            style={{ background: STATUS_FILL[s], boxShadow: s === "no-plan" ? "inset 0 0 0 1px var(--line-strong)" : undefined }}
            aria-hidden
          />
          {STATUS_LABEL[s]}
        </li>
      ))}
      <li className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
        <span className="border-primary inline-block size-3 rounded-full border-2 bg-white" aria-hidden />
        오늘 · 고른 곳
      </li>
    </ul>
  );
}
