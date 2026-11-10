import type { ReactNode } from "react";
import {
  isEieDailySections,
  isPilotTitle,
  parseLevelRows,
  type PilotNoteSection,
} from "../pilot-notes";
import { PilotSheetHead, type PilotSheetHeadProps } from "./pilot-sheet-head";
import { PilotNoteBox, SectionBody } from "./pilot-notes-body";
import { splitImageSlots } from "@/features/report-templates/image-slots";
import { attendanceMarkIsEnough, attendanceMarkOf } from "../attendance-sentence";
import styles from "./pilot-report-sheet.module.css";

/** EiE 가로 로고(원장이 보내 준 그림 — 'Express In English · 고려대학교 영어교육 프로그램'). 일일 보고서 학원 로고 아래에 놓는다. */
export const EIE_WIDE_LOGO_SRC = "/eie-logo-wide.png";

// 수학 보고서 시범의 학부모 카드 = **데일리 학습알림 표**(원장 2026-10-23: 참고 시안 + *"색감은 쨍하게 눈에 잘 띄어야함 ·
// 좌측상단 인재원 마크 · 담임도 들어가야함 · 밑의 내용란들과 전체적인 디자인을 다시 재편성"*).
// 위 = 칸이 맞물린 표(pilot-sheet-head.tsx), 아래 = 같은 남색 띠로 이어지는 항목. 항목 **순서는 글 그대로**다 —
// 원장이 정한 진도 → 태도 → 숙제 완성도 → 오늘의 수업 → 오늘의 숙제 → (추이·첨부) → 사랑의 한마디(맨 아래).
// 테스트·수업 평가만 표 머리로 올린다(참고 시안의 자리). 형식이 안 맞는 항목은 띠 아래 글 그대로(표를 지어내지 않는다).

