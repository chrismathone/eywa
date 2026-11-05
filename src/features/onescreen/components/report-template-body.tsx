import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { JjExamSheet } from "@/features/ijw/components/jj-exam-sheet";
import { JjStudySheet } from "@/features/ijw/components/jj-study-sheet";
import { JjBadgeCard, JjStandingCard } from "@/features/ijw/components/jj-standing";
import { slotAvailability, type JjReportSnapshot } from "@/features/ijw/snapshot";
import { splitImageSlots } from "@/features/report-templates/image-slots";
import { isImageAttachment } from "../attachment-utils";
import { isVocabkingDeck } from "@/features/vocabking/deck";
import { buildVocabkingReport } from "@/features/vocabking/model";
import { VocabkingReportView } from "@/features/vocabking/components/vocabking-report";
import { MonthlyEvalBlock } from "./monthly-report-sheet";

/**
 * 학부모 카드의 **템플릿 모드 본문**(영어) — ParentReportCard에서 떼어 냈다(2026-09-11, 첨부 자리를 더하며).
 * 서버(/r·인쇄)와 클라이언트(원스크린 미리보기)가 함께 그리는 순수 프레젠테이션 — 훅·"use client"·서버 전용 모듈 금지.
 *
 * 강사가 템플릿으로 조립한 글(`notes`)이 **보고서 본문 그 자체**다 — 진도·숙제·테스트·코멘트가 이미 섹션 머리말(📍·📅·💡·💌)과
 * 함께 글 안에 들어 있다. 그래서 제목 줄을 달지 않는다(글이 "안녕하세요 학부모님"으로 스스로 시작한다). 글씨는 수학
 * '학부모 전달 내용'(16px)보다 한 단계 크게 — 워커가 800px·2배로 `.report-capture`를 캡처하고 학부모는 그 이미지를 폰으로 읽는다.
 *
 * 🔑 **그림 자리**(image-slots.ts): 글 안의 `[시험결과지]`·`[학습분석지]` **한 줄**이 그 자리에 인재원 그림을 세운다. 재료는
 *    저장할 때 서버가 받아 둔 동결본(`jj`, 0261a)이라 /r·인쇄·ClassNote 캡처가 같은 그림을 같은 자리에 싣는다.
 * 🔑 **첨부 자리**: `[첨부: 이름]` 한 줄이 그 이름의 첨부를 그 자리에 세운다 — 사진은 카드 폭 가득, PDF는 받기 칸. 어떤 첨부가
 *    어디 서는지는 호스트가 정해 넘긴다(`inline`, attachment-utils.ts `pickInlineAttachments`) — 아래 '첨부' 칸이 같은 목록으로
 *    그 첨부를 빼기 때문이다. 워커 캡처에선 PDF가 목록에 없어 저절로 빠진다(게시글에 파일로 따로 붙는다).
 * 🔴 그릴 게 없으면(동결본 없음·그날 시험 없음·못 찾은 첨부) **아무것도 안 그린다** — 대괄호 글자를 학부모에게 내보내지 않는다.
 * 🔴 자리 줄이 없는 글은 예전과 **글자 하나 다르지 않다**(한 칸 그대로). 같은 자리가 두 번이면 처음 한 번만 그린다.
 */

/** 보고 글이 비었을 때 문구 — 수학 '학부모 전달 내용'과 영어 템플릿 본문이 같은 문구를 쓴다(강사가 빈 발송을 눈으로 안다). */
export const EMPTY_NOTES = "작성된 보고 내용이 없습니다.";

/** 카드에 실을 첨부 — 호스트가 이미 주소(signed URL)를 풀어 둔 것만. */
export type CardAttachment = { path: string; name: string; url: string };

