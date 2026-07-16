"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { displayLessons } from "../curriculum";
import type { Subject } from "../types";

const PREV_TD = "border-line/60 px-2 py-1 align-top text-[11px] text-text-faint";

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
}: {
  subject: Subject;
  dailyEnabled: boolean;
  checkEnabled: boolean;
  onImport?: () => void; // 이전 회차 값 → 오늘 행 빈 칸 채움(1-3). 특이사항은 제외(발송 본문 오염 방지).
}) {
  const p = subject.prevReport;
  if (!p) return null;
  const prog = displayLessons(p.progress) || p.progress || "—";
  const testCols = (dailyEnabled ? 1 : 0) + (checkEnabled ? 1 : 0);
  return (
    <tr className="bg-bg-soft/40">
      <td className={`${PREV_TD} text-center`} aria-hidden>
        <EyIcon name="chevronUp" size={13} className="text-text-faint/70" />
      </td>
      <td className={PREV_TD}>
        <span className="whitespace-nowrap">이전 {shortDate(p.date)}</span>
      </td>
      <td className={PREV_TD}>
        <span className="line-clamp-3 whitespace-pre-line">{prog}</span>
      </td>
      {testCols > 0 ? (
        <td className={`${PREV_TD} text-center`} colSpan={testCols}>
          {p.examInfo || "—"}
        </td>
      ) : null}
      <td className={PREV_TD}>{p.attitude || "—"}</td>
      <td className={PREV_TD}>{p.homeworkScore || "—"}</td>
      <td className={PREV_TD}>
        <span className="line-clamp-2">{p.textbook || "—"}</span>
        {p.homeworkToday ? (
          <span className="text-text-faint/80 mt-0.5 block line-clamp-2">과제 {p.homeworkToday}</span>
        ) : null}
      </td>
      <td className={PREV_TD}>
        <span className="line-clamp-2">{p.note || "—"}</span>
      </td>
      <td className={PREV_TD}>
        {onImport ? (
          <button
            type="button"
            onClick={onImport}
            title="이전 회차 값을 이 행의 빈 칸에 채움 — 진도·태도·과제·오늘 과제 (특이사항 제외)"
            className="border-line text-text-dim hover:bg-bg-soft hover:text-foreground w-full rounded-sm border px-1 py-0.5 text-[10px] font-semibold"
          >
            가져오기
          </button>
        ) : null}
      </td>
    </tr>
  );
}
