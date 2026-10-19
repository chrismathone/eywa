"use client";

import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/aywa-icons";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { RelativeTime } from "@/components/relative-time";
import { buttonVariants } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { ASSIGNED_LABEL, QR_INTAKE_LABEL, cardMarkOf } from "@/features/enrollment/board-stages";
import { consultantLabel } from "@/features/enrollment/consultant-label";
import type { ConsultationTableRow } from "@/features/enrollment/server/queries";
import { SHEET_LEGEND, sheetDate, subjectCellOf } from "@/features/enrollment/sheet-cells";
import { EditingBadge } from "@/features/presence/editing-badge";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { kstDateOf } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { cn } from "@/lib/utils";
import {
  EditableSchoolGradeCell,
  EditableSelectCell,
  EditableStatusCell,
  EditableTextCell,
} from "./sheet-editable-cells";

/**
 * 열 = **칸반 카드가 보여 주는 것**(원장 2026-09-02 *"칸반뷰를 목록뷰로 보고 싶은건데"*): 카드의 이름·학교학년·
 * 표식·경과와, 카드에선 마우스 오버로 내린 상담사·학부모 요청 원문을 열로 편다. 모양만 옛 콜앤상담
 * 시트 — 왼쪽 상태 색 칸·범례·고정 제목·격자. 🔴 시트의 다른 열(수신자·유입경로·주소·결제…)은 세우지 않는다.
 * 연락처는 종전 목록뷰에 있던 열이라 그대로 둔다. '상담 내용'만 남는 폭을 전부 가져간다.
 * 같은 날 후속 지시로 바뀐 것: **'수업 N개' → '과목'**(학원설정 라벨·색, *"영어 수학 라벨 넣어"*) · 맨 뒤
 * **'자세히' 열의 '열기'**(칸반 카드 클릭과 같은 상세 창) · 나머지 칸은 **더블클릭 인라인 수정**(sheet-editable-cells).
 * 라벨은 `<th>`와 좁은 화면 카드의 `data-label` **한 곳**에서 나온다.
 */
const COLS = [
  { key: "status", label: "상태", w: 100 },
  { key: "no", label: "번호", w: 44 },
  { key: "name", label: "학생이름", w: 200 },
  { key: "school", label: "학교·학년", w: 112 },
  { key: "phone", label: "연락처", w: 116 },
  { key: "counselor", label: "상담사", w: 88 },
  { key: "subject", label: "과목", w: 76 },
  { key: "log", label: "상담 내용", w: null },
  { key: "date", label: "접수", w: 88 },
  { key: "detail", label: "자세히", w: 64 },
] as const;
type ColKey = (typeof COLS)[number]["key"];
const LABEL = Object.fromEntries(COLS.map((c) => [c.key, c.label])) as Record<ColKey, string>;

/**
 * 열 제목과 값은 같은 축(원장 2026-09-18) — 가운데, 긴 글(상담 내용)과 학생이름은 둘 다 왼쪽(이름 뒤에 '반 배정 완료'·녹음
 * 표식이 붙어 가운데로 모으면 이름 시작이 줄마다 달라진다 — 실측). 연락처는 번호가 칸을 채워 손대지 않았다 + 시트처럼 **위에 고정**(옛 시트의 `freeze A4`). 고정은 스크롤 컨테이너
 * (DragScrollArea 안쪽 div) 기준이라 표 영역이 높이를 가져야 한다 — 페이지 루트의 flex 기둥이 남는 높이를
 * 이 표에 준다(`min-h-0 flex-1`). 🔴 `border-collapse`면 sticky 칸의 테두리가 함께 밀려 사라진다([[#71]]) →
 * `border-separate`.
 */
const TH_BASE =
  "bg-bg-soft text-foreground border-b-line sticky top-0 z-10 border-b px-2 py-2 text-xs font-bold whitespace-nowrap";
