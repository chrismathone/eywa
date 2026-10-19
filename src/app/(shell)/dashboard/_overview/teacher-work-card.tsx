"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { TeacherWork, TeacherWorkRow } from "@/features/dashboard/overview/teacher-work";
import { counselPeriodLabel } from "@/features/dashboard/overview/counsel-period";
import { WindowLink } from "@/components/workspace/window-link";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { kstTimeOf } from "@/lib/date-kst";
import { tipProps } from "@/components/hover-tip/tip";
import s from "./teacher-work-card.module.css";

export function workRatio(value: number, total: number) {
  return `${value.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")} (${total ? `${Math.round(value / total * 100)}%` : "—"})`;
}

type Cell = { text: string; tone?: "good" | "alert"; sub?: string; subTone?: "alert"; href?: string };
const NONE: Cell = { text: "—" };

/**
 * 행 = 업무 하나(원장 2026-10-15 *"보고서 작성/발송, 보고서 미발송/미작성은 사실상 하나만 있어도 되지 않나? … 다른 데이터를 표시"*).
 * 옛 보고서 네 줄(작성·발송·미발송·미작성)은 독립 숫자가 둘뿐이라(미작성 = 대상 − 작성, 미발송 = 대상 − 발송) '작성'·'발송 확인' 두 줄로 접고,
 * 빈 자리에 학부모 미확인·출결 미입력·원생상담을 세웠다. 판정은 전부 다른 화면이 쓰는 함수 그대로(teacher-work-server.ts 주석).
 */
// `shown` = 기능이 꺼진 지점엔 줄째 뺀다(ClassNote 꺼짐 → 발송 확인·학부모 미확인 · 직원 평가 꺼짐·실험실 밖 → 원생상담). 서버가 켜짐을 실어야만 선다.
const metrics: { key: string; label: string; video?: boolean; shown?: (d: TeacherWork) => boolean; cell: (r: TeacherWorkRow, d: TeacherWork) => Cell }[] = [
  { key: "written", label: "보고서 작성", cell: (r) => ({
    text: workRatio(r.reports, r.reportTarget), tone: r.reports ? "good" : undefined,
    sub: r.todayUnwritten ? `오늘 미작성 ${r.todayUnwritten.toLocaleString("ko-KR")}` : undefined,
  }) },
  // 반 알림장(영어)은 올린 것이 곧 발송이고, 작성 면제 열은 보낼 것이 없다 — 숫자 대신 '—'. 회수한 보고서는 일부러 거둔 것이라 뺀다.
  { key: "delivery", label: "발송 확인", shown: (d) => d.deliveryShown === true, cell: (r) => {
    if (r.reportSource !== "lesson") return NONE;
    const stuck = Math.max(0, r.reports - r.sent - r.recalled);
    return { text: workRatio(stuck, r.reports), tone: stuck ? "alert" : undefined,
      sub: r.failed ? `오류 ${r.failed.toLocaleString("ko-KR")}` : undefined, subTone: r.failed ? "alert" : undefined };
  } },
  // 읽음 기록은 aywa가 보낸 보고서에만 있다 — 반 알림장·작성 면제 열은 '—'.
  { key: "unread", label: "학부모 미확인", shown: (d) => d.deliveryShown === true, cell: (r) => r.reportSource !== "lesson" ? NONE
    : { text: workRatio(r.unread, r.unreadJudged), tone: r.unread ? "alert" : undefined } },
  { key: "attendance", label: "출결 미입력", cell: (r) => ({ text: workRatio(r.attendanceUnrecorded, r.attendanceDays), tone: r.attendanceUnrecorded ? "alert" : undefined }) },
  { key: "counsel", label: "원생상담", shown: (d) => d.counselShown === true, cell: (r) => r.counselRate == null ? NONE : { text: `${r.counselRate.toLocaleString("ko-KR")}%` } },
  { key: "submitted", label: "영상 제출", video: true, cell: (r, d) => videoCell(r, d, "submitted", r.videoSubmitted, "good") },
  // 영상 숙제 출제율(원장 2026-10-19 *"영상 미제출"을 바꿈) — 쓴 보고서 중 영상 과제가 나간 비율. 반 알림장·작성 면제 열은 보고서가 없어 '—'.
  { key: "issued", label: "영상 숙제 출제율", video: true, cell: (r) => r.reportSource !== "lesson" ? NONE
    : { text: workRatio(r.videoIssuedReports, r.reportsWritten) } },
];

