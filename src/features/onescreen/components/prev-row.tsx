"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { displayLessons } from "../curriculum";
import type { Subject } from "../types";

const PREV_TD_BASE = "px-2 py-1 align-top text-xs text-text-faint";
const PREV_TD = `border-line/60 ${PREV_TD_BASE}`;
// 학생 묶음 구분선 — 참고행이 묶음의 첫 행이라 여기 위쪽에 굵고 진한 회색 선을 둔다(grid-row TD_GROUP과 동일 톤).
// ⚠️ 폭 유틸(border-t / border-t-2)을 한 className에 섞지 말 것 — 어느 쪽이 이길지 CSS 순서에 달린다.
const PREV_TD_GROUP = `border-t-2 border-t-text-faint/50 ${PREV_TD_BASE}`;

/** "2026-07-10" → "07/10". 이전 회차 참고행 날짜. */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return m && d ? `${m}/${d}` : ymd;
}

/** 이전 회차 참고행(edutrix식) — 편집행 위, 같은 열에 지난 보고서를 읽기전용으로 정렬. 테스트 열은 표시설정에 맞춰 정렬. (그리드 분해 0단계 이동) */
export function PrevRow({
  subject,
  dailyEnabled,
  checkEnabled,
  onImport,
  groupStart = false,
}: {
  subject: Subject;
  dailyEnabled: boolean;
  checkEnabled: boolean;
  onImport?: () => void; // 이전 회차 값 → 오늘 행 빈 칸 채움(1-3). 특이사항은 제외(발송 본문 오염 방지).
  groupStart?: boolean; // 학생 묶음의 첫 렌더 행 — 위쪽에 굵은 구분선
}) {
  const p = subject.prevReport;
  if (!p) return null;
  const prog = displayLessons(p.progress) || p.progress || "—";
  const testCols = (dailyEnabled ? 1 : 0) + (checkEnabled ? 1 : 0);
  const td = groupStart ? PREV_TD_GROUP : PREV_TD; // 학생 구분선(묶음 첫 행만 굵게)
  return (
    <tr className="bg-bg-soft/40">
      {/* ⚠️ 화살표는 **아래**를 가리킨다 — 이 참고행은 바로 **아래** 학생의 지난 회차다. 위를 가리키면
          윗 학생에 딸린 줄로 읽혀 아주 헷갈린다(원장 지적 07-21). */}
      <td className={`${td} text-center`} aria-hidden>
        <EyIcon name="chevronDown" size={13} className="text-text-faint/70" />
      </td>
      <td className={td}>
        <span className="whitespace-nowrap">이전 {shortDate(p.date)}</span>
      </td>
      {/* 수업타임 열(2026-08-05 신설) — 지난 회차엔 보여줄 값이 없지만 **칸은 반드시 차지해야 한다**.
          이 행은 위치로만 열을 맞추는 구조라, 빠뜨리면 아래 모든 칸이 한 칸씩 왼쪽으로 밀린다(조용한 오정렬). */}
      <td className={`${td} text-center`} aria-hidden>
        <span className="text-text-faint/70">·</span>
      </td>
      <td className={td}>
        <span className="line-clamp-3 whitespace-pre-line">{prog}</span>
      </td>
      {testCols > 0 ? (
        <td className={`${td} text-center`} colSpan={testCols}>
          {p.examInfo || "—"}
        </td>
      ) : null}
      <td className={td}>{p.attitude || "—"}</td>
      <td className={td}>{p.homeworkScore || "—"}</td>
      <td className={td}>
        <span className="line-clamp-2">{p.textbook || "—"}</span>
        {p.homeworkToday ? (
          <span className="text-text-faint/80 mt-0.5 block line-clamp-2">과제 {p.homeworkToday}</span>
        ) : null}
      </td>
      <td className={td}>
        <span className="line-clamp-2">{p.note || "—"}</span>
      </td>
      <td className={td}>
        {onImport ? (
          <button
            type="button"
            onClick={onImport}
            title="이전 회차 값을 이 행의 빈 칸에 채움 — 진도·태도·과제·오늘 과제 (특이사항 제외)"
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground w-full rounded-sm border px-1 py-0.5 text-xs font-bold"
          >
            가져오기
          </button>
        ) : null}
      </td>
    </tr>
  );
}
