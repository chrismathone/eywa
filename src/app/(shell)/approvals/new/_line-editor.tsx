"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  deleteLineTemplate,
  saveLineTemplate,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";
import { MAX_APPROVAL_STEPS, MAX_REFS } from "@/features/approvals/line";
import { stepRoleLabels } from "@/features/approvals/types";
import type { ApprovalLineTemplate, ApprovalPerson } from "@/features/approvals/server/queries";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary rounded-lg border px-3 py-1.5 text-[13px] outline-none transition";

/**
 * 결재선 편집기 — 하이웍스의 결재선 지정을 우리 디자인으로 옮긴 것.
 *   · 결재: **순서 있는** 칩 목록(↑↓로 순서 조정, 마지막이 '승인'·앞은 '검토')
 *   · 참조: 순서 없는 칩(결재하지 않고 열람만)
 *   · 자주 쓰는 결재선: 이름 붙여 저장(덮어쓰기) / 불러오기 / 삭제
 *
 * 선택된 결재선은 hidden input(JSON)으로 **기안 폼과 함께 제출**된다 — 서버가 같은 규칙(line.ts)으로
 * 다시 검증하므로 여기 상태는 미리보기일 뿐이다([[#77]]).
 * ⚠️ 후보가 파일럿 명단뿐이라 지금은 목록이 짧다 — 전사 개방 시 후보만 늘면 이 UI는 그대로다.
 */