/** 업무 이름에 마우스를 올리면 그 줄이 무엇을 세는지(원장 2026-10-19 *"어떤 걸 표시중인지 마우스오버시 설명"*) — 아래 안내 줄과 같은 말. */
function metricTip(key: string, d: TeacherWork, span: (from?: string, to?: string) => string | null): string {
  switch (key) {
    case "written": return `보고서 작성 — ${span(d.reportFrom, d.to) ?? "최근 7일"} 작성할 보고서 중 쓴 것(결석·휴원·테스트반 제외). 아래 작은 글자 = 오늘 아직 안 쓴 것`;
    case "delivery": return "발송 확인 — 작성했는데 아직 학부모에게 안 나간 것(오류 포함 · 회수 제외)";
    case "unread": return `학부모 미확인 — ${span(d.unreadFrom, d.to) ?? "최근 30일"} 보낸 보고서 중 48시간이 지나도 안 읽은 것`;
    case "attendance": return `출결 미입력 — ${span(d.attendanceFrom, d.attendanceTo) ?? "어제까지 7일"} 수업한 반×날 중 출결을 다 못 찍은 횟수(보고서를 안 쓰는 반 포함)`;
    case "counsel": return `원생상담 — ${counselPeriodLabel(d.counselMonth, d.to)} 상담 의무 학생 중 1회 이상 상담한 비율. 한 학생이 같은 과목을 여러 선생님에게 들으면 요일을 가장 많이 맡은 선생님만 의무(같으면 모두)`;
    case "submitted": return `영상 제출 — ${span(d.videoFrom, d.to) ?? "기간"} 낸 영상 숙제 중 학생이 실제로 올린 것. 누르면 영상 제출 현황`;
    case "issued": return `영상 숙제 출제율 — ${span(d.reportFrom, d.to) ?? "최근 7일"} 쓴 보고서 중 영상 과제가 나간 비율`;
    default: return "";
  }
}

function videoCell(r: TeacherWorkRow, d: TeacherWork, status: string, value: number, tone: "good" | "alert"): Cell {
  const text = workRatio(value, r.videoAssigned);
  if (!r.videoAssigned) return { text };
  const href = `/lesson-reports/video-homework?${new URLSearchParams({ from: d.videoFrom, to: d.to, class: r.classIds.join(","), status })}`;
  return { text, tone: value ? tone : undefined, href };
}

function CellBody({ cell }: { cell: Cell }): ReactNode {
  return <>
    {cell.href ? <WindowLink href={cell.href}>{cell.text}</WindowLink> : cell.text}
    {cell.sub ? <small data-tone={cell.subTone}>{cell.sub}</small> : null}
  </>;
}

/**
 * 강사 열 너비 = 카드 폭에 **8명**이 딱 들어가는 고정 폭(원장 2026-10-19 *"열너비는 지금 8명 고정 너비로 하고 더 늘어나면 스크롤"*).
 * 9명부터는 옆으로 넘긴다 — 스크롤바는 감추고 가장자리 페이드로 "더 있음"을 알린다(잡고 끌기 · 휠 · 트랙패드). 업무 이름 칸은 왼쪽에 붙어 있다.
 * (종전: 폭이 모자라면 강사 묶음을 아래로 이어 붙였다.)
 */
