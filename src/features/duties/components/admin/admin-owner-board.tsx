"use client";

import { useWork } from "@/app/(shell)/dashboard/_instruments/work/work-context";
import type { LateItem } from "../../view-admin";
import type { TreeSubject } from "../../view-admin-levels";
import { ownerRows } from "../../view-owner";
import { CountBox } from "./admin-matrix";
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
    <h4 className="px-2 py-1 text-sm font-bold">과목 관리자별 현황</h4>
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left">
        <thead><tr>
          <th className={TH}>과목 · 과목 관리자</th><th className={TH}>등급</th><th className={TH}>기한 준수</th><th className={TH}>현재 지연</th>
          {tracked ? <th className={TH}>처리 요청</th> : null}<th className={TH}>선생님 등급</th>
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.subject ?? ""}>
          <td className="px-2 py-1 text-left">
            {r.inTree ? <button type="button" onClick={() => onSubject(r.subject)} className="hover:text-primary text-sm font-bold">{r.label}</button> : <span className="text-sm font-bold" title="해당 기간 업무 없음">{r.label}</span>}
            <span className="text-text-dim ml-2 text-xs font-medium">{r.managers.length ? r.managers.join(" · ") : "과목 관리자 없음"}</span>
          </td>
          <td className="px-1"><VerdictBadge v={r.verdict} /></td>
          <td className="p-0"><CountBox cell={r.cell} onClick={r.inTree ? () => onSubject(r.subject) : undefined} /></td>
          <td className="px-2 text-sm tabular-nums">
            {r.late ? <><span className="text-danger font-bold">{n(r.late)}건</span>
              {r.late3 ? <span className="text-text-dim ml-1.5 text-xs font-medium">3일 이상 {n(r.late3)}</span> : null}
              {r.late7 ? <span className="text-danger ml-1.5 text-xs font-bold">7일 이상 {n(r.late7)}</span> : null}</> : <span className="text-text-dim">없음</span>}
          </td>
          {tracked ? <td className="px-2 text-sm tabular-nums">
            {r.lateTeachers ? <span className={r.requested < r.lateTeachers ? "font-bold" : "text-text-dim font-semibold"}>지연 {n(r.lateTeachers)}명 중 요청 {n(r.requested)}명</span> : <span className="text-text-dim">—</span>}
            {r.requestsLate ? <span className="text-danger ml-1.5 text-xs font-bold">요청 기한 지남 {n(r.requestsLate)}</span> : null}
          </td> : null}
          <td className="px-2 text-sm tabular-nums">
            {r.bad ? <span className="text-danger font-bold">5등급 이하 {n(r.bad)}</span> : null}
            {r.warn ? <span className="text-amber ml-1.5 font-bold">3~4등급 {n(r.warn)}</span> : null}
            {!r.bad && !r.warn ? <span className="text-text-dim">{r.good ? `2등급 이상 ${n(r.good)}명` : "—"}</span> : null}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="text-text-dim px-2 pt-1 text-xs font-medium">{tracked ? "처리 요청 = 지연 담당자 중 요청 진행 인원 · " : ""}현재 지연은 기간 무관</p>
  </section>;
}
