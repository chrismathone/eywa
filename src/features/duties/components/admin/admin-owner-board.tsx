"use client";

import { useWork } from "@/app/(shell)/dashboard/_instruments/work/work-context";
import { upcomingOf, type LateItem } from "../../view-admin";
import type { TreeSubject } from "../../view-admin-levels";
import { ownerRows } from "../../view-owner";
import { bandStyle } from "./admin-matrix";
import { VerdictBadge } from "./admin-verdict";

const TH = "text-text-dim px-2 py-1.5 text-xs font-semibold";
const n = (v: number) => v.toLocaleString("ko-KR");

/**
 * 과목 관리자별 현황(원장 첫 화면) — 과목마다 한 줄: 과목 관리자 · 판정 · 기한 준수 · 지금 열린 지연(3일·7일 이상) · 지연이 있는 선생님 가운데 처리 요청이 나간 수 · 선생님 판정.
 * 줄을 누르면 그 과목으로 내려간다(이 기간에 의무가 없고 지연만 남은 과목은 누르지 않는다). '처리 요청' 칸은 업무 요청 기록으로만 센다(말로 한 재촉은 알 수 없다).
 */
export function AdminOwnerBoard({ tree, late, managers, labels, nowMs, onSubject }: { tree: readonly TreeSubject[]; late: readonly LateItem[]; managers: Record<string, string[]>; labels: Record<string, string>; nowMs: number; onSubject: (subject: string | null) => void }) {
  const work = useWork();
  const rows = ownerRows(tree, late, work.board.items, managers, labels, nowMs, work.today);
  // 처리 요청 칸은 모든 요청을 볼 수 있는 사람에게만 — 자기 요청만 보이는 계정에게 "0명"이라고 적으면 거짓이다.
  const tracked = work.board.enabled && work.board.canMonitor;
  return <section className="border-line bg-card rounded-xl border p-2">
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-center text-sm whitespace-nowrap [&_th:first-child]:text-left">
        <thead><tr>
          {/* 제목을 열 머리 줄의 첫 칸에 둔다(원장 2026-11-11 *"행 묶어서 행 절약"*) — 제목 줄과 머리 줄이 따로 서지 않는다. */}
          <th className="px-2 py-1.5 text-left text-sm font-bold" scope="col">과목 관리자별 현황</th><th className={TH}>등급</th><th className={TH}>기한 준수율</th><th className={TH}>기한 후 완료</th><th className={TH}>현재 기한 초과</th><th className={TH}>남음</th>
          {tracked ? <th className={TH}>처리 요청</th> : null}<th className={TH}>선생님 등급</th>
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.subject ?? ""}>
          <td className="px-2 py-1 text-left">
            {r.inTree ? <button type="button" onClick={() => onSubject(r.subject)} className="hover:text-primary text-sm font-bold">{r.label}</button> : <span className="text-sm font-bold" title="해당 기간 업무 없음">{r.label}</span>}
            <span className="text-text-dim ml-2 text-xs font-medium">{r.managers.length ? r.managers.join(" · ") : "과목 관리자 없음"}</span>
          </td>
          <td className="px-1"><VerdictBadge v={r.verdict} /></td>
          {/* 건수 분수(269/966)는 남은 업무까지 분모라 '기한을 그만큼 어겼다'로 읽힌다(원장 2026-11-11) — 비율은 기한이 온 것만으로, 나머지는 칸을 나눠 건수로. */}
          <td className="p-0">{r.cell.pct === null ? <span className="text-text-dim text-sm">—</span>
            : <button type="button" disabled={!r.inTree} onClick={() => onSubject(r.subject)} style={bandStyle(r.cell.pct)} className="block w-full rounded-lg px-1 py-1.5 text-sm font-semibold tabular-nums enabled:hover:brightness-95">{r.cell.pct}<span className="text-xs font-medium">%</span></button>}</td>
          <td className="px-2 text-sm tabular-nums">{r.cell.lateDone ? `${n(r.cell.lateDone)}건` : <span className="text-text-dim">없음</span>}</td>
          <td className="px-2 text-sm tabular-nums">
            {r.late ? <><span className="text-danger font-bold">{n(r.late)}건</span>
              {r.late3 ? <span className="text-text-dim ml-1.5 text-xs font-medium">3일 이상 {n(r.late3)}</span> : null}
              {r.late7 ? <span className="text-danger ml-1.5 text-xs font-bold">7일 이상 {n(r.late7)}</span> : null}</> : <span className="text-text-dim">없음</span>}
          </td>
          <td className="text-text-dim px-2 text-sm tabular-nums">{upcomingOf(r.cell) ? `${n(upcomingOf(r.cell))}건` : "없음"}</td>
          {tracked ? <td className="px-2 text-sm tabular-nums">
            {r.lateTeachers ? <span className={r.requested < r.lateTeachers ? "font-bold" : "text-text-dim font-semibold"}>대상 선생님 {n(r.lateTeachers)}명, 요청 {n(r.requested)}명</span> : <span className="text-text-dim">—</span>}
            {r.requestsLate ? <span className="text-danger text-xs font-bold">, 요청 기한 지남 {n(r.requestsLate)}건</span> : null}
          </td> : null}
          <td className="px-2 text-sm tabular-nums">
            {r.bad ? <span className="text-danger font-bold">5등급 이하 {n(r.bad)}명</span> : null}
            {r.bad && r.warn ? <span className="text-text-dim">, </span> : null}
            {r.warn ? <span className="text-amber font-bold">3~4등급 {n(r.warn)}명</span> : null}
            {!r.bad && !r.warn ? <span className="text-text-dim">{r.good ? `2등급 이상 ${n(r.good)}명` : "—"}</span> : null}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