const VISIBLE_TEACHERS = 8;
const METRIC_COLUMN = 126;
export function TeacherWorkCard({ data, subjects }: { data: TeacherWork; subjects: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(110);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setColumnWidth(Math.max(72, ((entry?.contentRect.width ?? 1000) - METRIC_COLUMN) / VISIBLE_TEACHERS)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const groups = data.rows.length ? [data.rows] : [];
  const shownMetrics = metrics.filter((m) => !m.shown || m.shown(data));
  const span = (from?: string, to?: string) => (from && to ? `${from.slice(5).replace("-", "/")}~${to.slice(5).replace("-", "/")}` : null);
  return <div ref={ref} className={s.root} data-auto-height data-teacher-work>
    {groups.length ? <DragScrollArea hideBar fadeTone="surface">{groups.map((rows, i) => <table key={i} className={s.table}
      style={{ width: METRIC_COLUMN + columnWidth * Math.max(rows.length, VISIBLE_TEACHERS) }}>
      <caption className="sr-only">강사별 업무 현황 {i + 1}</caption>
      <colgroup><col style={{ width: METRIC_COLUMN }} />{rows.map((r) => <col key={`${r.teacherId}:${r.subject}`} style={{ width: columnWidth }} />)}</colgroup>
      <thead><tr><th scope="col">업무</th>{rows.map((r) => <th key={`${r.teacherId}:${r.subject}`} scope="col">
        <b>{r.teacherName}</b><small>{subjects[r.subject] ?? r.subject} · {r.classIds.length}반</small>
        {r.reportSource === "classnote" ? <small>반 알림장 기준</small> : null}
      </th>)}</tr></thead>
      <tbody>{shownMetrics.map((metric) => <tr key={metric.key} data-video={metric.key === "submitted" || undefined}>
        <th scope="row"><span {...tipProps(metricTip(metric.key, data, span))}>{metric.label}</span></th>{rows.map((r) => {
          const cell = metric.cell(r, data);
          return <td key={`${r.teacherId}:${r.subject}`} data-tone={cell.tone}><CellBody cell={cell} /></td>;
        })}
      </tr>)}</tbody>
    </table>)}</DragScrollArea> : null}
    {!data.rows.length ? <p className={s.empty}>집계할 담당 반이 없습니다.</p> : null}
    <p className={s.note}>보고서({span(data.reportFrom, data.to) ?? "최근 7일"}): 작성할 전체 건수 기준 · 결석·휴원·테스트반 제외{data.deliveryShown === true ? " · 발송 확인 = 작성했는데 아직 학부모에게 안 나간 것(오류 포함 · 회수 제외)" : ""}.</p>
    <p className={s.note}>{data.deliveryShown === true ? `학부모 미확인: ${span(data.unreadFrom, data.to) ?? "최근 30일"} 수업 보고서 중 발송 뒤 48시간이 지나도 안 읽은 것. ` : ""}출결 미입력: {span(data.attendanceFrom, data.attendanceTo) ?? "어제까지 7일"} 수업한 반×날 중 출결을 다 못 찍은 횟수(보고서를 안 쓰는 반 포함).</p>
    <p className={s.note}>{data.counselShown === true ? `원생상담: ${counselPeriodLabel(data.counselMonth, data.to)} 상담 의무 학생 중 1회 이상 상담한 비율(같은 과목은 요일을 가장 많이 맡은 선생님 몫)${data.counselAsOf ? `(${data.counselAsOf.slice(5).replace("-", "/")} 기준)` : ""}. ` : ""}영상 제출: 낸 숙제 중 실제 업로드 기준 · 출제율: 쓴 보고서 중 영상 과제가 나간 비율 · {data.videoCheckedAt ? `영상 확인 ${kstTimeOf(data.videoCheckedAt)} 기준` : "영상 상태 확인 대기"}. 분모가 0이면 비율은 —로 표시합니다.</p>
  </div>;
}
