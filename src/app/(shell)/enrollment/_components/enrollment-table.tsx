"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { RelativeTime } from "@/components/relative-time";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { QR_INTAKE_LABEL, cardMarkOf } from "@/features/enrollment/board-stages";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import {
  SHEET_LEGEND,
  callDateOf,
  noteLines,
  sheetDate,
  sheetDateDow,
  statusCellOf,
  subjectTokens,
  wonLabel,
} from "@/features/enrollment/sheet-cells";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_BORDER } from "@/features/owner/subjects";
import { EditingBadge } from "@/features/presence/editing-badge";

/**
 * 시트 열 — 옛 콜앤상담 시트(`2025.6월·7월 입학상담` 탭)의 열 순서를 따른다(원장 2026-09-02 *"칸반뷰를
 * 시트처럼 목록뷰화"*). 폭(px)은 그 시트의 열 폭 비율을 화면 글씨에 맞춰 옮긴 값이고 **'상담 내용'만 남는
 * 폭을 전부 가져간다**(시트에서도 I열 59.6으로 압도적). 시트의 '요일'은 상담일 칸에 붙였고, 수납·수강료·
 * 신규콜·출석 같은 **채움률 0의 열은 세우지 않았다**(실측 2025.6·7월 탭 모두 0/43·0/36).
 * 라벨은 `<th>`와 좁은 화면 카드의 `data-label` **한 곳**에서 나온다.
 */
const COLS = [
  // 상태 폭 = 가장 긴 라벨 '반 배정 완료'(11px 굵게 6자+공백 2 ≈ 72px) + 알약 좌우 20px + 칸 여백 12px.
  { key: "status", label: "상태", w: 112 },
  { key: "no", label: "번호", w: 44 },
  { key: "call", label: "콜일자", w: 76 },
  { key: "name", label: "학생이름", w: 124 },
  { key: "phone", label: "전화번호", w: 112 },
  { key: "subject", label: "문의과목", w: 96 },
  { key: "school", label: "학교", w: 84 },
  { key: "grade", label: "학년", w: 48 },
  { key: "log", label: "상담 내용", w: null },
  { key: "receiver", label: "수신자", w: 64 },
  { key: "path", label: "유입경로", w: 104 },
  { key: "counselor", label: "상담자", w: 72 },
  { key: "consultDate", label: "상담일", w: 84 },
  { key: "address", label: "주소", w: 128 },
  { key: "reg", label: "등록현황", w: 96 },
  { key: "pay", label: "결제", w: 96 },
  { key: "note", label: "비고", w: 168 },
] as const;
type ColKey = (typeof COLS)[number]["key"];
const LABEL = Object.fromEntries(COLS.map((c) => [c.key, c.label])) as Record<ColKey, string>;

/**
 * 열 제목은 가운데(데이터 표 규약) + 시트처럼 **위에 고정**(옛 시트의 `freeze A4`). 고정은 스크롤 컨테이너
 * (DragScrollArea 안쪽 div) 기준이라 표 영역이 높이를 가져야 한다 — 아래 래퍼의 `h-[calc(100dvh-…)]`.
 * 🔴 `border-collapse`면 sticky 칸의 테두리가 함께 밀려 사라진다([[#71]]) → `border-separate`.
 */
const TH =
  "bg-bg-soft text-foreground border-b-line sticky top-0 z-10 border-b px-2 py-2 text-center text-[12px] font-bold whitespace-nowrap";
const TD = "border-b-line border-b px-2 py-1.5 align-top text-[12.5px] leading-[1.4] break-keep";
/** 콜일자 아래 '경과'를 붙이는 창 — relativeTimeKo가 상대 표기를 돌려주는 구간(7일 미만)과 같은 값. */
const RECENT_MS = 7 * 86_400_000;

