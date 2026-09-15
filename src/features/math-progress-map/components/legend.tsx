import { FOCUS_FILL, FOCUS_INK, HOLIDAY_FILL, HOLIDAY_INK, LEGEND_ORDER, NO_CLASS_FILL, NO_CLASS_INK, STATUS_FILL, STATUS_LABEL, TICK_FILL, TODAY_STROKE } from "../palette";
import { EyIcon } from "@/components/icons/eywa-icons";
import styles from "./progress-map.module.css";

/** 상태 범례 — 완료 · 진행 중 · 미학습 · 예정 · 휴강/계획 없음. 분기 색은 범례에 없다(자리 표시일 뿐 상태가 아니다). */
export function Legend({ navy = false }: { navy?: boolean }) {
  const swatchTheme = navy ? styles.dialTheme : "";
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1" aria-label="상태 범례">
      {LEGEND_ORDER.map((s) => (
        <li key={s} className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
          <span
            className={`${swatchTheme} inline-block size-3 rounded-full`}
            style={{ background: navy ? TICK_FILL[s] : STATUS_FILL[s], boxShadow: s === "no-plan" || s === "planned" ? "inset 0 0 0 1px var(--line-strong)" : undefined }}
            aria-hidden
          />
          {STATUS_LABEL[s]}
        </li>
      ))}
      <li className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
        <span className={`${swatchTheme} inline-block size-3 rounded-full border`} style={{ background: HOLIDAY_FILL, borderColor: HOLIDAY_INK }} aria-hidden />
        공휴일
      </li>
      <li className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
        <span className={`${swatchTheme} inline-block size-3 rounded border`} style={{ background: NO_CLASS_FILL, borderColor: NO_CLASS_INK }} aria-hidden />
        수업 없음
      </li>
      <li className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
        <span className={`${swatchTheme} inline-flex size-3 items-center justify-center rounded`} style={{ color: FOCUS_INK, background: FOCUS_FILL }} aria-hidden><EyIcon name="check" size={10} /></span>
        선택한 곳
      </li>
      <li className="text-text-dim flex items-center gap-1.5 text-xs font-medium">
        <span className="inline-block size-3 rounded border-2 border-dashed bg-background" style={{ borderColor: TODAY_STROKE }} aria-hidden />
        현재 날짜
      </li>
    </ul>
  );
}
