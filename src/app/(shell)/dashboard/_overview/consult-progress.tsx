"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { TONE_SOFT, type SemanticTone } from "@/lib/design/semantic-color";
import type { BoardStageColor } from "@/features/enrollment/board-stages";
import type {
  ConsultProgressData,
  ProgressChip,
  ProgressCounts,
  StalledConsult,
} from "@/features/dashboard/overview/consultation-progress";
import { DetailPopup } from "./detail-popup";
import { number } from "./charts";
import s from "./overview.module.css";

/**
 * 콜&상담 진행 칩 — 상담 id → 지금 단계. 신규문의·금일입테 팝업과 입학 일정 줄이 **prop 배선 없이** 같은 표를 읽는다
 * (팝업은 포털이지만 React 문맥은 포털을 넘는다). 표가 없으면(권한 없음·조회 실패) 칩만 안 선다 — 줄은 종전 그대로.
 */
const ChipContext = createContext<Record<string, ProgressChip> | null>(null);

export function ConsultChipsProvider({
  chips,
  children,
}: {
  chips: Record<string, ProgressChip> | null;
  children: ReactNode;
}) {
  return <ChipContext.Provider value={chips}>{children}</ChipContext.Provider>;
}

/** 칸반 칸 색 → 의미색(칸반 머리 줄과 같은 색상 — 같은 단계 = 같은 색). */
const TONE: Record<BoardStageColor, SemanticTone> = {
  amber: "caution",
  blue: "info",
  neutral: "inert",
  green: "positive",
};

function chipText(chip: ProgressChip): string {
  return chip.detail ? `${chip.label} · ${chip.detail}` : chip.label;
}

export function ConsultStageChip({ id, className = "" }: {
  id: string | null | undefined;
  className?: string;
}) {
  const chips = useContext(ChipContext);
  const chip = id ? chips?.[id] : undefined;
  if (!chip) return null;
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full px-2 text-xs leading-5 font-bold ${TONE_SOFT[TONE[chip.color]]} ${className}`}
    >
      {chipText(chip)}
    </span>
  );
}

const STEPS: { key: keyof ProgressCounts; label: string }[] = [
  { key: "received", label: "접수" },
  { key: "consulted", label: "상담" },
  { key: "levelTest", label: "입테" },
  { key: "enrolled", label: "등록" },
  { key: "assigned", label: "반 배정" },
  { key: "started", label: "수업 시작" },
];

/**
 * 과목 키는 학원설정 라벨로(스냅샷 `subjects`), 옛 자유 텍스트('영어, 수학')는 사람이 적은 글이라 그대로.
 * 설정에 없는 **키 모양**(`subject_1` 등 지워진 과목)은 내보내지 않는다 — raw 코드 노출 금지.
 */
function subjectText(subject: string | null, subjects: Record<string, string>): string | null {
  if (!subject) return null;
  return subjects[subject] ?? (/^[a-z0-9_]+$/.test(subject) ? null : subject);
}

/** 멈춘 상담 줄 — 이름(상담 창 링크) · 과목 · 사유. */
function StalledList({ rows, subjects }: { rows: StalledConsult[]; subjects: Record<string, string> }) {
  return (
    <ul className="divide-line-faint divide-y">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          {/* 🔴 WindowLink의 title = 창 제목(영속) — 이름만 싣는다. */}
          <WindowLink
            href={`/enrollment/${row.id}`}
            title={`${row.name} 신규 콜&상담`}
            ariaLabel={`${row.name} 신규 콜&상담 상세 · ${row.label}`}
            className={`${s.studentLink} font-bold whitespace-nowrap`}
          >
            {row.name}
          </WindowLink>
          {subjectText(row.subject, subjects) && <span className="text-text-dim mr-auto">{subjectText(row.subject, subjects)}</span>}
          <span className={row.reason === "levelTest" ? "text-amber font-bold" : "font-bold"}>{row.label}</span>
        </li>
      ))}
    </ul>
  );
}

const STALL_PREVIEW = 6;

/** '상담 진행' 카드 몸통 — 단계별 인원(최근 30일) + 멈춘 상담(60일). */
export function ConsultProgressBody({ data, subjects }: { data: ConsultProgressData; subjects: Record<string, string> }) {
  const { counts, stalled } = data.summary;
  const steps = STEPS.filter((step) => counts[step.key] !== null);
  return (
    <div className="space-y-4">
      {counts.received === 0 ? (
        <p className={s.empty}>최근 30일 신규 콜&amp;상담이 없습니다.</p>
      ) : (
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="신규 콜&상담 단계별 인원">
          {steps.map((step, i) => (
            <li key={step.key} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-text-dim" aria-hidden>
                  ›
                </span>
              )}
              <span className="text-sm">{step.label}</span>
              <b className="num text-lg">{number(counts[step.key] ?? 0)}</b>
            </li>
          ))}
        </ol>
      )}
      {counts.levelTest === null && <p className={s.footnote}>입테는 학원 일정을 읽을 수 있을 때만 셉니다.</p>}
      <div>
        <p className="mb-1 text-sm font-bold">
          멈춘 상담 <span className={stalled.length ? "text-danger" : ""}>{number(stalled.length)}</span>건
        </p>
        {stalled.length === 0 ? (
          <p className={s.empty}>멈춘 상담이 없습니다.</p>
        ) : (
          <StalledList rows={stalled.slice(0, STALL_PREVIEW)} subjects={subjects} />
        )}
        {stalled.length > STALL_PREVIEW && (
          <DetailPopup title="멈춘 상담" label={`전체 ${stalled.length}건 보기`}>
            <StalledList rows={stalled} subjects={subjects} />
          </DetailPopup>
        )}
      </div>
      <p className={s.footnote}>
        단계는 각자 닿은 수입니다(입테 없이 등록하면 입테가 등록보다 적을 수 있습니다). 멈춘 상담 = 상담 완료 7일 넘게 결정 없음 · 입테 뒤 3일 넘게 등록 없음(최근 60일).
      </p>
    </div>
  );
}