/**
 * 등록상담 목록(시트) 뷰 — 칸반의 대안. 정렬은 접수 시각 내림차순(쿼리), 이름 클릭=상세 창.
 * 행은 **서버에서 한 페이지씩** 온다(ConsultationTableRow) — 반복접수 배지는 페이지 안에서 세면
 * 거짓이 되므로 타입에 아예 없다(#89). 필요해지면 별도 count 쿼리로 받아올 것.
 *
 * 🔴 상태 칸은 outcome **원값**(브리프)이고 색은 outcome-meta 단일 소스 — 시트의 8색 범례에 해당하는
 *    범례를 표 위에 같은 색으로 세운다(SHEET_LEGEND). 배정(수강 ≥ 1)은 칸반과 같이 outcome을 이긴다.
 * ⚠️ 빈 칸은 시트처럼 **비워 둔다**("—"를 안 적는다) — 좁은 화면 카드 규약(.consult-sheet)이 빈 칸을
 *    감춰 카드가 짧아지도록, 값이 없으면 자식을 아예 안 그린다.
 */
export function EnrollmentTable({
  rows,
  nowMs,
  startIndex = 0,
}: {
  rows: ConsultationTableRow[];
  nowMs: number;
  /** 이 페이지 첫 행의 0-기준 순번(= (page-1)×pageSize) — 시트의 '번호' 열이 페이지를 넘어 이어진다. */
  startIndex?: number;
}) {
  const { labelOf, colorOf } = useSubjectMaps();
  return (
    <div className="consult-sheet space-y-2">
      {/* 시트 1~2행의 상태 색 범례 — 같은 색·같은 라벨(outcome-meta)이라 표의 상태 칸과 절대 안 갈린다. */}
      <div className="flex flex-wrap items-center gap-1.5 px-1" aria-label="상태 범례">
        <span className="text-text-dim text-[11.5px] font-bold">상태</span>
        {SHEET_LEGEND.map((l) => (
          <Pill key={l.label} color={l.color} soft={false}>
            {l.label}
          </Pill>
        ))}
      </div>
      <DragScrollArea
        scrollY
        // 높이 = 창(iframe) 높이 − 위(헤더·툴바·범례)·아래(페이저·여백). 실측 2026-09-02 embed 1400×800에서
        // 18.5rem이면 창 스크롤 0·표 안 스크롤만 남는다(풀셸 배경 페이지는 헤더가 커서 20px쯤 더 스크롤된다 — 감수).
        // 🔴 max-h로 바꾸지 말 것 — DragScrollArea 안쪽이 h-full이라 max-h면 넘친 행이 잘려 영영 안 보인다.
        className="bg-card border-line shadow-card h-[calc(100dvh-18.5rem)] min-h-[22rem] rounded-2xl border"
      >
        <table className="w-full min-w-[1800px] table-fixed border-separate border-spacing-0 [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          <caption className="sr-only">등록상담 목록</caption>
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={c.w ? { width: c.w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={TH}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const status = statusCellOf(c);
              const mark = cardMarkOf(c);
              const call = callDateOf(c);
              const subjects = subjectTokens(c.subject);
              const pay = wonLabel(c.paymentAmount);
              const payDate = sheetDate(c.paymentDate);
              const notes = noteLines(c);
              return (
                <tr key={c.id} className="hover:bg-bg-soft/40">
                  <td className={`${TD} px-1.5`} data-label={LABEL.status}>
                    <Pill color={status.color} soft={false} className="w-full">
                      {status.label}
                    </Pill>
                  </td>
                  <td className={`${TD} num text-text-dim text-center`} data-label={LABEL.no}>
                    {startIndex + i + 1}
                  </td>
                  <td className={`${TD} num`} data-label={LABEL.call}>
                    {call ? <div>{sheetDate(call)}</div> : null}
                    {/* 경과는 **7일 이내만** — relativeTimeKo는 7일이 지나면 절대 날짜를 돌려줘 콜일자와 같은 날짜를
                        두 번 적고(실측 `8/26` 아래 `2026. 8. 26.`) 좁은 칸을 두 줄로 부풀린다. 판정은 서버가 준
                        nowMs 기준이라 첫 렌더가 서버·클라 같다(하이드레이션 안전). */}
                    {nowMs - Date.parse(c.consultedAt) < RECENT_MS ? (
                      <div className="text-text-faint text-[11px]">
                        <RelativeTime iso={c.consultedAt} nowMs={nowMs} />
                      </div>
                    ) : null}
                  </td>
                  <td className={TD} data-label={LABEL.name}>
                    <div className="flex flex-wrap items-center gap-1">
                      <WindowLink
                        href={`/enrollment/${c.id}`}
                        title={c.prospectName}
                        className="text-foreground font-bold hover:underline"
                      >
                        {c.prospectName}
                      </WindowLink>
                      <EditingBadge scope={`consultation:${c.id}`} />
                      {/* 칸반 카드와 같은 표식 규칙(cardMarkOf) — 배정은 상태 칸이 이미 말하므로 여기선 QR·녹음만. */}
                      {mark === "qr" ? <Pill color="primary">{QR_INTAKE_LABEL}</Pill> : null}
                      {mark === "audio" ? (
                        <span
                          title={`녹음 상담 · ${c.hasAiAnalysis ? "AI 분석 완료" : "AI 분석 전"}`}
                          aria-label={`녹음 상담 · ${c.hasAiAnalysis ? "AI 분석 완료" : "AI 분석 전"}`}
                          className="bg-blue-soft text-blue rounded-pill inline-flex size-5 shrink-0 items-center justify-center"
                        >
                          <EyIcon name="mic" size={12} />
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${TD} num whitespace-nowrap`} data-label={LABEL.phone}>
                    {c.parentPhone}
                  </td>
                  <td className={TD} data-label={LABEL.subject}>
                    {subjects.length ? (
                      <div className="flex flex-wrap gap-1">
                        {/* 과목은 테두리 배지(의미색 캐논: 상태=채움, 과목=테두리) — 색은 학원설정 단일 소스. */}
                        {subjects.map((k, j) => (
                          <span
                            key={`${k}-${j}`}
                            className={`inline-block rounded-md border px-1.5 py-px text-[11px] font-bold ${SUBJECT_BORDER[colorOf(k)]}`}
                          >
                            {labelOf(k)}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className={TD} data-label={LABEL.school}>
                    {c.prospectSchool}
                  </td>
                  <td className={`${TD} num text-center`} data-label={LABEL.grade}>
                    {c.prospectGrade}
                  </td>
                  <td className={TD} data-label={LABEL.log}>
                    {c.parentRequest ? (
                      <div className="text-[12px] leading-[1.45] whitespace-pre-line">{c.parentRequest}</div>
                    ) : null}
                  </td>
                  <td className={TD} data-label={LABEL.receiver}>
                    {c.receiver}
                  </td>
                  <td className={TD} data-label={LABEL.path}>
                    {c.consultationPath}
                  </td>
                  <td className={TD} data-label={LABEL.counselor}>
                    {c.consultantName ?? c.counselor}
                  </td>
                  <td className={`${TD} num`} data-label={LABEL.consultDate}>
                    {sheetDateDow(c.consultationDate)}
                  </td>
                  <td className={TD} data-label={LABEL.address}>
                    {c.address}
                  </td>
                  <td className={TD} data-label={LABEL.reg}>
                    {c.registrationStatus}
                  </td>
                  <td className={`${TD} num`} data-label={LABEL.pay}>
                    {pay ? <div>{pay}</div> : null}
                    {payDate ? <div className="text-text-dim text-[11px]">{payDate}</div> : null}
                  </td>
                  <td className={TD} data-label={LABEL.note}>
                    {notes.length
                      ? notes.map((line) => (
                          <div key={line} className="text-[12px]">
                            {line}
                          </div>
                        ))
                      : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DragScrollArea>
    </div>
  );
}
