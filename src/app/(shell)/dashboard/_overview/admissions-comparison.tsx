"use client";

import type { EnrollmentStats } from "@/features/enrollment/server/stats-queries";
import { monthKeys } from "@/features/dashboard/overview/model";
import { WindowLink } from "@/components/workspace/window-link";
import { COLORS, Stack, number } from "./charts";
import s from "./overview.module.css";

const categories = [
  { key: "enrolled", label: "등록", color: COLORS[2] },
  { key: "open", label: "진행", color: COLORS[0] },
  { key: "declined", label: "미등록", color: COLORS[3] },
  { key: "noShow", label: "미방문", color: COLORS[5] },
] as const;

export function AdmissionsComparison({ stats, today }: { stats: EnrollmentStats; today: string }) {
  // A retained snapshot may still contain a full year. Select by calendar key, never array tail.
  const months = monthKeys(today, 2).map((key) => ({
    key, data: [...stats.months, ...stats.prevYearMonths].find((row) => row.month === key),
  }));
  return <>
    <div className={s.admissionMonths}>
      {months.map(({ key, data }, i) => <section key={key} aria-label={`${key} 신규 콜&상담 전환`}>
        <header><b>{Number(key.slice(5))}월</b><span>{i === 0 ? "지난달" : "이번 달"}</span></header>
        <strong className={s.admissionRate}>{data && data.total > 0 ? `${(data.enrolled / data.total * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "—"}</strong>
        <p>등록 전환율</p>
        {data ? <Stack label={`${Number(key.slice(5))}월 상담 결과`} data={categories.map((category) => ({ label: category.label, value: data[category.key], color: category.color }))} /> : <p className={s.errorNote}>조회 확인 필요</p>}
      </section>)}
    </div>
    <table className={s.admissionTable} aria-label="지난달과 이번 달 상담 전환 비교">
      <thead><tr><th scope="col">접수 기준</th>{months.map(({ key }) => <th scope="col" key={key}>{Number(key.slice(5))}월</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">전체 접수</th>{months.map(({ key, data }) => <td key={key}>{data ? <b>{number(data.total)}건</b> : "—"}</td>)}</tr>
        {categories.map((category) => <tr key={category.key}><th scope="row"><i style={{ background: category.color }} />{category.label}</th>{months.map(({ key, data }) => <td key={key}>{data ? `${number(data[category.key])}건` : "—"}</td>)}</tr>)}
      </tbody>
    </table>
    <div className={s.admissionLinks}>{months.map(({ key }) => <WindowLink key={key} href={`/enrollment?view=table&month=${key}`}>{Number(key.slice(5))}월 접수 보기</WindowLink>)}</div>
  </>;
}
