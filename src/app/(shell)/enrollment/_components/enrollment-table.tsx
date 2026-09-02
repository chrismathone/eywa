"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { RelativeTime } from "@/components/relative-time";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { ASSIGNED_LABEL, QR_INTAKE_LABEL, cardMarkOf } from "@/features/enrollment/board-stages";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import { SHEET_LEGEND, sheetDate, statusCellOf } from "@/features/enrollment/sheet-cells";
import { EditingBadge } from "@/features/presence/editing-badge";
import { kstDateOf } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 열 = **칸반 카드가 보여 주는 것**(원장 2026-09-02 *"칸반뷰를 목록뷰로 보고 싶은건데"*): 카드의 이름·학교학년·
 * 표식·경과와, 카드에선 마우스 오버로 내린 상담사·수업 수·학부모 요청 원문을 열로 편다. 모양만 옛 콜앤상담
 * 시트 — 왼쪽 상태 색 칸·범례·고정 제목·격자. 🔴 시트의 다른 열(수신자·유입경로·주소·결제…)은 세우지 않는다.
 * 연락처는 종전 목록뷰에 있던 열이라 그대로 둔다. '상담 내용'만 남는 폭을 전부 가져간다.
 * 라벨은 `<th>`와 좁은 화면 카드의 `data-label` **한 곳**에서 나온다.
 */
const COLS = [
  { key: "status", label: "상태", w: 100 },
  { key: "no", label: "번호", w: 44 },
  { key: "name", label: "학생이름", w: 184 },
  { key: "school", label: "학교·학년", w: 104 },
  { key: "phone", label: "연락처", w: 116 },
  { key: "counselor", label: "상담사", w: 80 },
  { key: "classes", label: "수업", w: 56 },
  { key: "log", label: "상담 내용", w: null },
  { key: "date", label: "접수", w: 88 },
] as const;
type ColKey = (typeof COLS)[number]["key"];
const LABEL = Object.fromEntries(COLS.map((c) => [c.key, c.label])) as Record<ColKey, string>;

/**
 * 열 제목은 가운데(데이터 표 규약) + 시트처럼 **위에 고정**(옛 시트의 `freeze A4`). 고정은 스크롤 컨테이너
 * (DragScrollArea 안쪽 div) 기준이라 표 영역이 높이를 가져야 한다 — 페이지 루트의 flex 기둥이 남는 높이를
 * 이 표에 준다(`min-h-0 flex-1`). 🔴 `border-collapse`면 sticky 칸의 테두리가 함께 밀려 사라진다([[#71]]) →
 * `border-separate`.
 */
const TH =
  "bg-bg-soft text-foreground border-b-line sticky top-0 z-10 border-b px-2 py-2 text-center text-[12px] font-bold whitespace-nowrap";
const TD = "border-b-line border-b px-2 py-1.5 align-top text-[12.5px] leading-[1.4] break-keep";
/** 접수 아래 '경과'를 붙이는 창 — relativeTimeKo가 상대 표기를 돌려주는 구간(7일 미만)과 같은 값. */
const RECENT_MS = 7 * 86_400_000;

