"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveTextbookLessons, type LessonPatch } from "@/features/textbooks/server/actions";
import type { TextbookLessonRow } from "@/features/textbooks/types";
import { FIELD, FormError, useRun } from "./form-bits";

/**
 * 차수 표 — 1..N 전부가 행으로 선다(원장 2026-09-16 *"차수가 10차수 면 차수마다 진도 과제 10차수 모두
 * 작성할수있어야함"*).
 *
 * 🔑 **바뀐 칸만 보낸다** — 200행을 통째로 upsert하면 안 건드린 행의 `updated_at`·`updated_by`까지 흔들려
 *    "누가 뭘 고쳤는지"가 사라진다.
 * 🔑 진도·과제가 **둘 다 비면 그 차수 행은 지워진다**(서버 규약) — 빈 행이 쌓이면 "작성한 차수" 수가 거짓이 되고,
 *    기입 때 아무것도 안 들어가는 칸이 대상으로 잡힌다.
 * ⚠️ 차수 수를 줄인 뒤에도 남아 있는 옛 행은 **감추지 않고** 뒤에 회색으로 붙는다(쓴 게 조용히 사라지지 않게).
 */
export function LessonsEditor({
  textbookId,
  lessons,
  sessionCount,
  canWrite,
  onSaved,
}: {
  textbookId: string;
  lessons: TextbookLessonRow[];
  /** 지금 정해진 차수 수 — 이보다 뒤의 행은 "차수를 줄인 뒤 남은 옛 기록"이다. */
  sessionCount: number;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const { busy, error, run } = useRun();
  const initial = useMemo(() => {
    const m = new Map<number, { progress: string; homework: string }>();
    for (const l of lessons) m.set(l.lessonNo, { progress: l.progress ?? "", homework: l.homework ?? "" });
    return m;
  }, [lessons]);
  const [draft, setDraft] = useState<Map<number, { progress: string; homework: string }>>(() => new Map(initial));


  function set(no: number, field: "progress" | "homework", value: string) {
    setDraft((prev) => {
      const next = new Map(prev);
      const cur = next.get(no) ?? { progress: "", homework: "" };
      next.set(no, { ...cur, [field]: value });
      return next;
    });
  }

  const changed: LessonPatch[] = [];
  for (const [no, v] of draft) {
    const base = initial.get(no) ?? { progress: "", homework: "" };
    if (base.progress === v.progress && base.homework === v.homework) continue;
    changed.push({ lessonNo: no, progress: v.progress || null, homework: v.homework || null });
  }

  if (lessons.length === 0) {
    return (
      <p className="text-text-dim border-line-faint rounded-lg border px-3 py-6 text-center text-xs">
        차수가 0입니다 — 위에서 차수를 정하고 저장하면 차수별 진도·과제 표가 열립니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold">차수별 진도·과제</h3>
        <span className="text-text-faint text-xs">
          비워 두면 그 차수는 시트에 기입되지 않습니다.
        </span>
        {canWrite ? (
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            disabled={busy || changed.length === 0}
            onClick={() => {
              void run(() => saveTextbookLessons(textbookId, changed)).then((r) => {
                if (r) onSaved();
              });
            }}
          >
            {busy ? "저장 중…" : changed.length > 0 ? `차수 저장 (${changed.length})` : "차수 저장"}
          </Button>
        ) : null}
      </div>
      <FormError error={error} />
      <div className="border-line-faint max-h-[46vh] overflow-y-auto rounded-lg border px-1">
        <table className="w-full border-collapse text-xs">
          <colgroup>
            <col style={{ width: 52 }} />
            <col />
            <col />
          </colgroup>
          <thead className="bg-background sticky top-0 z-10">
            <tr className="text-text-dim text-xs">
              <th className="py-1.5 text-center font-bold">차수</th>
              <th className="py-1.5 text-left font-bold">진도</th>
              <th className="py-1.5 text-left font-bold">과제</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => {
              const v = draft.get(l.lessonNo) ?? { progress: "", homework: "" };
              const extra = l.lessonNo > sessionCount;
              return (
                <tr key={l.lessonNo} className={extra ? "bg-bg-soft/60" : undefined}>
                  <td className="num py-0.5 text-center font-bold" title={extra ? "차수 수 밖의 옛 기록입니다 — 비우면 지워집니다" : undefined}>
                    {l.lessonNo}
                  </td>
                  <td className="py-0.5 pr-1">
                    <input
                      value={v.progress}
                      onChange={(e) => set(l.lessonNo, "progress", e.target.value)}
                      disabled={!canWrite}
                      maxLength={500}
                      aria-label={`${l.lessonNo}차수 진도`}
                      className={FIELD}
                    />
                  </td>
                  <td className="py-0.5">
                    <input
                      value={v.homework}
                      onChange={(e) => set(l.lessonNo, "homework", e.target.value)}
                      disabled={!canWrite}
                      maxLength={500}
                      aria-label={`${l.lessonNo}차수 과제`}
                      className={FIELD}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