export function LineEditor({
  drafterName,
  candidates,
  templates,
  initialApproverIds,
}: {
  drafterName: string;
  candidates: ApprovalPerson[];
  templates: ApprovalLineTemplate[];
  initialApproverIds: string[];
}) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const [approvers, setApprovers] = useState<string[]>(
    initialApproverIds.filter((id) => byId.has(id)),
  );
  const [refs, setRefs] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const [saveState, saveAction] = useActionState<ApprovalActionState, FormData>(
    saveLineTemplate,
    undefined,
  );
  const seen = useRef<ApprovalActionState>(undefined);
  useEffect(() => {
    if (!saveState || saveState === seen.current) return;
    seen.current = saveState;
    if (saveState.error) toast.error(saveState.error);
    else if (saveState.ok) toast.success(saveState.notice ?? "저장했습니다");
  }, [saveState]);

  const roles = stepRoleLabels(approvers.length);
  const addable = candidates.filter((c) => !approvers.includes(c.id));
  const refAddable = candidates.filter((c) => !refs.includes(c.id) && !approvers.includes(c.id));

  function move(i: number, dir: -1 | 1) {
    setApprovers((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // 후보 풀 밖 id(퇴사자 등)는 조용히 거른다 — 서버도 같은 검증을 한다.
    setApprovers(t.approverIds.filter((x) => byId.has(x)));
    setRefs(t.refIds.filter((x) => byId.has(x)));
    toast.info(`결재선 '${t.name}'을(를) 불러왔습니다`);
  }

  function removeTemplate(id: string) {
    const fd = new FormData();
    fd.append("templateId", id);
    setBusy(true);
    startTransition(async () => {
      const res = await deleteLineTemplate(undefined, fd);
      setBusy(false);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) toast.success(res.notice ?? "삭제했습니다");
    });
  }

  return (
    <div className="border-line bg-bg-soft/40 space-y-3 rounded-xl border px-4 py-3">
      {/* 기안 폼 제출에 실리는 값 — 서버(line.ts)가 다시 검증한다 */}
      <input type="hidden" name="approverIds" value={JSON.stringify(approvers)} />
      <input type="hidden" name="refIds" value={JSON.stringify(refs)} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro">결재선</p>
        {templates.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <SearchableSelect
              options={templates.map((t) => ({
                value: t.id,
                label: t.name,
                hint: `결재 ${t.approverIds.length}단계${t.refIds.length ? ` · 참조 ${t.refIds.length}` : ""}`,
              }))}
              value=""
              onValueChange={applyTemplate}
              placeholder="자주 쓰는 결재선"
              ariaLabel="자주 쓰는 결재선 불러오기"
              triggerClassName="border-line bg-card rounded-lg border px-2.5 py-1 text-[12px]"
            />
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => removeTemplate(t.id)}
                disabled={busy}
                className="text-text-faint hover:text-danger text-[11px]"
                title={`'${t.name}' 삭제`}
                aria-label={`저장된 결재선 ${t.name} 삭제`}
              >
                <EyIcon name="trash" size={12} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* 결재 순서 — 기안 → 1차 → 2차 … */}
      <ol className="flex flex-wrap items-center gap-2">
        <li className="border-line bg-card text-text-dim rounded-lg border px-2.5 py-1 text-xs">
          기안 <b className="text-foreground">{drafterName}</b>
        </li>
        {approvers.map((id, i) => {
          const person = byId.get(id);
          return (
            <li key={id} className="flex items-center gap-2">
              <span className="text-text-faint text-xs">→</span>
              <span className="border-line bg-card inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs">
                <span className="text-text-dim">
                  {i + 1}차 {roles[i]}
                </span>
                <b className="text-foreground">{person?.name ?? "(알 수 없음)"}</b>
                {person?.jobTitle ? <span className="text-text-faint">{person.jobTitle}</span> : null}
                <span className="ml-0.5 inline-flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    className="text-text-faint hover:text-foreground disabled:opacity-30"
                    aria-label={`${person?.name ?? ""} 순서 앞으로`}
                  >
                    <EyIcon name="chevronLeft" size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === approvers.length - 1}
                    className="text-text-faint hover:text-foreground disabled:opacity-30"
                    aria-label={`${person?.name ?? ""} 순서 뒤로`}
                  >
                    <EyIcon name="chevronRight" size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovers((l) => l.filter((x) => x !== id))}
                    className="text-text-faint hover:text-danger"
                    aria-label={`${person?.name ?? ""} 결재선에서 제거`}
                  >
                    <EyIcon name="close" size={12} />
                  </button>
                </span>
              </span>
            </li>
          );
        })}
        {addable.length > 0 && approvers.length < MAX_APPROVAL_STEPS ? (
          <li className="min-w-[150px]">
            <SearchableSelect
              options={addable.map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.jobTitle ?? undefined,
              }))}
              value=""
              onValueChange={(id) => id && setApprovers((l) => [...l, id])}
              placeholder="+ 결재자 추가"
              ariaLabel="결재자 추가"
              triggerClassName="border-line bg-card rounded-lg border border-dashed px-2.5 py-1 text-[12px]"
            />
          </li>
        ) : null}
      </ol>
      {approvers.length === 0 ? (
        <p className="text-danger text-xs">결재자를 1명 이상 지정하세요.</p>
      ) : null}

      {/* 참조 — 결재하지 않고 열람만. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="micro">참조</p>
        {refs.map((id) => {
          const person = byId.get(id);
          return (
            <span
              key={id}
              className="border-line bg-card inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
            >
              <span className="text-foreground">{person?.name ?? "(알 수 없음)"}</span>
              <button
                type="button"
                onClick={() => setRefs((l) => l.filter((x) => x !== id))}
                className="text-text-faint hover:text-danger"
                aria-label={`${person?.name ?? ""} 참조에서 제거`}
              >
                <EyIcon name="close" size={11} />
              </button>
            </span>
          );
        })}
        {refAddable.length > 0 && refs.length < MAX_REFS ? (
          <span className="min-w-[130px]">
            <SearchableSelect
              options={refAddable.map((c) => ({
                value: c.id,
                label: c.name,
                hint: c.jobTitle ?? undefined,
              }))}
              value=""
              onValueChange={(id) => id && setRefs((l) => [...l, id])}
              placeholder="+ 참조 추가"
              ariaLabel="참조자 추가"
              triggerClassName="border-line bg-card rounded-full border border-dashed px-2.5 py-0.5 text-[12px]"
            />
          </span>
        ) : refs.length === 0 ? (
          <span className="text-text-faint text-[11px]">없음 — 결재 없이 열람만 하는 사람입니다</span>
        ) : null}
      </div>

      {/* 자주 쓰는 결재선으로 저장 — 별도 폼(기안 폼과 분리: 저장이 상신을 유발하면 안 된다). */}
      <SaveTemplateRow
        approvers={approvers}
        refs={refs}
        name={templateName}
        onName={setTemplateName}
        action={saveAction}
      />
    </div>
  );
}

/**
 * 템플릿 저장 줄 — form 안에 form을 못 넣으므로(HTML) 버튼이 **직접 서버 액션을 디스패치**한다.
 * 이름이 비면 비활성.
 */
function SaveTemplateRow({
  approvers,
  refs,
  name,
  onName,
  action,
}: {
  approvers: string[];
  refs: string[];
  name: string;
  onName: (v: string) => void;
  action: (fd: FormData) => void;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="border-line flex flex-wrap items-center gap-2 border-t pt-2.5">
      <input
        value={name}
        onChange={(e) => onName(e.target.value)}
        maxLength={40}
        placeholder="결재선 이름 (예: 기본 결재선)"
        className={`${inputClass} w-[200px]`}
        aria-label="저장할 결재선 이름"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !name.trim() || approvers.length === 0}
        onClick={() => {
          const fd = new FormData();
          fd.append("name", name.trim());
          fd.append("approverIds", JSON.stringify(approvers));
          fd.append("refIds", JSON.stringify(refs));
          startTransition(() => action(fd));
        }}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        현재 결재선 저장
      </Button>
      <span className="text-text-faint text-[11px]">같은 이름이면 덮어씁니다 · 다음 기안에서 불러올 수 있습니다</span>
    </div>
  );
}
