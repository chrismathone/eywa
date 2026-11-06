"use client";

import type { RefObject } from "react";
import type { NetHead, NetViewMode } from "./graph";
import styles from "./network.module.css";

/**
 * 네트워크 판의 도구줄 · 범례(시안 `buildNetwork` 마크업) — 표시만 한다. 글은 전부 한국어.
 * 🔑 `data-net-chrome` = 우클릭 되돌아가기를 받지 않는 자리(브라우저 메뉴 그대로 · 시안).
 */

export function NetToolbar({
  head,
  view,
  wide,
  zoomRef,
  onView,
  onZoom,
  onFit,
  onCenter,
  onWide,
}: {
  head: NetHead;
  view: NetViewMode;
  wide: boolean;
  zoomRef: RefObject<HTMLOutputElement | null>;
  onView: (v: NetViewMode) => void;
  onZoom: (f: number) => void;
  onFit: () => void;
  onCenter: () => void;
  onWide: () => void;
}) {
  return (
    <div className={styles.tools} data-net-chrome="">
      <span className={styles.head}>
        {head.mode === "summary" ? (
          <>
            <b>{head.hubs}</b>개 영역 · <b>{head.edges}</b>개 연결
          </>
        ) : (
          <>
            <b>{head.nodes}</b>개 기록 · <b>{head.edges}</b>개 연결선
          </>
        )}{" "}
        · 중심 <b>{head.name}</b>
      </span>
      <div>
        <div className={styles.seg} role="group" aria-label="그래프 버전 전환">
          <button type="button" aria-pressed={view === "records"} title="흰 배경에 개별 기록을 모두 표시" onClick={() => onView("records")}>
            개별 기록
          </button>
          <button type="button" aria-pressed={view === "summary"} title="어두운 배경에 주체별 관계를 요약" onClick={() => onView("summary")}>
            주체별 요약
          </button>
        </div>
        <div className={`${styles.seg} ${styles.zoom}`} role="group" aria-label="확대">
          <button type="button" title="축소" onClick={() => onZoom(0.8)}>
            −
          </button>
          <output ref={zoomRef} title="확대 비율" />
          <button type="button" title="확대" onClick={() => onZoom(1.25)}>
            ＋
          </button>
        </div>
        <button type="button" className={styles.btn} onClick={onFit}>
          전체 맞춤
        </button>
        <button type="button" className={styles.btn} onClick={onCenter}>
          선택 중심
        </button>
        <button type="button" className={styles.btn} onClick={onWide}>
          {wide ? "원래대로" : "넓게 보기"}
        </button>
      </div>
    </div>
  );
}

export function NetLegend(p: { mode: NetViewMode; summary: boolean; colored: boolean; labels: boolean; hasFacts: boolean; onColored: (b: boolean) => void; onLabels: (b: boolean) => void }) {
  return (
    <div className={styles.legend} data-net-chrome="">
      <div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={p.colored} disabled={p.summary} onChange={(e) => p.onColored(e.target.checked)} /> 영역별 색상
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={p.labels} onChange={(e) => p.onLabels(e.target.checked)} /> 이름 표시
        </label>
      </div>
      <span>
        {p.mode === "summary" ? (
          "● 영역 = 기록 수만큼 큰 점 · 선 = 영역 사이 교차 연결(굵을수록 많음) · ◆ 분석 · 가운데 = 중심"
        ) : (
          <>
            ● 기록 · 큰 점 = 영역 · ◆ 분석 ·{" "}
            {p.hasFacts ? (
              <>
                <b className={styles.gold}>●</b> 온톨로지 사실 ·{" "}
              </>
            ) : null}
            가운데 = 중심
          </>
        )}
      </span>
      <small>휠 확대 · 끌어 이동 · 더블클릭 = 중심으로 · 우클릭 = 되돌아가기</small>
    </div>
  );
}
