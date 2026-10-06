"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, Info, LayoutGrid, Loader2, Plus, UserMinus, UserPlus, X } from "@/components/icons/aywa-icon-compat";
import type { GridApplyState } from "@/features/timetable/import/math-grid/apply-plan";
import type { MathGridPreview } from "@/features/timetable/import/math-grid/build-preview";
import { effectiveDateLabel, isImmediate } from "@/features/timetable/import/effective-date";
import { kstToday } from "@/lib/date-kst";
import { sanitizeErrorText } from "@/lib/text/sanitize-error";

const LIST = "border-line divide-line divide-y rounded-sm border";

/**
 * 수학 시간표 **격자 탭**에서 읽은 변경 — 셋으로 갈라 보여 준다: 적용할 것 / 적용하지 않는 것(이유) / 읽지 못한 것.
 * '수강편집' 탭 미리보기와 따로 선다(저쪽은 숨은 탭의 반 이동, 이쪽은 눈에 보이는 격자에서 고친 것).
 */
export function MathGridPreviewSection({
  preview,
  when,
  applying,
  onApply,
  result,
}: {
  preview: MathGridPreview | null;
  /** "지금" 또는 "10월 13일부터" — 적용 버튼에 그대로 적는다. */
  when: string;
  applying: boolean;
  onApply: () => void;
  result: GridApplyState | null;
}) {
  // 미래 날짜로 적용했으면 '완료'가 아니라 예약이다 — 취소할 수 있다는 것까지 말한다.
  const scheduled = !!result?.effectiveDate && !isImmediate(result.effectiveDate, kstToday());
  return (
    <section className="border-line mt-4 space-y-3 rounded-lg border p-3 text-xs">
      <header>
        <h3 className="text-foreground flex items-center gap-1 font-bold">
          <LayoutGrid className="size-3" /> 시간표 탭에서 읽은 변경
        </h3>
        {preview ? (
          <p className="text-text-faint mt-0.5 break-keep">
            ‘{preview.tabName}’ 탭 · 반 칸 {preview.stats.classCells}개 · 학생 {preview.stats.students}줄을 읽었습니다.
          </p>
        ) : null}
      </header>

      {preview ? <Body preview={preview} /> : null}

      {preview && !result?.applied ? (
        <button
          type="button"
          onClick={onApply}
          disabled={preview.total === 0 || applying}
          className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition disabled:opacity-40"
        >
          {applying ? <Loader2 className="size-3 animate-spin" /> : null}
          {preview.total > 0 ? `시간표 탭 변경 ${preview.total}건 ${when} 적용` : "적용할 변경 없음"}
        </button>
      ) : null}

      {result?.error ? <p className="text-chart-4 break-keep">{sanitizeErrorText(result.error)}</p> : null}
      {result?.applied ? (
        <p className="text-primary break-keep">
          {scheduled ? `${effectiveDateLabel(result.effectiveDate!)}부터 적용되도록 예약했습니다` : "적용 완료"} — 새 반{" "}
          {result.applied.classes} · 이동 {result.applied.moved} · 추가 {result.applied.added} · 수강 종료 {result.applied.removed}
          {result.heldAdds ? <span className="text-amber"> · 휴원 상태로 추가 {result.heldAdds}</span> : null}
          {result.failed ? <span className="text-amber"> · 실패 {result.failed}</span> : null}
          {scheduled ? (
            <span className="text-text-dim"> · 시간표 위 ‘적용 예정’ 표시의 ×로 취소하면 만든 반까지 되돌아갑니다.</span>
          ) : null}
        </p>
      ) : null}

      <p className="text-text-faint break-keep">
        시트로 바꾸는 것: 새 반 만들기(강사·요일·교시·강의실)와 학생의 반 이동·추가·빠짐. 이미 있는 반의 시간·강사·강의실,
        반 이름, 휴원 전환은 읽어서 알려 주기만 하고, 강사별 탭에서 고친 것은 읽지 않습니다.
      </p>
    </section>
  );
}