/**
 * 등록상담 목록(시트) 뷰 — 칸반의 대안. 정렬은 접수 시각 내림차순(쿼리), 이름 클릭=상세 창.
 * 행은 **서버에서 한 페이지씩** 온다(ConsultationTableRow) — 반복접수 배지('상담 N건')는 페이지 안에서 세면
 * 거짓이 되므로 타입에 아예 없다(#89). 카드에는 있는 그 힌트가 여기 없는 이유다.
 *
 * 🔴 상태 칸 = 칸반과 같은 4단계(`statusCellOf` = `stageOfCard`)이고 색도 칸 색 그대로. 반 배정·QR 접수·녹음은
 *    칸반 카드와 같은 표식 규칙(`cardMarkOf`, 칸마다 최대 하나)으로 이름 옆에 선다.
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
  /** 이 페이지 첫 행의 0-기준 순번(= (page-1)×pageSize) — '번호' 열이 페이지를 넘어 이어진다. */
  startIndex?: number;
}) {
  return (
    // 페이지 루트(flex 기둥)의 한 칸으로서 남는 높이를 전부 받고(min-h-0 flex-1), 안에서 범례 + 표로 나눈다.
    <div className="consult-sheet flex min-h-0 flex-1 flex-col gap-2">
      {/* 시트 1~2행의 상태 색 범례 — 칸반 4칸과 같은 라벨·색(board-stages)이라 표의 상태 칸과 절대 안 갈린다. */}
      <div className="flex flex-wrap items-center gap-1.5 px-1" aria-label="상태 범례">
        <span className="text-text-dim text-[11.5px] font-bold">상태</span>
        {SHEET_LEGEND.map((l) => (
          <Pill key={l.label} color={l.color} soft={false}>
            {l.label}
          </Pill>
        ))}
      </div>
      {/* 높이는 flex가 준다(창 크기·툴바 줄 수와 무관하게 페이저가 창 바닥에 붙는다 — 원장 2026-09-02 *"이 어색한
          여백은 뭐야"*: dvh 계산으로 박았더니 넓은 창에서 툴바가 한 줄로 접힌 만큼이 빈 띠로 남았다).
          min-h는 아주 낮은 창에서 표가 한 줄짜리 띠로 눌리지 않게 하는 바닥이고, 그땐 페이지가 스크롤된다.
          🔴 DragScrollArea 안쪽이 h-full이라 이 바깥이 높이를 가져야 표 안 스크롤·sticky 제목이 산다. */}
      <DragScrollArea scrollY className="bg-card border-line shadow-card min-h-[14rem] flex-1 rounded-2xl border">
        <table className="w-full min-w-[1080px] table-fixed border-separate border-spacing-0 [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
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
              const gradeLabel = schoolGradeLabel(c.prospectSchool, c.prospectGrade);
              const received = sheetDate(kstDateOf(c.consultedAt));
              const recent = nowMs - Date.parse(c.consultedAt) < RECENT_MS;
              const audioTitle = `녹음 상담 · ${c.hasAiAnalysis || c.outcome === "ai_done" ? "AI 분석 완료" : "AI 분석 전"}`;
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
                  <td className={TD} data-label={LABEL.name}>
                    <div className="flex flex-wrap items-center gap-1">
                      <WindowLink
                        href={`/enrollment/${c.id}`}
                        title={c.prospectName}
                        className="text-foreground font-bold hover:underline"
                      >
                        {c.prospectName}
                      </WindowLink>
                      {/* 칸반 카드와 같은 표식(cardMarkOf) — 칸마다 최대 하나. 동기화 태그·수정중 배지도 카드 그대로. */}
                      {mark === "assigned" ? <Pill color="primary">{ASSIGNED_LABEL}</Pill> : null}
                      {mark === "qr" ? <Pill color="primary">{QR_INTAKE_LABEL}</Pill> : null}
                      {mark === "audio" ? (
                        <span
                          title={audioTitle}
                          aria-label={audioTitle}
                          className="bg-blue-soft text-blue rounded-pill inline-flex size-5 shrink-0 items-center justify-center"
                        >
                          <EyIcon name="mic" size={12} />
                        </span>
                      ) : null}
                      {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                      <EditingBadge scope={`consultation:${c.id}`} />
                    </div>
                  </td>
                  <td className={TD} data-label={LABEL.school}>
                    {gradeLabel || null}
                  </td>
                  <td className={`${TD} num whitespace-nowrap`} data-label={LABEL.phone}>
                    {c.parentPhone}
                  </td>
                  <td className={TD} data-label={LABEL.counselor}>
                    {c.consultantName}
                  </td>
                  <td className={`${TD} num text-center`} data-label={LABEL.classes}>
                    {c.assignedClassCount >= 1 ? `${c.assignedClassCount}개` : null}
                  </td>
                  <td className={TD} data-label={LABEL.log}>
                    {c.parentRequest?.trim() ? (
                      <div className="text-[12px] leading-[1.45] whitespace-pre-line">{c.parentRequest.trim()}</div>
                    ) : null}
                  </td>
                  <td className={`${TD} num`} data-label={LABEL.date}>
                    {received ? <div>{received}</div> : null}
                    {/* 경과는 **7일 이내만** — relativeTimeKo는 7일이 지나면 절대 날짜를 돌려줘 접수일과 같은 날짜를
                        두 번 적는다. 판정은 서버가 준 nowMs 기준이라 첫 렌더가 서버·클라 같다(하이드레이션 안전). */}
                    {recent ? (
                      <div className="text-text-faint text-[11px]">
                        <RelativeTime iso={c.consultedAt} nowMs={nowMs} />
                      </div>
                    ) : null}
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