const TH = `${TH_BASE} text-center`;
const TH_LEFT = `${TH_BASE} text-left`;
const TD = "border-b-line border-b px-2 py-1.5 align-top text-xs leading-[1.4] break-keep";
/**
 * 가운데 칸 — 더블클릭 편집 칸(CellFace)은 버튼이 제 `text-left`를 들고 있어 td 정렬을 안 따른다 → 바로 아래
 * 버튼만 가운데로 덮는다. 좁은 화면 카드(.consult-sheet, <640px)는 td를 왼쪽으로 되돌리니 버튼도 함께 왼쪽.
 */
const TD_CENTER = `${TD} text-center [&>button]:text-center max-sm:[&>button]:text-left`;
/** 접수 아래 '경과'를 붙이는 창 — relativeTimeKo가 상대 표기를 돌려주는 구간(7일 미만)과 같은 값. */
const RECENT_MS = 7 * 86_400_000;

/**
 * 등록상담 목록(시트) 뷰 — 칸반의 대안. 정렬은 접수 시각 내림차순(쿼리), 상세는 맨 뒤 '열기'.
 * 행은 **서버에서 한 페이지씩** 온다(ConsultationTableRow) — 반복접수 배지('상담 N건')는 페이지 안에서 세면
 * 거짓이 되므로 타입에 아예 없다(#89). 카드에는 있는 그 힌트가 여기 없는 이유다.
 *
 * 🔴 상태 칸 = 칸반과 같은 4단계(`statusCellOf` = `stageOfCard`)이고 색도 칸 색 그대로. 반 배정·QR 접수는
 *    칸반 카드와 같은 표식 규칙(`cardMarkOf`)으로 이름 옆에 선다. **녹음 표식은 단계와 무관하게 녹음이 있는
 *    모든 행**에 선다(원장 2026-09-02 *"반배정 완료는 됐고, 녹음기 아이콘만 넣어"* — 칸반 카드는 칸마다 표식이
 *    하나라 '등록 완료' 칸의 녹음이 숨었는데, 실측 녹음 16건 중 7건이 등록 완료 행이었다. 목록은 자리가 있다).
 * 🔴 **이름은 링크가 아니다** — 더블클릭이 편집이라 클릭에 창 열기를 걸면 두 동작이 한 자리에서 부딪힌다.
 *    상세 창은 '열기'(칸반 카드 클릭과 같은 `/enrollment/[id]`) 하나로 간다.
 * ⚠️ 빈 칸은 시트처럼 **비워 둔다**("—"를 안 적는다) — 좁은 화면 카드 규약(.consult-sheet)이 빈 칸을
 *    감춰 카드가 짧아지도록, 값이 없으면 자식을 아예 안 그린다(수정 가능 칸은 `data-empty`).
 */
