import { SheetClassName } from "@/features/teacher-view/interface-label";
import { WindowLink } from "@/components/workspace/window-link";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Pill } from "@/components/atoms/pill";
import { consultationPreview } from "@/features/consultations/summary-preview";
import type { StudentConsultationRow } from "@/features/consultations/server/queries";
import type { ConsultationRating } from "@/features/consultation-rating/rating";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { consultDateFull, consultDateLabel } from "@/features/consultations/list-date";
import { CATEGORY_META, URGENCY_META } from "./consultation-meta";
import { ConsultationRatingCell } from "./consultation-rating-cell";
import { ROW_GRID } from "./consultation-grid";

/** 원생상담 목록의 행 하나 — 열 격자·폭은 [consultation-list.tsx](./consultation-list.tsx)가 정한다(같은 `--row`·`--right` 변수를 읽는다). */
/**
 * 마우스 오버 전문 — 행에는 한 줄 값만 남기고(원장 *"기본은 그냥 칸반"*) 요약·후속은 여기로
 * (등록상담 카드와 같은 규약: [column-cards.tsx](../../enrollment/_components/column-cards.tsx)).
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다 — 행을 열면 상세에 전부 있으므로 폰에서도 한 번의 탭으로 닿는다.
 */
function hoverTextOf(c: StudentConsultationRow, classOn: boolean): string | undefined {
  const who = [c.subject, c.counselorName ? `${c.counselorName} 상담` : null].filter(Boolean).join(" · ");
  const sg = schoolGradeLabel(c.studentSchool, c.studentGrade);
  const followUp =
    c.followUpAction || c.followUpDate
      ? `후속 조치: ${c.followUpAction ?? "—"}${c.followUpDate ? ` · 기한 ${c.followUpDate}` : ""}${c.followUpDone ? " · 완료" : ""}`
      : null;
  const date = consultDateFull(c.consultedAt);
  return (
    [
      `${c.studentName}${sg ? ` (${sg})` : ""}`,
      date ? `상담일 ${date}` : null,
      who || null,
      classOn ? `반: ${c.className ?? "없음"}${c.classSource === "manual" ? "(직접 고름)" : ""}` : null,
      c.summary?.trim() || null,
      followUp,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

export function ConsultationRow({ c, classOn, ratingOn, rating }: { c: StudentConsultationRow; classOn: boolean; ratingOn: boolean; rating: ConsultationRating | null }) {
  const catMeta = c.category ? CATEGORY_META[c.category] : null;
  // 후속 기한이 지났거나 오늘인 행은 배경으로 알린다 — '후속' 열은 걷었어도(2026-11-11) 이 신호는 남긴다. 무슨 후속인지는 마우스 오버 전문(hoverTextOf)에 적힌다.
  const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
  const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
  const sg = schoolGradeLabel(c.studentSchool, c.studentGrade);
  return (
    // @container/row — 이 행(=단)의 폭이 행 격자 두 벌(consultation-grid.ts)을 고른다.
    <li title={hoverTextOf(c, classOn)} className="@container/row border-line border-t">
      {/* 폰(`phone:` = 최상위 프레임 <768px)은 두 줄 — [이름 학교학년 | 과목 · 상담자 · 반] / [날짜 · 카테고리 · 상담 평점].
          🔴 `max-md:`가 아니다 — 이 창은 기본 크기가 760px(<768)이라 `max-md:`면 데스크톱 창이 폰 카드로 바뀐다. */}
      <WindowLink
        href={`/consultations/${c.id}`}
        title={c.studentName}
        className={`hover:bg-bg-soft grid h-11 items-center gap-2 rounded-lg px-1.5 transition ${ROW_GRID} phone:h-auto phone:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]! phone:gap-y-1 phone:py-1.5 ${isUrgent ? "bg-danger-soft" : ""}`}
      >
        <p className="text-text-dim min-w-0 truncate text-center text-sm font-medium phone:hidden" title={c.subject ?? undefined}>{c.subject ?? "—"}</p>
        {/* 이름 24px 굵게 — 1차 핵심값이라 이 칸엔 이름만(학교학년은 다음 열 · 폰에선 이름 옆에 붙는다). */}
        <p className="text-foreground min-w-0 truncate text-xl leading-none font-bold">
          {c.studentName}
          {sg ? <span className="text-text-dim ml-1 hidden text-base font-semibold phone:inline">({sg})</span> : null}
        </p>
        <p className={`min-w-0 truncate text-sm font-medium phone:hidden ${sg ? "text-text-dim" : "text-muted-foreground"}`}>{sg || "—"}</p>
        {/* 반 이름 — 상담사가 가르치는 반(판정 한 벌: scripts/_makeedu/consultation-class.cjs). 못 정하면 '—'(추측 금지). */}
        {classOn ? (
          <p className={`min-w-0 truncate text-sm font-medium phone:hidden ${c.className ? "text-text-dim" : "text-muted-foreground"}`} title={c.className ?? "반 없음"}>
            {c.className ?? "—"}
          </p>
        ) : null}
        {/* 상담자 — 동기화·수정중 배지는 여기(2차 정보 칸)에. 폰에선 과목·반도 여기 붙는다(그 열들이 폰에서 숨는다). */}
        <p className="text-text-dim flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="min-w-0 truncate">
            {c.subject ? <span className="hidden phone:inline">{c.subject} · </span> : null}
            {c.counselorName ?? "—"}
            {classOn && c.className ? <span className="hidden phone:inline"> · <SheetClassName value={c.className} /></span> : null}
          </span>
          {c.syncAddedAt ? <MakeeduOriginTag /> : null}
          <EditingBadge scope={`student-consultation:${c.id}`} />
        </p>
        {/* 요약 한 줄 — 2차 정보라 말줄임 허용(§1). 전문은 마우스 오버·상세. */}
        <p className="text-text-faint hidden min-w-0 truncate text-sm @5xl/row:block" title={c.summary}>
          {consultationPreview(c.summary)}
        </p>
        {/* 오른쪽은 **열**이다 — 날짜 | 카테고리 | 상담 평점, 칸 폭 고정이라 행마다 배지 수가 달라도 같은 자리에 선다. */}
        <div
          className={`-col-end-1 grid grid-cols-(--right) items-center justify-items-center gap-1 phone:col-start-1 ${ratingOn ? "phone:grid-cols-[auto_auto_minmax(0,1fr)]!" : "phone:grid-cols-[auto_minmax(0,1fr)]!"} phone:justify-items-start phone:gap-2`}
        >
          <span className="num text-text-dim text-sm whitespace-nowrap">{consultDateLabel(c.consultedAt)}</span>
          <span>{catMeta ? <Pill color={catMeta.color}>{catMeta.label}</Pill> : null}</span>
          {ratingOn ? <ConsultationRatingCell rating={rating} /> : null}
        </div>
      </WindowLink>
    </li>
  );
}