export function TemplateBody({
  text,
  jj,
  inline,
  student,
}: {
  text: string | null;
  jj?: JjReportSnapshot | null;
  inline: ReadonlyMap<string, CardAttachment>;
  /** 카드 머리의 학생(이름·학년) — 보카킹 리포트 머리글과 학년 표기에 쓴다. 없으면 인재원 이름만. */
  student?: { name: string | null; grade: string | null } | null;
}) {
  const body = (text ?? "").replace(/\r\n?/g, "\n").trim();
  const segments = splitImageSlots(body);
  if (segments.every((s) => s.kind === "text")) return <TemplateText text={body || EMPTY_NOTES} />;
  const avail = slotAvailability(jj);
  const drawn = new Set<string>();
  const blocks = segments.flatMap((seg, i): ReactNode[] => {
    if (seg.kind === "text") return [<TemplateText key={`t${i}`} text={seg.text.trim()} />];
    // EiE 월간 점수 자리(2026-11-05) — 글에 동결된 점수로 그래프 + 표를 그린다(월간 카드가 아닌 글에 들어가도 같은 그림).
    if (seg.kind === "monthly") {
      if (drawn.has("monthly")) return [];
      drawn.add("monthly");
      return [<MonthlyEvalBlock key={`m${i}`} evaluation={seg.eval} />];
    }
    const once = seg.kind === "slot" ? `slot:${seg.key}` : `att:${seg.name}`;
    if (drawn.has(once)) return [];
    drawn.add(once);
    if (seg.kind === "attachment") {
      const att = inline.get(seg.name);
      return att ? [<InlineAttachment key={`a${i}`} att={att} />] : [];
    }
    if (seg.key === "시험결과지") {
      // 보카킹 시험이면 **종합평가 리포트**(원장 2026-10-07), 그 밖의 단어 시험은 종전 결과지. 재료는 같은 동결본이다 —
      // 같은 시험 응시자 결과(학년 평균·응시자 평균 시간)는 동결본에 없어 카드에선 그 칸만 빠진다(JJ실 창에선 보인다).
      return avail.시험결과지 && jj
        ? jj.exams.map((exam, j) =>
            isVocabkingDeck(exam.deck.name) ? (
              <VocabkingReportView
                key={`v${i}-${j}`}
                report={buildVocabkingReport({
                  exam,
                  study: jj.study ?? null,
                  student: { name: student?.name || exam.student.name || exam.student.id, grade: student?.grade ?? null },
                  peers: null,
                })}
              />
            ) : (
              <JjExamSheet key={`e${i}-${j}`} exam={exam} layout="card" />
            ),
          )
        : [];
    }
    // 단어 순위·학습 배지(2026-10-26) — 인재원 선택 필드. 없으면(옛 저장본·인재원 미배포) 그 자리만 빈다.
    if (seg.key === "단어백분위") {
      return avail.단어백분위 && jj?.standing ? [<JjStandingCard key={`r${i}`} standing={jj.standing} />] : [];
    }
    if (seg.key === "학습배지") {
      return avail.학습배지 && jj?.standing?.badge ? [<JjBadgeCard key={`g${i}`} badge={jj.standing.badge} />] : [];
    }
    return avail.학습분석지 && jj?.study ? [<JjStudySheet key={`s${i}`} study={jj.study} layout="card" />] : [];
  });
  return blocks.length ? <>{blocks}</> : <TemplateText text={EMPTY_NOTES} />;
}

/** 템플릿 글 한 칸(자리 사이의 글 조각도 같은 칸) — 자리가 생기기 전 본문과 같은 모양. */
function TemplateText({ text }: { text: string }) {
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <p className="text-foreground text-xl leading-relaxed break-keep whitespace-pre-wrap">{text}</p>
    </section>
  );
}

/** 글 속 첨부 — 사진은 카드 폭 가득(스샷 한 장에 세로로 이어지게), 그 밖(PDF)은 받기 칸. */
function InlineAttachment({ att }: { att: CardAttachment }) {
  if (isImageAttachment(att.name || att.path)) {
    // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 첨부(signed URL, 최적화 불필요)
    return <img src={att.url} alt={att.name} className="bg-card shadow-card w-full rounded-2xl object-contain" />;
  }
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border px-5 py-4">
      <FileLink att={att} />
    </section>
  );
}

/** 파일 받기 칸 — 글 속 PDF와 아래 '첨부' 칸이 같은 모양을 쓴다(스샷 안에선 눌리지 않아 워커 캡처는 파일을 뺀다). */
export function FileLink({ att }: { att: CardAttachment }) {
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noreferrer"
      download={att.name}
      className="border-line bg-bg-soft hover:bg-line/30 flex items-center gap-2 rounded-md border px-3 py-2.5 no-underline"
    >
      <EyIcon name="fileDownload" size={20} className="text-primary shrink-0" />
      <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">{att.name}</span>
      <span className="text-text-faint shrink-0 text-xs">받기</span>
    </a>
  );
}
