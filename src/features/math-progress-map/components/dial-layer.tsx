import type { ReactNode } from "react";
import { VIEWBOX } from "../geometry";
import styles from "./year-transition.module.css";

/** 같은 viewBox를 겹쳐 배치한다. HTML 레이어가 회전하고 SVG 칸은 원래 좌표와 클릭 영역을 유지한다. */
export function DialLayer({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={styles.layer} data-dial-layer={name}>
      <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="block h-auto w-full" role="presentation">
        {children}
      </svg>
    </div>
  );
}