export function EnrollmentTable({
  rows,
  nowMs,
  startIndex = 0,
  canWrite,
  consultants = [],
}: {
  rows: ConsultationTableRow[];
  nowMs: number;
  /** 이 페이지 첫 행의 0-기준 순번(= (page-1)×pageSize) — '번호' 열이 페이지를 넘어 이어진다. */
  startIndex?: number;
  /** 등록상담 쓰기 권한 — 더블클릭 편집의 **노출** 조건(게이트는 서버 액션, #77). */
  canWrite: boolean;
  /** '상담사' 칸 선택지 — 툴바 상담사 필터와 같은 목록(getConsultantOptions). */
  consultants?: { id: string; name: string }[];
}) {
  const subjects = useSubjectMaps();
  const consultantOptions = consultants.map((u) => ({ value: u.id, label: u.name }));
  return (
    // 페이지 루트(flex 기둥)의 한 칸으로서 남는 높이를 전부 받고(min-h-0 flex-1), 안에서 범례 + 표로 나눈다.
    <div className="consult-sheet flex min-h-0 flex-1 flex-col gap-2">
      {/* 시트 1~2행의 상태 색 범례 — 칸반 4칸과 같은 라벨·색(board-stages)이라 표의 상태 칸과 절대 안 갈린다. */}
      <div className="flex flex-wrap items-center gap-1.5 px-1" aria-label="상태 범례">
        <span className="text-text-dim text-xs font-bold">상태</span>
        {SHEET_LEGEND.map((l) => (
          <Pill key={l.label} color={l.color} soft={false}>
            {l.label}
          </Pill>
        ))}
        {canWrite ? (
          <span className="text-text-faint ml-auto text-xs">칸을 더블클릭하면 바로 고칠 수 있습니다 · Enter 저장 · Esc 취소</span>
        ) : null}
      </div>
      {/* 높이는 flex가 준다(창 크기·툴바 줄 수와 무관하게 페이저가 창 바닥에 붙는다 — 원장 2026-09-02 *"이 어색한
          여백은 뭐야"*: dvh 계산으로 박았더니 넓은 창에서 툴바가 한 줄로 접힌 만큼이 빈 띠로 남았다).
          min-h는 아주 낮은 창에서 표가 한 줄짜리 띠로 눌리지 않게 하는 바닥이고, 그땐 페이지가 스크롤된다.
          🔴 DragScrollArea 안쪽이 h-full이라 이 바깥이 높이를 가져야 표 안 스크롤·sticky 제목이 산다. */}
      <DragScrollArea scrollY className="bg-card border-line shadow-card min-h-[14rem] flex-1 rounded-2xl border">
        <table className="w-full min-w-[1080px] table-fixed border-separate border-spacing-0 [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          <caption className="sr-only">신규 콜&상담 목록</caption>
          <colgroup>
            {COLS.map((c) => (
              <col key={c.key} style={c.w ? { width: c.w } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className={c.key === "log" || c.key === "name" ? TH_LEFT : TH}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const mark = cardMarkOf(c);
              const received = sheetDate(kstDateOf(c.consultedAt));
              const recent = nowMs - Date.parse(c.consultedAt) < RECENT_MS;
              const audioTitle = `녹음 상담 · ${c.hasAiAnalysis || c.outcome === "ai_done" ? "AI 분석 완료" : "AI 분석 전"}`;
              const subject = subjectCellOf(c.subject, subjects);
              // 좁은 화면 카드가 빈 칸을 감추는 표식 — 편집 가능한 칸은 빈 값이어도 더블클릭 버튼이 서므로
              // `td:empty`로는 못 알아본다(.consult-sheet `td[data-empty]`). 값 판정은 표시와 같은 식.
              const emptyAttr = (filled: unknown) => (filled ? undefined : "true");
              return (
                <tr key={c.id} className="hover:bg-bg-soft/40">
                  <td className={`${TD} px-1.5`} data-label={LABEL.status}>
                    <EditableStatusCell row={c} canEdit={canWrite} />
                  </td>
                  <td className={`${TD} num text-text-dim text-center`} data-label={LABEL.no}>
                    {startIndex + i + 1}
                  </td>
                  <td className={TD} data-label={LABEL.name}>
                    <div className="flex flex-wrap items-center gap-1">
                      <EditableTextCell
                        id={c.id}
                        field="prospectName"
                        value={c.prospectName}
                        canEdit={canWrite}
                        inline
                        className="min-w-[3rem]"
                      >
                        <span className="text-foreground font-bold">{c.prospectName}</span>
                      </EditableTextCell>
                      {/* 칸반 카드와 같은 표식(cardMarkOf: 반 배정·QR) + 녹음은 단계와 무관(위 주석). 동기화·수정중도 카드 그대로. */}
                      {mark === "assigned" ? <Pill color="primary">{ASSIGNED_LABEL}</Pill> : null}
                      {mark === "qr" ? <Pill color="primary">{QR_INTAKE_LABEL}</Pill> : null}
                      {c.hasAudio ? (
                        <span
                          title={audioTitle}
                          aria-label={audioTitle}
                          className="bg-blue-soft text-blue rounded-pill inline-flex size-[22px] shrink-0 items-center justify-center"
                        >
                          <EyIcon name="mic" size={13} />
                        </span>
                      ) : null}
                      {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                      <EditingBadge scope={`consultation:${c.id}`} />
                    </div>
                  </td>
                  <td
                    className={TD_CENTER}
                    data-label={LABEL.school}
                    data-empty={emptyAttr(schoolGradeLabel(c.prospectSchool, c.prospectGrade))}
                  >
                    <EditableSchoolGradeCell
                      id={c.id}
                      school={c.prospectSchool}
                      grade={c.prospectGrade}
                      canEdit={canWrite}
                    />
                  </td>
                  <td
                    className={`${TD} num whitespace-nowrap`}
                    data-label={LABEL.phone}
                    data-empty={emptyAttr(c.parentPhone?.trim())}
                  >
                    <EditableTextCell id={c.id} field="parentPhone" value={c.parentPhone} canEdit={canWrite} />
                  </td>
                  <td className={TD_CENTER} data-label={LABEL.counselor} data-empty={emptyAttr(c.consultantId || consultantLabel(c))}>
                    {/* 계정이 없으면 상담자 글(상세와 같은 사실 — 원장 2026-10-19). 고르기는 계정만 그대로. */}
                    <EditableSelectCell
                      id={c.id}
                      field="consultantId"
                      value={c.consultantId}
                      options={consultantOptions}
                      canEdit={canWrite}
                      // 대체 글은 상담자 글만 — 인라인으로 계정을 '없음'으로 지운 직후 옛 계정 이름이 되살아나지 않게.
                      fallback={c.counselorText}
                    >
                      {consultantLabel(c)}
                    </EditableSelectCell>
                  </td>
                  <td className={TD_CENTER} data-label={LABEL.subject} data-empty={emptyAttr(subject)}>
                    <EditableSelectCell
                      id={c.id}
                      field="subject"
                      value={c.subject}
                      options={subjects.options}
                      canEdit={canWrite}
                    >
                      {subject ? (
                        subject.color ? (
                          <Pill color={subject.color}>{subject.label}</Pill>
                        ) : (
                          <span className="text-text-dim">{subject.label}</span>
                        )
                      ) : null}
                    </EditableSelectCell>
                  </td>
                  <td className={TD} data-label={LABEL.log} data-empty={emptyAttr(c.parentRequest?.trim())}>
                    <EditableTextCell id={c.id} field="parentRequest" value={c.parentRequest} canEdit={canWrite} multiline>
                      <div className="text-xs leading-[1.45] whitespace-pre-line">{c.parentRequest?.trim()}</div>
                    </EditableTextCell>
                  </td>
                  <td className={`${TD_CENTER} num`} data-label={LABEL.date}>
                    {received ? <div>{received}</div> : null}
                    {/* 경과는 **7일 이내만** — relativeTimeKo는 7일이 지나면 절대 날짜를 돌려줘 접수일과 같은 날짜를
                        두 번 적는다. 판정은 서버가 준 nowMs 기준이라 첫 렌더가 서버·클라 같다(하이드레이션 안전). */}
                    {recent ? (
                      <div className="text-text-faint text-xs">
                        <RelativeTime iso={c.consultedAt} nowMs={nowMs} />
                      </div>
                    ) : null}
                  </td>
                  <td className={TD} data-label={LABEL.detail}>
                    {/* 칸반 카드 클릭과 같은 상세 창(원장 2026-09-02 *"열기 버튼 누르면 칸반 클릭했을때 수정창 열리게"*).
                        flex로 감싼다 — inline-flex 링크를 글줄에 그대로 두면 baseline 아래 여백이 붙어 행이 10px 부푼다. */}
                    <div className="flex justify-center">
                      <WindowLink
                        href={`/enrollment/${c.id}`}
                        title={c.prospectName}
                        className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
                      >
                        열기
                      </WindowLink>
                    </div>
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
