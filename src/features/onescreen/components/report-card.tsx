import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { subjectTone, toneSoftClass } from "../data";
import { DeltaChip } from "./delta-chip";
import type { OneScreenStudent, Subject, TestScore } from "../types";

// shareToken: 저장 시 발급되는 학부모 공개 링크(/r/[token]) 토큰. 세션 내 저장 후에만 존재.
export type SubjectReport = { draft: string; sent: boolean; shareToken?: string };

function fmt(t: TestScore) {
  return t.score == null ? "미입력" : `${t.score}/${t.max}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-text-faint shrink-0 text-[12px]">{label}</span>
      <span className="text-foreground flex flex-wrap items-center justify-end gap-1.5 text-[12px] font-semibold">
        {children}
      </span>
    </div>
  );
}

/** 선택 과목 1개 기준 요약 — 오늘 진도는 그 과목만, 테스트·태도는 그날 공통. */
function MiniSummary({ st, subject }: { st: OneScreenStudent; subject: Subject }) {
  const { daily, check } = st.tests;
  const { key, tone } = subjectTone(subject.name);
  return (
    <div className="border-line rounded-md border px-3 py-2">
      <Row label="오늘 진도">
        <span className={`rounded-pill px-1.5 py-px text-[11px] font-semibold ${toneSoftClass(tone)}`}>
          {key} · {subject.today}
        </span>
      </Row>
      <Row label="일일테스트">
        <span className="tabular">{fmt(daily)}</span>
        <DeltaChip score={daily.score} prev={daily.prevScore} />
      </Row>
      <Row label="확인테스트">
        <span className="tabular">{fmt(check)}</span>
        <DeltaChip score={check.score} prev={check.prevScore} />
      </Row>
      <Row label="태도 · 과제">{(st.attitude ?? "—") + " · " + (st.homework || "—")}</Row>
    </div>
  );
}

/**
 * today 보고서 카드 — **과목별로 따로** 작성·발송.
 * 과목 칩으로 전환하면 그 과목 진도만 담긴 초안을 만들고 개별 발송한다.
 * (드래프트·발송 상태는 과목별로 분리 — 부모는 reports[과목명] 맵으로 전달.)
 */
export function ReportCard({
  student,
  reports,
  attitudes,
  homeworks,
  onAttitude,
  onHomework,
  onSubjectDraft,
  onAutoWrite,
  onSend,
}: {
  student: OneScreenStudent;
  reports: Record<string, SubjectReport>;
  attitudes: readonly string[];
  homeworks: readonly string[];
  onAttitude: (a: string) => void;
  onHomework: (h: string) => void;
  onSubjectDraft: (subjectName: string, text: string) => void;
  onAutoWrite: (subjectName: string) => void;
  onSend: (subjectName: string, channel: string) => void;
}) {
  const [selIdx, setSelIdx] = useState(0);
  const idx = Math.min(selIdx, student.subjects.length - 1);
  const subject = student.subjects[idx];
  if (!subject) return null;
  const subjectName = subject.name;
  const rep = reports[subjectName] ?? { draft: "", sent: false };
  // 학부모 공개 링크 — 저장 후(shareToken 존재) 노출. 강사가 복사해 카톡/문자로 전달.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = rep.shareToken ? `${origin}/r/${rep.shareToken}` : "";

  return (
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border">
      <header className="border-line border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="micro text-text-faint">
              {student.subjects.length > 1 ? "today 보고서 · 과목별" : "today 보고서"}
            </p>
            <p className="text-foreground text-[15px] font-bold">{student.name} · 학부모 보고</p>
          </div>
          {/* 실발송이 아니라 lesson_reports 기록 저장(PDF만 실제 인쇄). "발송 완료" 거짓 약속 방지. */}
          {rep.sent ? <Pill color="primary">기록 저장</Pill> : null}
        </div>
        {/* 과목 선택 (여러 과목일 때만) — 발송한 과목엔 체크 */}
        {student.subjects.length > 1 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {student.subjects.map((su, i) => {
            const on = i === idx;
            const sent = reports[su.name]?.sent;
            return (
              <button
                key={su.name}
                type="button"
                onClick={() => setSelIdx(i)}
                aria-pressed={on}
                className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                  on
                    ? "bg-primary text-primary-foreground"
                    : "border-line text-text-dim hover:bg-bg-soft border"
                }`}
              >
                {su.name}
                {sent ? <EyIcon name="check" size={11} /> : null}
              </button>
            );
            })}
          </div>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <MiniSummary st={student} subject={subject} />

        <div>
          <p className="micro text-text-faint mb-1.5">수업 태도</p>
          <div className="flex flex-wrap gap-1.5">
            {attitudes.map((a) => {
              const on = student.attitude === a;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onAttitude(a)}
                  aria-pressed={on}
                  className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border-line text-text-dim hover:bg-bg-soft border"
                  }`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="micro text-text-faint mb-1.5">과제</p>
          <div className="flex flex-wrap gap-1.5">
            {homeworks.map((h) => {
              const on = student.homework === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => onHomework(h)}
                  aria-pressed={on}
                  className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold transition ${
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border-line text-text-dim hover:bg-bg-soft border"
                  }`}
                >
                  {h}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="micro text-text-faint">{subjectName} 보고서</p>
            <Button variant="ghost" size="sm" onClick={() => onAutoWrite(subjectName)}>
              <EyIcon name="sparkle" size={13} /> 자동 작성
            </Button>
          </div>
          <textarea
            value={rep.draft}
            onChange={(e) => onSubjectDraft(subjectName, e.target.value)}
            placeholder={`'자동 작성'을 누르면 ${subjectName} 진도·테스트·태도로 초안을 만들어 줍니다. 그대로 보내거나 수정하세요.`}
            className="border-line focus:border-primary scrollbar-thin min-h-[110px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            title="저장하면 아래에 학부모 공유 링크가 생성됩니다 — 카톡/문자에 붙여 보내세요"
            onClick={() => onSend(subjectName, "카카오톡")}
          >
            카톡용 저장
          </Button>
          <Button
            variant="outline"
            size="sm"
            title="저장하면 아래에 학부모 공유 링크가 생성됩니다 — 카톡/문자에 붙여 보내세요"
            onClick={() => onSend(subjectName, "문자")}
          >
            문자용 저장
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSend(subjectName, "pdf")}>
            PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSend(subjectName, "save")}>
            저장
          </Button>
        </div>

        {/* 저장 후 발급된 학부모 공개 링크 — 강사가 복사해 카톡/문자로 직접 전달(발송 시스템 P0). */}
        {rep.sent && shareUrl ? (
          <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
            <p className="text-text-faint mb-1 text-[11px] font-semibold">학부모 공유 링크</p>
            <div className="flex items-center gap-2">
              <code className="text-text-dim min-w-0 flex-1 truncate text-[11px]">{shareUrl}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl);
                  toast.success("학부모 공유 링크를 복사했습니다");
                }}
              >
                복사
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
