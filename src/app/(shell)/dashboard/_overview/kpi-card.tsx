"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";

/** ↗(목적지 창) — 목적지 메뉴를 열 수 없으면 null. */
export type KpiJump = { href: string; label: string } | null;

/**
 * KPI 카드 한 칸 — **몸통 = 팝업을 여는 버튼**, **↗ = 목적지 창을 여는 형제 링크**.
 * 🔴 둘을 중첩하지 않는다(버튼 안에 링크 금지 — 누르는 곳마다 다른 일이 일어나는 대화형 요소 중첩).
 * 카드 숫자·팝업 숫자·목적지 숫자는 같은 함수에서 나온 같은 값이다(호출부가 같은 배열을 넘긴다).
 */
export function KpiCard({
  label,
  value,
  unit,
  detail,
  icon,
  error,
  popupTitle,
  jump,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  detail: string;
  icon: ReactNode;
  error?: boolean;
  popupTitle: string;
  jump: KpiJump;
  children: ReactNode;
}) {
  const missing = value === "—";
  const text = error ? (missing ? "조회 실패 · 다시 확인 필요" : "갱신 실패 · 이전 확인값") : detail;
  return (
    <div className={s.kpi}>
      <DetailPopup
        title={popupTitle}
        ariaLabel={`${label} ${value}${missing ? "" : unit}. ${text}. 자세히 보기`}
        trigger={<button type="button" className={s.kpiBody} />}
        label={
          <>
            <span className={s.kpiLabel}>
              <span className={s.kpiIcon}>{icon}</span>
              <span>{label}</span>
            </span>
            <span className={s.kpiValue}>
              {value}
              <span>{missing ? "" : unit}</span>
            </span>
            <span className={`${s.kpiDetail} ${error ? s.textDanger : ""}`}>{text}</span>
          </>
        }
      >
        {children}
      </DetailPopup>
      {jump ? (
        <WindowLink href={jump.href} className={s.kpiJump} ariaLabel={jump.label}>
          <EyIcon name="externalLink" size={14} aria-hidden />
        </WindowLink>
      ) : null}
    </div>
  );
}
