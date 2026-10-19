"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { assignmentConflict, type AssignmentConflict } from "@/features/textbooks/math-assignment";
import { saveMathTextbookAssignment } from "@/features/textbooks/server/math-assignment-actions";
import { useMathTextbooks } from "./math-textbook-context";
import styles from "./learning-overview.module.css";
import local from "./math-textbook.module.css";

type Target = { studentId: string | null; studentName?: string };

/** 반 교재 줄 — 학생 표 위. 반 학생 전원의 기본 교재. */
export function ClassTextbookBar() {
  const ctx = useMathTextbooks();
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  return (
    <div className={local.bar}>
      <span className={local.label}>반 교재</span>
      <strong className={local.title}>{ctx.classBook?.title ?? <span className={local.none}>미배정</span>}</strong>
      <span className={local.hint}>학생에게 따로 배정한 교재가 반 교재보다 우선합니다.</span>
      {ctx.status !== "ok" ? (
        <span className={local.warn}>{ctx.status === "missing-table" ? "교재 배정 표 적용 전" : "배정을 불러오지 못했습니다"}</span>
      ) : ctx.canWrite ? (
        <button type="button" className={styles.button} onClick={() => setOpen(true)}>
          {ctx.classBook ? "반 교재 변경" : "반 교재 배정"}
        </button>
      ) : null}
      {open ? <AssignDialog target={{ studentId: null }} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** 학생 행의 교재 표시 — 학생 교재면 그대로, 반 교재를 받는 중이면 '(반)'을 붙인다. */
export function StudentTextbookChip({ studentId, studentName }: { studentId: string; studentName: string }) {
  const ctx = useMathTextbooks();
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  const now = ctx.now[studentId] ?? null;
  const editable = ctx.canWrite && ctx.status === "ok";
  // (반) = 반 교재를 받는 중 · (기록) = 배정은 없고 보고서 교재 칸에서 읽은 교재(배정하면 그쪽이 이긴다).
  const source = now?.source === "class" ? " (반)" : now?.source === "report" ? " (기록)" : "";
  const step = now?.position ? ` · ${now.position.lessonNo}/${now.position.total}차수` : now ? " · 차수 미확인" : "";
  const text = now ? `${now.book.title}${source}${step}` : "교재 미배정";
  const tip = now?.position ? `${now.position.date} 보고서 진도: ${now.position.unit}` : undefined;
  const book = now;
  // 🔴 이 칩은 클릭하면 학생 집중 보기로 가는 행(<tr onClick>) 안에 있다 — 창은 포털이지만 React 이벤트는
  //    트리를 따라 행까지 올라가므로(바깥 딤 클릭 포함) 여기서 한 번에 끊는다.
  return (
    <span onClick={(e) => e.stopPropagation()}>
      {editable ? (
        <button
          type="button"
          className={local.chip}
          data-empty={book ? undefined : true}
          title={tip ? `${tip} · 눌러서 교재 배정` : "이 학생의 교재 배정"}
          onClick={() => setOpen(true)}
        >
          {text}
        </button>
      ) : (
        <span className={local.chip} data-empty={book ? undefined : true} data-static title={tip}>
          {text}
        </span>
      )}
      {open ? <AssignDialog target={{ studentId, studentName }} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}

function conflictMessage(c: AssignmentConflict): string {
  return c.kind === "same-as-class"
    ? `반 교재로 같은 교재(${c.title})가 이미 배정돼 있습니다. 이 학생의 교재로 변경할까요?`
    : `이미 같은 교재(${c.title})가 배정돼 있습니다.`;
}

function AssignDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const ctx = useMathTextbooks()!;
  const router = useRouter();
  const own = target.studentId ? (ctx.byStudent[target.studentId] ?? null) : ctx.classBook;
  const [picked, setPicked] = useState(own?.textbookId ?? "");
  const [conflict, setConflict] = useState<AssignmentConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (textbookId: string | null, confirmed: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await saveMathTextbookAssignment({ classId: ctx.classId, studentId: target.studentId, textbookId, confirmed });
        if (r.ok) {
          router.refresh();
          onClose();
          return;
        }
        if ("conflict" in r) setConflict(r.conflict);
        else setError(r.error);
      } catch {
        setError("저장하지 못했습니다. 다시 시도해 주세요.");
      }
    });

  const submit = () => {
    if (!picked) {
      setError("교재를 골라 주세요.");
      return;
    }
    // 화면에서 먼저 묻는다 — 서버도 같은 함수로 다시 판정한다(confirmed 없이는 쓰지 않는다).
    const c = assignmentConflict({
      scope: target.studentId ? "student" : "class",
      textbookId: picked,
      classBook: ctx.classBook,
      studentBook: target.studentId ? own : null,
    });
    if (c) {
      setConflict(c);
      return;
    }
    send(picked, false);
  };

  const scopeLabel = target.studentId ? `${target.studentName ?? "학생"} 교재` : "반 교재";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <DialogTitle>{scopeLabel} 배정</DialogTitle>
        <DialogDescription>
          {target.studentId
            ? `지금: ${own?.title ?? (ctx.classBook ? `반 교재(${ctx.classBook.title})` : "미배정")}`
            : `지금: ${ctx.classBook?.title ?? "미배정"} · 반 학생 전원의 기본 교재가 됩니다.`}
        </DialogDescription>
        {ctx.choices.length === 0 ? (
          <p className={local.hint}>교재목록에 수학 교재가 없습니다. 교재목록 → 수학에서 먼저 등록해 주세요.</p>
        ) : (
          <SearchableSelect
            ariaLabel="배정할 교재"
            value={picked}
            options={ctx.choices.map((b) => ({ value: b.id, label: b.title }))}
            onValueChange={(v) => {
              setPicked(v);
              setConflict(null);
              setError(null);
            }}
            placeholder="교재 선택"
            searchPlaceholder="교재 이름 검색"
          />
        )}
        {conflict ? (
          <div role="alertdialog" aria-label="같은 교재 확인" className={local.confirm}>
            <p>{conflictMessage(conflict)}</p>
            <div className={local.actions}>
              {conflict.kind === "same-slot" ? (
                <button type="button" className={styles.button} onClick={() => setConflict(null)}>확인</button>
              ) : (
                <>
                  <button type="button" className={styles.button} disabled={pending} onClick={() => setConflict(null)}>취소</button>
                  <button type="button" className={styles.primaryButton} disabled={pending} onClick={() => send(picked, true)}>
                    {pending ? "저장 중…" : "변경"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <div className={local.actions}>
          {own ? (
            <button type="button" className={`${styles.button} ${local.release}`} disabled={pending} onClick={() => send(null, false)}>
              {target.studentId ? "학생 교재 해제(반 교재로)" : "반 교재 해제"}
            </button>
          ) : null}
          <button type="button" className={styles.button} disabled={pending} onClick={onClose}>취소</button>
          <button type="button" className={styles.primaryButton} disabled={pending || !!conflict || ctx.choices.length === 0} onClick={submit}>
            {pending && !conflict ? "저장 중…" : "저장"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
