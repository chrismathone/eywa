"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { DetailPopup } from "./detail-popup";
import { useDashboardCardId } from "./card-id";
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
  detailPrefix,
  labelNote,
  labelNoteLead,
  icon,
  error,
  popupTitle,
  popupWide,
  jump,
  helpKey,
  rename,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  detail: string;
  labelNote?: string;
  /**
   * 꼬리표 앞말(예: '지난달') — 자리가 있을 때만 보인다. 모자라면 앞말이 통째로 빠지고 `labelNote`(예: '(26.10)')가 남는다
   * (말줄임으로 뒤쪽 달이 잘리지 않게 · 운영실 퇴원 칸).
   */
  labelNoteLead?: string;
  /**
   * 접근성 설명과 오류 팝업 앞에 **항상** 붙는 말(기준일 등).
   * 🔴 실패 문구는 `detail`을 통째로 대체한다 — 숫자의 뜻을 정하는 값(어느 날 숫자인가)을 `detail`에 넣으면
   *    30초 갱신이 한 번 실패한 순간 사라져, 형제 칸이 다 오늘인 줄에서 **어제 숫자가 오늘로 읽힌다**.
   *    그런 값은 이 prop으로 넘긴다(실패 상태에서도 남는다).
   */
  detailPrefix?: string;
  icon: ReactNode;
  error?: boolean;
  popupTitle: string;
  jump: KpiJump;
  /** F1 겹침 키 — manuals/dashboard.ts callouts[].key */
  helpKey?: string;
  /**
   * 학원 설정 '대시보드 관리'에서 바꾼 이름 — 보이는 이름만 바꾼다. 칸의 정체(`data-kpi` = 원래 `label`)는 그대로라
   * 최근 결석의 붉은 색 같은 칸 규칙이 이름을 바꿔도 따라간다.
   */
  rename?: string;
  /** 넓은 팝업(명단 2단) — `DetailPopup` `wide`. */
  popupWide?: boolean;
  children: ReactNode;
}) {
  const cardId = useDashboardCardId();
  const missing = value === "—";
  const body = error ? (missing ? "조회 실패 · 다시 확인 필요" : "갱신 실패 · 이전 확인값") : detail;
  const text = detailPrefix ? `${detailPrefix} · ${body}` : body;
  const name = rename ?? label;
  return (
    <div className={s.kpi} data-overview="kpi" data-kpi={label} data-help={helpKey} data-dashboard-card={cardId}>
      <DetailPopup
        title={popupTitle}
        wide={popupWide}
        ariaLabel={`${name} ${value}${missing ? "" : unit}. ${text}. 자세히 보기`}
        trigger={<button type="button" className={s.kpiBody} />}
        label={
          <>
            <span className={s.kpiLabel} data-overview="kpi-label">
              <span className={s.kpiIcon}>{icon}</span>
              <span className={s.kpiName}>{name}</span>
              {labelNote && (labelNoteLead ? (
                // 순서를 거꾸로 두고(row-reverse) 한 줄만 보이게 — 달이 먼저 자리를 잡고, 앞말은 남는 자리에 들어갈 때만 보인다.
                <small className={`${s.kpiPeriod} ${s.kpiPeriodSplit}`} title={`${labelNoteLead} ${labelNote}`}>
                  <span>{labelNote}</span>
                  <span>{labelNoteLead}</span>
                </small>
              ) : (
                <small className={s.kpiPeriod}>{labelNote}</small>
              ))}
              {error && <span className={s.textDanger} title={body} aria-hidden>!</span>}
            </span>
            <span className={s.kpiValue} data-overview="kpi-value">
              {value}
              <span>{missing ? "" : unit}</span>
            </span>
          </>
        }
      >
        {error && <p className={s.textDanger} role="status">{text}</p>}
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
