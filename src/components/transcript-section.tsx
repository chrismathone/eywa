"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { breakIntoSentences } from "@/lib/text/split-sentences";

/** 화자 발화 — 구조적 최소 타입(meetings SpeakerUtterance·enrollment speaker_labels 둘 다 만족). */
export type TranscriptUtterance = { speaker: string; text: string };

const THRESHOLD = 60;

/**
 * 전사(원본 음성인식) — 보조자료라 **기본 접힘**(🎤 클릭해 펼침). ijw-calander 패리티:
 * 발화를 화자 단위로 끊어 "[역할/화자] 발언"으로 렌더 → 한 덩어리로 쏟아지지 않고 화자가 바뀔 때마다 줄이 나뉜다.
 * speakerRoles(화자→상담자/학부모/학생 등 AI 추론)가 있으면 역할 라벨, 없으면 "화자 A/B" 폴백.
 * 발화가 많으면 60개만 보이고 "+N개 더 보기"로 펼친다. 회의록·등록상담 공용(원래 meetings 전용 → 추출).
 */
export function TranscriptSection({
  utterances,
  speakerRoles,
  plainText,
  frameless = false,
}: {
  utterances: TranscriptUtterance[] | null;
  speakerRoles: Record<string, string> | null;
  plainText: string | null;
  /** 부모가 이미 카드(테두리 박스)일 때 true — 자체 테두리·라운드를 빼 이중 박스 방지(등록상담 녹음 행). */
  frameless?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const count = utterances?.length ?? 0;
  const hasSpeakers = count > 0;
  const rows = hasSpeakers ? (showAll ? utterances! : utterances!.slice(0, THRESHOLD)) : [];
  const rest = count - rows.length;

  return (
    <section
      className={
        frameless ? "overflow-hidden" : "border-line bg-card overflow-hidden rounded-2xl border"
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="bg-bg-soft hover:bg-bg-soft/60 flex w-full items-center justify-between gap-2 px-4 py-2.5 transition"
      >
        <h2 className="text-foreground flex items-center gap-2 text-sm font-bold">
          <EyIcon name="mic" size={15} />
          전사 내용
          {hasSpeakers ? (
            <span className="text-text-faint text-xs font-normal whitespace-nowrap">
              · {count}개 발화
            </span>
          ) : null}
        </h2>
        <ChevronDown
          className={`text-text-faint size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-line max-h-[420px] space-y-2.5 overflow-y-auto border-t p-4">
          {hasSpeakers ? (
            <>
              {rows.map((u, i) => {
                const role = speakerRoles?.[u.speaker];
                return (
                  <p key={i} className="text-sm leading-relaxed whitespace-pre-line">
                    <span className="text-primary font-bold whitespace-nowrap">
                      [{role ?? `화자 ${u.speaker}`}]
                    </span>{" "}
                    <span className="text-foreground">{breakIntoSentences(u.text)}</span>
                  </p>
                );
              })}
              {rest > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft w-full rounded-lg border py-2 text-xs transition"
                >
                  <span className="inline-flex items-center gap-1">
                    <EyIcon name="chevronDown" size={12} aria-hidden="true" />
                    {rest}개 발화 더 보기
                  </span>
                </button>
              ) : null}
            </>
          ) : (
            <p className="text-foreground text-sm leading-relaxed whitespace-pre-line">
              {plainText ? breakIntoSentences(plainText) : ""}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