function Body({ preview }: { preview: MathGridPreview }) {
  const nothing = preview.total === 0 && preview.skipped.length === 0;
  return (
    <div className="space-y-3">
      {nothing ? (
        <p className="text-text-faint break-keep">
          {preview.warnings.length > 0
            ? "읽은 범위에서는 달라진 것이 없습니다 — 아래 ‘읽지 못한 것’을 확인하세요."
            : "시간표 탭에서 달라진 것이 없습니다."}
        </p>
      ) : null}

      {preview.classes.length > 0 ? (
        <div>
          <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
            <Plus className="size-3" /> 만들 반 {preview.classes.length}개
          </h4>
          <div className="space-y-1.5">
            {preview.classes.map((c) => (
              <div key={c.name} className="border-line rounded-sm border px-2 py-1.5">
                <p className="text-foreground font-bold">{c.name}</p>
                <p className="text-text-dim break-keep">
                  {c.teacher} · {c.when.join(", ")} · {c.room || <span className="text-amber">강의실 없음</span>}
                </p>
                <p className="text-text-dim mt-0.5 break-keep">
                  학생 {c.students.length}명{c.students.length > 0 ? ` — ${c.students.join(", ")}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview.moves.length > 0 ? (
        <div>
          <h4 className="text-primary mb-1 flex items-center gap-1 font-bold">
            <ArrowRight className="size-3" /> 이동 {preview.moves.length}건
          </h4>
          <div className={LIST}>
            {preview.moves.map((m, i) => (
              <p key={i} className="text-text-dim px-2 py-1">
                <b className="text-foreground">{m.student}</b> {m.from} <span className="text-text-faint">→</span>{" "}
                <span className="text-primary">{m.to}</span>
                {m.toNew ? <span className="text-blue"> (새 반)</span> : null}
                {m.days ? <span className="text-amber"> · {m.days}</span> : null}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {preview.adds.length > 0 ? (
        <div>
          <h4 className="text-blue mb-1 flex items-center gap-1 font-bold">
            <UserPlus className="size-3" /> 추가 {preview.adds.length}건
          </h4>
          <div className={LIST}>
            {preview.adds.map((a, i) => (
              <p key={i} className="text-text-dim px-2 py-1">
                <b className="text-foreground">{a.student}</b> <span className="text-text-faint">→</span>{" "}
                <span className="text-blue">{a.to}</span>
                {a.toNew ? <span className="text-blue"> (새 반)</span> : null}
                {a.days ? <span className="text-amber"> · {a.days}</span> : null}
                {a.held ? <span className="text-amber"> · 휴원 상태로 추가</span> : null}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {preview.removes.length > 0 ? (
        <div>
          <h4 className="text-amber mb-1 flex items-center gap-1 font-bold">
            <UserMinus className="size-3" /> 수강 종료 {preview.removes.length}건
          </h4>
          <div className={LIST}>
            {preview.removes.map((r, i) => (
              <p key={i} className="text-text-dim px-2 py-1">
                <b className="text-foreground">{r.student}</b> {r.from} <span className="text-amber">종료</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <Notice tone="bg-amber-soft text-amber" icon={<X className="size-3" />} title="적용하지 않는 것" count={preview.skipped.length}>
        {preview.skipped.map((s, i) => (
          <p key={i} className="break-keep">
            · <b>{s.what}</b> — {s.why}
          </p>
        ))}
      </Notice>
      <Notice tone="bg-amber-soft text-amber" icon={<AlertTriangle className="size-3" />} title="읽지 못한 것" count={preview.warnings.length}>
        {preview.warnings.map((w, i) => (
          <p key={i} className="break-keep">· {w}</p>
        ))}
      </Notice>
      <Notice tone="bg-bg-soft text-text-dim" icon={<Info className="size-3" />} title="참고" count={preview.notes.length}>
        {preview.notes.map((n, i) => (
          <p key={i} className="break-keep">· {n}</p>
        ))}
      </Notice>
    </div>
  );
}

/** 알림 상자 — 건수가 0이면 그리지 않는다. */
function Notice({ tone, icon, title, count, children }: { tone: string; icon: ReactNode; title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className={`${tone} rounded-sm p-2`}>
      <p className="mb-1 flex items-center gap-1 font-bold">
        {icon} {title} {count}건
      </p>
      {children}
    </div>
  );
}
