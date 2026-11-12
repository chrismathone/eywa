"use client";

import { useWork } from "@/app/(shell)/dashboard/_instruments/work/work-context";
import { leftOf, type LateItem } from "../../view-admin";
import type { TreeSubject } from "../../view-admin-levels";
import { ownerRows } from "../../view-owner";
import { CountBox } from "./admin-matrix";
import { VerdictBadge } from "./admin-verdict";

// 열 머리 · 칸은 좁아지면 낱말 · 구절 사이에서 접힌다(표가 옆으로 밀리지 않게 — 원장 2026-11-11 *"가로스크롤은 왠만하면 생기지 않게"*). 구절 하나는 쪼개지 않는다(`NW`).
const TH = "text-text-dim px-1 py-1.5 align-bottom text-xs leading-tight font-semibold break-keep";
const NW = "whitespace-nowrap";
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
    {/* 이 상자의 폭을 보고 막대 칸의 폭을 정한다(`@container` — 좁으면 64px · 넓으면 96px). */}
    <div className="@container overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-center text-sm [&_th:first-child]:text-left">
        <thead><tr>
          {/* 제목을 열 머리 줄의 첫 칸에 둔다(원장 2026-11-11 *"행 묶어서 행 절약"*) — 제목 줄과 머리 줄이 따로 서지 않는다. */}
          <th className="px-2 py-1.5 text-left align-bottom text-sm leading-tight font-bold break-keep" scope="col">과목 관리자별 현황</th><th className={TH}>등급</th><th className={TH}>기한 내 완료율</th><th className={TH}>기한 후 완료</th><th className={TH}>현재 미처리</th><th className={TH}>남음</th>
          {tracked ? <th className={TH}>처리 요청</th> : null}<th className={TH}>선생님 등급</th>
        </tr></thead>
        <tbody>{rows.map((r) => <tr key={r.subject ?? ""}>
          <td className="px-2 py-1 text-left">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {r.inTree ? <button type="button" onClick={() => onSubject(r.subject)} className={`hover:text-primary text-sm font-bold ${NW}`}>{r.label}</button> : <span className={`text-sm font-bold ${NW}`} title="해당 기간 업무 없음">{r.label}</span>}
              <span className="text-text-dim text-xs font-medium">{r.managers.length ? r.managers.join(" · ") : "과목 관리자 없음"}</span>
            </span>
          </td>
          <td className="px-1"><VerdictBadge v={r.verdict} /></td>
          {/* 표의 칸과 같은 부품 — 숫자(기한 내 완료율)와 가는 막대(기한 내 몫). 분수(269/966)를 그대로 적으면 '그만큼 어겼다'로 읽혀(원장 2026-11-11) 분자/분모는 마우스를 올렸을 때만.
              칸 상자는 제 폭을 스스로 정하지 못해(`@container`) 자리의 폭을 여기서 준다. */}
          <td className="p-0"><div className="mx-auto w-16 @min-[720px]:w-24">{r.cell.pct === null ? <span className="text-text-dim text-sm">—</span> : <CountBox cell={r.cell} mode="ontime" onClick={r.inTree ? () => onSubject(r.subject) : undefined} />}</div></td>
          <td className={`px-1 text-sm tabular-nums ${NW}`}>{r.cell.lateDone ? `${n(r.cell.lateDone)}건` : <span className="text-text-dim">없음</span>}</td>
          <td className="px-1 text-sm tabular-nums">
            {r.late ? <span className="flex flex-wrap items-baseline justify-center gap-x-1.5"><span className={`text-danger font-bold ${NW}`}>{n(r.late)}건</span>
              {r.late3 ? <span className={`text-text-dim text-xs font-medium ${NW}`}>3일 이상 {n(r.late3)}</span> : null}
              {r.late7 ? <span className={`text-danger text-xs font-bold ${NW}`}>7일 이상 {n(r.late7)}</span> : null}</span> : <span className="text-text-dim">없음</span>}
          </td>
          <td className={`text-text-dim px-1 text-sm tabular-nums ${NW}`}>{leftOf(r.cell) ? `${n(leftOf(r.cell))}건` : "없음"}</td>
          {tracked ? <td className="px-1 text-sm tabular-nums">
            {r.lateTeachers ? <span className={`inline-flex flex-wrap justify-center gap-x-1 ${r.requested < r.lateTeachers ? "font-bold" : "text-text-dim font-semibold"}`}><span className={NW}>대상 선생님 {n(r.lateTeachers)}명,</span><span className={NW}>요청 {n(r.requested)}명</span></span> : <span className="text-text-dim">—</span>}
            {r.requestsLate ? <span className={`text-danger text-xs font-bold ${NW}`}>, 요청 기한 초과 {n(r.requestsLate)}건</span> : null}
          </td> : null}
          <td className="px-1 text-sm tabular-nums">
            <span className="inline-flex flex-wrap justify-center gap-x-1">
              {r.bad ? <span className={`text-danger font-bold ${NW}`}>5등급 이하 {n(r.bad)}명{r.warn ? <span className="text-text-dim font-normal">,</span> : null}</span> : null}
              {r.warn ? <span className={`text-amber font-bold ${NW}`}>3~4등급 {n(r.warn)}명</span> : null}
              {!r.bad && !r.warn ? <span className={`text-text-dim ${NW}`}>{r.good ? `2등급 이상 ${n(r.good)}명` : "—"}</span> : null}
            </span>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
