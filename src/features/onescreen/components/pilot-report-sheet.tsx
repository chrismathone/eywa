import type { ReactNode } from "react";
import {
  isPilotTitle,
  parseLevelRows,
  type PilotNoteSection,
} from "../pilot-notes";
import { PilotSheetHead, type PilotSheetHeadProps } from "./pilot-sheet-head";
import { PilotNoteBox, SectionBody } from "./pilot-notes-body";

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
      <h2 className="bg-primary flex items-center gap-2 px-4 py-2.5 text-base font-black text-white">
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
  const rest = sections.filter(
    (s) => !tests.includes(s) && !(levels && s === levelSec),
  );
  return { tests, levels, rest };
}

export type PilotReportSheetProps = Omit<
  PilotSheetHeadProps,
  "tests" | "levels"
> & {
  sections: PilotNoteSection[];
  note: PilotNoteSection | null;
  /** 교재 — 글에 없어 진도 띠 위에 한 줄로 붙인다(학원 설정 showTextbook을 호출부가 이미 반영). */
  textbook: string | null;
  /** 학습 추이·학습 추세·첨부 — 카드가 기존 재료로 그려 넘긴다(사랑의 한마디 앞). */
  middle: { title: string; body: ReactNode }[];
  footer: string | null;
};

export function PilotReportSheet({
  sections,
  note,
  textbook,
  middle,
  footer,
  ...head
}: PilotReportSheetProps) {
  const { tests, levels, rest } = splitSheetSections(sections);
  const hasProgress = rest.some((s) => isPilotTitle(s.title, "progress"));
  return (
    <article className="bg-card border-primary overflow-hidden border-2">
      <PilotSheetHead {...head} tests={tests} levels={levels} />
      {textbook && !hasProgress ? <TextbookRow textbook={textbook} /> : null}
      {rest.map((s, i) => (
        <SheetBand key={`${i}-${s.title}`} title={s.title}>
          {textbook && isPilotTitle(s.title, "progress") ? (
            <TextbookRow textbook={textbook} inBand />
          ) : null}
          {s.body ? <SectionBody s={s} /> : null}
        </SheetBand>
      ))}
      {middle.map((m) => (
        <SheetBand key={m.title} title={m.title}>
          {m.body}
        </SheetBand>
      ))}
      {note?.body ? (
        <SheetBand title={note.title}>
          <PilotNoteBox text={note.body} />
        </SheetBand>
      ) : null}
      {footer ? (
        <footer className="bg-primary-deep px-3 py-2.5 text-center text-xs font-medium text-white/85">
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