/** 남색 띠 + 본문 — 아래 항목들의 공통 틀. */
export function SheetBand({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-line-strong border-t">
      <h2 className="flex bg-[var(--sheet-band,var(--primary))] items-center gap-2 px-4 py-2.5 text-base font-black text-white">
        <span
          aria-hidden
          className="bg-report-accent size-2.5 shrink-0 rounded-sm"
        />
        {title}
      </h2>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** 글을 표 머리(테스트·수업 평가)와 아래 띠 항목으로 가른다. 수업 평가가 표로 안 읽히면 띠로 남긴다. */
export function splitSheetSections(sections: PilotNoteSection[]) {
  const tests = sections.filter(
    (s) =>
      s.body &&
      (isPilotTitle(s.title, "daily") || isPilotTitle(s.title, "check")),
  );
  const levelSec = sections.find((s) => isPilotTitle(s.title, "levels"));
  const levels = levelSec ? parseLevelRows(levelSec.body) : null;
  // 출결 — 머리의 작은 표시로 올린다(원장 2026-10-26 *"조그마한 마크같은걸로 출석 여부 바로 확인"*). 출석·보강은 표시만으로 충분해
  // 띠를 따로 세우지 않고, 사유가 붙는 지각·조퇴·공결은 띠도 남긴다. 모르는 글이면 표시 없이 띠 그대로.
  const attSec = sections.find((s) => isPilotTitle(s.title, "attendance"));
  const attendance = attendanceMarkOf(attSec?.body);
  const rest = sections.filter(
    (s) => !tests.includes(s) && !(levels && s === levelSec) && !(s === attSec && attendanceMarkIsEnough(attendance)),
  );
  return { tests, levels, rest, attendance };
}

export type PilotReportSheetProps = Omit<
  PilotSheetHeadProps,
  "tests" | "levels" | "attendance"
> & {
  sections: PilotNoteSection[];
  note: PilotNoteSection | null;
  /** 교재 — 글에 없어 진도 띠 위에 한 줄로 붙인다(학원 설정 showTextbook을 호출부가 이미 반영). */
  textbook: string | null;
  /** 학습 추이·학습 추세·첨부 — 카드가 기존 재료로 그려 넘긴다(사랑의 한마디 앞). */
  middle: { title: string; body: ReactNode }[];
  footer: string | null;
  /**
   * 그림·첨부 자리 줄(`[시험결과지]`·`[첨부: 이름]`)이 든 항목의 본문 — 영어 항목 보고서(2026-10-26)의 '인재원 결과지'.
   * 카드가 영어 본문 그리기(TemplateBody)를 넘긴다. 없으면(수학) 그 줄도 글 그대로다.
   */
  markerBody?: (text: string) => ReactNode;
  /** 영어 보고서 — 띠·머리 칸·바닥글·테두리 배경을 EiE 월간 시트의 빨강으로(원장 2026-11-10). 없으면 학원 색. */
  eieRed?: boolean;
};

/** 항목 본문에 그림·첨부 자리 줄이 있나 — 있으면 그 항목은 자리 그리기로 넘긴다. */
function hasMarkerLines(body: string): boolean {
  return splitImageSlots(body).some((seg) => seg.kind !== "text");
}

export function PilotReportSheet({
  sections,
  note,
  textbook,
  middle,
  footer,
  markerBody,
  eieRed = false,
  ...head
}: PilotReportSheetProps) {
  const { tests, levels, rest, attendance } = splitSheetSections(sections);
  const hasProgress = rest.some((s) => isPilotTitle(s.title, "progress"));
  return (
    <article className={`bg-card overflow-hidden border-2 border-[var(--sheet-band,var(--primary))] ${eieRed ? styles.eieRed : ""}`}>
      <PilotSheetHead
        {...head}
        tests={tests}
        levels={levels}
        attendance={attendance}
        // EiE 일일 보고서(원장 2026-11-06 *"왼쪽 인재원 로고 밑에 해당 로고 배치"*) — 글이 EiE 일일 템플릿일 때만.
        programLogoSrc={isEieDailySections(sections) ? EIE_WIDE_LOGO_SRC : null}
      />
      {textbook && !hasProgress ? <TextbookRow textbook={textbook} /> : null}
      {rest.map((s, i) => (
        <SheetBand key={`${i}-${s.title}`} title={s.title}>
          {textbook && isPilotTitle(s.title, "progress") ? (
            <TextbookRow textbook={textbook} inBand />
          ) : null}
          {/* 사랑의 한마디가 중간에 서는 글(JJ 수업보고서 — 수업 평가 바로 아래, 원장 2026-10-27)도 맨 아래와 같은 상자로. */}
          {s.body ? (
            markerBody && hasMarkerLines(s.body) ? markerBody(s.body) : isPilotTitle(s.title, "note") ? <PilotNoteBox text={s.body} /> : <SectionBody s={s} />
          ) : null}
        </SheetBand>
      ))}
      {middle.map((m) => (
        <SheetBand key={m.title} title={m.title}>
          {m.body}
        </SheetBand>
      ))}
      {note?.body ? (
        <SheetBand title={note.title}>
          {markerBody && hasMarkerLines(note.body) ? markerBody(note.body) : <PilotNoteBox text={note.body} />}
        </SheetBand>
      ) : null}
      {footer ? (
        <footer className="bg-[var(--sheet-band-deep,var(--primary-deep))] px-3 py-2.5 text-center text-xs font-medium text-white/85">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

/** 교재 한 줄 — 진도 띠 안 맨 위(또는 진도 항목이 없으면 표 바로 아래). */
function TextbookRow({
  textbook,
  inBand = false,
}: {
  textbook: string;
  inBand?: boolean;
}) {
  return (
    <div
      className={`flex items-stretch ${inBand ? "border-line mb-3 rounded-md border" : "border-line-strong border-t"}`}
    >
      <span className="bg-report-accent-soft text-text-dim flex w-[24%] shrink-0 items-center justify-center py-2 text-sm font-bold">
        교재
      </span>
      <span className="text-foreground min-w-0 flex-1 px-3 py-2 text-base font-bold break-keep">
        {textbook}
      </span>
    </div>
  );
}
