import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Pill } from "@/components/atoms/pill";
import { subjectTone, toneSoftClass } from "../data";
import { DeltaChip } from "./delta-chip";
import type { OneScreenStudent, TestScore } from "../types";

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

function MiniSummary({ st }: { st: OneScreenStudent }) {
  const { daily, check } = st.tests;
  return (
    <div className="border-line rounded-md border px-3 py-2">
      <Row label="오늘 진도">
        {st.subjects.map((s, i) => {
          const { key, tone } = subjectTone(s.name);
          return (
            <span
              key={i}
              className={`rounded-pill px-1.5 py-px text-[11px] font-semibold ${toneSoftClass(tone)}`}
            >
              {key} · {s.today}
            </span>
          );
        })}
      </Row>
      <Row label="일일테스트">
        <span className="tabular">{fmt(daily)}</span>
        <DeltaChip score={daily.score} prev={daily.prevScore} />
      </Row>
      <Row label="확인테스트">
        <span className="tabular">{fmt(check)}</span>
        <DeltaChip score={check.score} prev={check.prevScore} />
      </Row>
      <Row label="태도 · 과제">
        {(st.attitude ?? "—") + " · " + st.homework}
      </Row>
    </div>
  );
}

/** today 보고서 카드 — 요약 + 태도 칩 + 자동작성 + 발송(목업) */
export function ReportCard({
  student,
  attitudes,
  onAttitude,
  onDraft,
  onAutoWrite,
  onSend,
}: {
  student: OneScreenStudent;
  attitudes: readonly string[];
  onAttitude: (a: string) => void;
  onDraft: (text: string) => void;
  onAutoWrite: () => void;
  onSend: (channel: string) => void;
}) {
  return (
    <div className="bg-card border-line shadow-card flex flex-col rounded-md border">
      <header className="border-line flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="micro text-text-faint">today 보고서</p>
          <p className="text-foreground text-[15px] font-bold">{student.name} · 학부모 보고</p>
        </div>
        {student.reportSent ? <Pill color="primary">발송 완료</Pill> : null}
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3">
        <MiniSummary st={student} />

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

        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="micro text-text-faint">보고서 내용</p>
            <Button variant="ghost" size="sm" onClick={onAutoWrite}>
              <EyIcon name="sparkle" size={13} /> 자동 작성
            </Button>
          </div>
          <textarea
            value={student.reportDraft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="'자동 작성'을 누르면 오늘 진도·테스트·태도를 합쳐 초안을 만들어 줍니다. 그대로 보내거나 수정하세요."
            className="border-line focus:border-primary scrollbar-thin min-h-[120px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-[13px] leading-relaxed outline-none"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => onSend("카카오톡")}>
            카톡 발송
          </Button>
          <Button variant="outline" size="sm" onClick={() => onSend("문자")}>
            문자
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSend("pdf")}>
            PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onSend("save")}>
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
