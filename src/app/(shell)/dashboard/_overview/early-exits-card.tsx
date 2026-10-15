"use client";

import { WindowLink } from "@/components/workspace/window-link";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { EARLY_MAX_DAYS, EARLY_SPANS, earlyCounts, unjudgedText, type EarlyKey } from "@/features/withdrawals/early-exit";
import { DetailPopup } from "./detail-popup";
import s from "./overview.module.css";
import e from "./early-exits-card.module.css";

/** 퇴원관리에서 같은 수가 나오는 주소 — 퇴원만 · 이 달 · 그 기간. */
export const earlyExitsHref = (month: string, key: EarlyKey = "3m") =>
  `/withdrawals?type=withdrawn&range=month&month=${month}&early=${key}`;

type Row = OverviewData["earlyExits"]["rows"][number];

function Names({ rows }: { rows: readonly Row[] }) {
  return (
    <div className={s.riskNames}>
      {rows.map((row) => (
        <WindowLink
          key={row.id}
          href={`/withdrawals/${row.id}`}
          title={`${row.name} 퇴원`}
          ariaLabel={`${row.name} 퇴원 상세 · 등록 ${row.days}일 만`}
        >
          <span>
            {row.name}
            {row.schoolGrade ? ` ${row.schoolGrade}` : ""}
          </span>
          <b>
            {row.days}
            <small>일 만</small>
          </b>
        </WindowLink>
      ))}
    </div>
  );
}

/**
 * 운영실 '등록 후 3개월 내 퇴원' 본문(원장 2026-10-15) — 이번 달 퇴원 중 등록일부터 30·60·90일 안에 그만둔 학생.
 * 세 칸은 누적(`early-exit.ts`)이고 누르면 퇴원관리의 같은 필터가 열린다. 명단은 빨리 그만둔 순.
 * 🔴 과목 관리자 화면(`scope` = 담당 과목 이름)은 수가 담당 과목으로 좁혀져 있고 퇴원관리 목록은 학원 전체다 — 같은 수라고
 *    약속하지 않고 그 차이를 적는다(KPI '퇴원&수업종료' ↗와 같은 결 · 과목 키로 거르는 퇴원관리와 과목 묶음으로 좁히는 운영실은
 *    기준이 달라 `subject=`를 실어도 수가 갈린다).
 */
export function EarlyExitsBody({ data, scope = null }: { data: OverviewData["earlyExits"]; scope?: string | null }) {
  const counts = earlyCounts(data.rows);
  const early = data.rows
    .filter((r) => r.days !== null && r.days <= EARLY_MAX_DAYS)
    .sort((a, b) => a.days! - b.days! || a.name.localeCompare(b.name, "ko"));
  const unknown = data.rows.filter((r) => r.days === null).length;
  // 달마다 3개월 이내 퇴원 수 — 인원은 달로 끊는다(이번 달 칸 = 위 '3개월 이내'와 같은 수).
  const monthly = data.months.map((month) => ({
    month,
    count: earlyCounts(month === data.month ? data.rows : data.history.filter((h) => h.month === month))["3m"],
  }));
  return (
    <>
      <div className={e.spans}>
        {EARLY_SPANS.map((span) => (
          <WindowLink
            key={span.key}
            href={earlyExitsHref(data.month, span.key)}
            title="퇴원관리"
            ariaLabel={`등록 후 ${span.label} 퇴원 ${counts[span.key]}명 — 퇴원관리에서 이 기간 보기`}
          >
            <span>{span.label}</span>
            <b>
              {counts[span.key]}
              <small>명</small>
            </b>
          </WindowLink>
        ))}
      </div>
      <p className={e.note}>
        이번 달 퇴원 {data.rows.length}명 중{unknown ? ` · ${unjudgedText(unknown)}` : ""}
        {scope ? ` · ${scope} 과목만 (퇴원관리 목록은 학원 전체)` : ""}
      </p>
      {early.length ? (
        <>
          <Names rows={early.slice(0, 6)} />
          {early.length > 6 && (
            <DetailPopup title="등록 후 3개월 내 퇴원" label={`전체 ${early.length}명 보기`}>
              <Names rows={early} />
            </DetailPopup>
          )}
        </>
      ) : (
        <p className={e.note}>이번 달에는 등록 후 3개월 안에 퇴원한 학생이 없습니다.</p>
      )}
      <div className={e.months} aria-label="달마다 등록 후 3개월 이내 퇴원">
        <p className={e.note}>달마다 · 3개월 이내</p>
        <ol>
          {monthly.map((m) => (
            <li key={m.month} aria-current={m.month === data.month ? "true" : undefined}>
              <span>{Number(m.month.slice(5))}월</span>
              <b>{m.count}</b>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
