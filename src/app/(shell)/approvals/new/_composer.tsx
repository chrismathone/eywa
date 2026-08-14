"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  deleteLineTemplate,
  saveLineTemplate,
  submitLeaveDraft,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";
import { MAX_APPROVAL_STEPS, MAX_REFS } from "@/features/approvals/line";
import { APPROVAL_FORM_LABEL, stepRoleLabels } from "@/features/approvals/types";
import type { ApprovalLineTemplate, ApprovalPerson } from "@/features/approvals/server/queries";
import {
  countLeaveDays,
  formatLeaveDays,
  validateLeaveRange,
  type LeaveKind,
} from "@/features/leave/request-days";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

const KIND_OPTIONS = [
  { value: "annual", label: "연차", hint: "하루 단위" },
  { value: "half", label: "반차", hint: "0.5일 · 하루만" },
];

/**
 * 결재 문서 작성 — **하이웍스 '결재 문서 작성' 화면 구조 그대로**(원장 스크린샷 대조, 2026-08-14):
 *   ① 기본 설정(문서 종류 선택·작성자) → ② **결재선 표**(결재 행 = 결재자 열 나열 + 참조 행)
 *   → ③ 상세 입력(양식 필드) → 하단 상신.
 *
 * 문서 종류가 화면 **안**에 있다 — 기안하기를 누르면 양식이 정해진 폼이 아니라 이 작성 화면으로
 * 온다(하이웍스 흐름). 지금 양식은 휴가신청서 하나라 선택지가 하나지만, 양식이 늘면 여기 드롭다운에
 * 붙고 ③만 갈린다.
 *
 * ⚠️ 잔여·결재선 검증의 근거는 서버(line.ts·submitLeaveDraft)다 — 화면은 미리보기·조기경고([[#77]]).
 * ⚠️ 임시저장·인쇄미리보기·보존연한·보안등급은 범위 밖(하이웍스에 있지만 우리 데이터 개념이 없다 —
 *    흉내만 낸 죽은 컨트롤을 두지 않는다).
 */
export function DraftComposer({
  drafterName,
  drafterJobTitle,
  candidates,
  templates,
  initialApproverIds,
  periodEnd,
  remaining,
  today,
}: {
  drafterName: string;
  drafterJobTitle: string | null;
  candidates: ApprovalPerson[];
  templates: ApprovalLineTemplate[];
  initialApproverIds: string[];
  periodEnd: string;
  remaining: number;
  today: string;
}) {
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // ── 결재선 상태 ──────────────────────────────────────────────────────────
  const [approvers, setApprovers] = useState<string[]>(
    initialApproverIds.filter((id) => byId.has(id)),
  );
  const [refs, setRefs] = useState<string[]>([]);

  // ── 양식(휴가신청서) 상태 ────────────────────────────────────────────────
  const [kind, setKind] = useState<LeaveKind>("annual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);

  const [state, action] = useActionState<ApprovalActionState, FormData>(submitLeaveDraft, undefined);
  const seen = useRef<ApprovalActionState>(undefined);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "상신했습니다");
  }, [state]);

  const effectiveEnd = kind === "half" ? start : end;
  const days = countLeaveDays(start, effectiveEnd, kind);
  // 시작일이 현재 연차 구간을 지나면 서버가 다음 구간으로 판정한다 — 현재 구간 잣대를 접는다.
  const inCurrentPeriod = !!start && start <= periodEnd;
  const invalid = validateLeaveRange({
    start,
    end: effectiveEnd,
    kind,
    periodEnd: inCurrentPeriod ? periodEnd : null,
  });
  const over =
    inCurrentPeriod && !invalid && days > remaining
      ? remaining <= 0
        ? "남은 연차가 없어 상신할 수 없습니다"
        : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다`
      : null;
  const blocked = !!invalid || !!over || approvers.length === 0;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="approverIds" value={JSON.stringify(approvers)} />
      <input type="hidden" name="refIds" value={JSON.stringify(refs)} />

      {/* ① 기본 설정 — 하이웍스 상단 격자 대응 */}
      <section className="border-line bg-card shadow-card rounded-2xl border p-5">
        <h2 className="text-foreground text-sm font-bold">기본 설정</h2>
        <div className="border-line mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap">
              <tr>
                <th className="w-[100px]">문서 종류</th>
                <td className="w-[220px]">
                  {/* 양식이 하나라 선택지도 하나 — 자리는 하이웍스 구조 그대로(양식이 늘면 여기만 커진다). */}
                  <SearchableSelect
                    options={[{ value: "leave", label: APPROVAL_FORM_LABEL.leave, hint: "공통" }]}
                    value="leave"
                    ariaLabel="문서 종류"
                    triggerClassName="border-0 px-1 py-1 text-sm"
                  />
                </td>
                <th className="w-[100px]">작성자</th>
                <td>
                  <span className="text-foreground text-[13px] font-medium">{drafterName}</span>
                  {drafterJobTitle ? (
                    <span className="text-text-faint ml-1 text-xs">{drafterJobTitle}</span>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th>문서 번호</th>
                <td className="text-text-faint text-xs">상신하면 자동으로 부여됩니다</td>
                <th>기안 일시</th>
                <td className="num text-text-dim text-xs">{today}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ② 결재선 — 하이웍스 결재선 표(결재 행 + 참조 행) */}
      <section className="border-line bg-card shadow-card rounded-2xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-foreground text-sm font-bold">결재선</h2>
          <TemplateControls
            templates={templates}
            approvers={approvers}
            refs={refs}
            onApply={(t) => {
              setApprovers(t.approverIds.filter((x) => byId.has(x)));
              setRefs(t.refIds.filter((x) => byId.has(x)));
              toast.info(`결재선 '${t.name}'을(를) 불러왔습니다`);
            }}
          />
        </div>
        <LineTable
          drafterName={drafterName}
          byId={byId}
          candidates={candidates}
          approvers={approvers}
          setApprovers={setApprovers}
          refs={refs}
          setRefs={setRefs}
        />
      </section>

      {/* ③ 상세 입력 — 휴가신청서 */}
      <section className="border-line bg-card shadow-card space-y-4 rounded-2xl border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-foreground text-sm font-bold">상세 입력 — {APPROVAL_FORM_LABEL.leave}</h2>
          <p className="text-text-faint text-[11px]">
            연차 사용 기간 <span className="num">~{periodEnd}</span> · 일요일은 차감하지 않습니다
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="micro mb-1 block">휴가 종류</span>
            <SearchableSelect
              options={KIND_OPTIONS}
              value={kind}
              onValueChange={(v) => setKind(v === "half" ? "half" : "annual")}
              name="kind"
              ariaLabel="휴가 종류"
            />
          </label>
          <label className="block">
            <span className="micro mb-1 block">시작일</span>
            <input
              type="date"
              name="startDate"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (e.target.value > end) setEnd(e.target.value);
              }}
              className={inputClass}
              required
            />
          </label>
          {kind === "half" ? (
            <input type="hidden" name="endDate" value={start} />
          ) : (
            <label className="block">
              <span className="micro mb-1 block">종료일</span>
              <input
                type="date"
                name="endDate"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                className={inputClass}
                required
              />
            </label>
          )}
        </div>

        <label className="block">
          <span className="micro mb-1 block">사유 (선택)</span>
          {/* 비제어 — React 19가 action 성공 후 폼을 자동 리셋해 저절로 비워진다([[#25]] 참조). */}
          <textarea
            name="reason"
            rows={3}
            maxLength={500}
            placeholder="예: 가족 행사"
            className={`${inputClass} resize-y`}
          />
        </label>
      </section>

      {/* 하단 — 차감 요약 + 상신 */}
      <div className="border-line bg-card shadow-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-3.5">
        <p className="text-[13px]">
          {invalid ? (
            <span className="text-danger">{invalid}</span>
          ) : (
            <>
              <span className="text-text-dim">차감 </span>
              <b className="num text-foreground">{formatLeaveDays(days)}</b>
              {inCurrentPeriod ? (
                <>
                  <span className="text-text-faint"> / 잔여 </span>
                  <b className="num text-foreground">{formatLeaveDays(remaining)}</b>
                </>
              ) : (
                <span className="text-text-faint"> · 다음 연차 구간이라 잔여는 그 구간 기준입니다</span>
              )}
              {over ? <span className="text-danger ml-2 font-medium">{over}</span> : null}
              {approvers.length === 0 ? (
                <span className="text-danger ml-2 font-medium">결재자를 1명 이상 지정하세요</span>
              ) : null}
            </>
          )}
        </p>
        <SubmitButton blocked={blocked} />
      </div>
    </form>
  );
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      상신
    </Button>
  );
}

/**
 * 결재선 표 — 하이웍스처럼 **결재자가 열(column)로 나란히** 선다.
 * 헤더 행 = 직함 라벨(1차 검토 → … → 승인, 자동), 본문 행 = 이름 + 순서 이동·제거,
 * 마지막 열 = [+] 추가. 그 아래 참조 행.
 */
function LineTable({
  drafterName,
  byId,
  candidates,
  approvers,
  setApprovers,
  refs,
  setRefs,
}: {
  drafterName: string;
  byId: Map<string, ApprovalPerson>;
  candidates: ApprovalPerson[];
  approvers: string[];
  setApprovers: React.Dispatch<React.SetStateAction<string[]>>;
  refs: string[];
  setRefs: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const roles = stepRoleLabels(approvers.length);
  const addable = candidates.filter((c) => !approvers.includes(c.id));
  const refAddable = candidates.filter((c) => !refs.includes(c.id) && !approvers.includes(c.id));
  const canAdd = addable.length > 0 && approvers.length < MAX_APPROVAL_STEPS;

  function move(i: number, dir: -1 | 1) {
    setApprovers((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  return (
    <div className="border-line mt-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">
        <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-2 [&_td]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap">
          <tr>
            <th className="w-[64px] text-center">결재</th>
            {/* 기안 칸 — 항상 첫 자리(도장표와 같은 어순). */}
            <td className="w-[130px] text-center align-top">
              <p className="micro">기안</p>
              <p className="text-foreground mt-1 text-[13px] font-medium">{drafterName}</p>
            </td>
            {approvers.map((id, i) => {
              const person = byId.get(id);
              return (
                <td key={id} className="w-[150px] text-center align-top">
                  <p className="micro">
                    {i + 1}차 {roles[i]}
                  </p>
                  <p className="text-foreground mt-1 text-[13px] font-medium">
                    {person?.name ?? "(알 수 없음)"}
                    {person?.jobTitle ? (
                      <span className="text-text-faint ml-1 text-[11px] font-normal">
                        {person.jobTitle}
                      </span>
                    ) : null}
                  </p>
                  <span className="mt-1 inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      className="text-text-faint hover:text-foreground disabled:opacity-30"
                      aria-label={`${person?.name ?? ""} 순서 앞으로`}
                    >
                      <EyIcon name="chevronLeft" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === approvers.length - 1}
                      className="text-text-faint hover:text-foreground disabled:opacity-30"
                      aria-label={`${person?.name ?? ""} 순서 뒤로`}
                    >
                      <EyIcon name="chevronRight" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setApprovers((l) => l.filter((x) => x !== id))}
                      className="text-text-faint hover:text-danger"
                      aria-label={`${person?.name ?? ""} 결재선에서 제거`}
                    >
                      <EyIcon name="close" size={13} />
                    </button>
                  </span>
                </td>
              );
            })}
            {canAdd ? (
              <td className="w-[150px] text-center align-middle">
                <SearchableSelect
                  options={addable.map((c) => ({
                    value: c.id,
                    label: c.name,
                    hint: c.jobTitle ?? undefined,
                  }))}
                  value=""
                  onValueChange={(id) => id && setApprovers((l) => [...l, id])}
                  placeholder="+ 결재자"
                  ariaLabel="결재자 추가"
                  triggerClassName="border-line rounded-lg border border-dashed px-2 py-1 text-[12px]"
                />
              </td>
            ) : null}
            {/* 남는 폭 흡수용 빈 칸(하이웍스 결재란처럼 표가 오른쪽으로 비어 있다). */}
            <td aria-hidden className="border-0" />
          </tr>
          <tr>
            <th className="text-center">참조</th>
            <td colSpan={approvers.length + (canAdd ? 3 : 2)} className="border-0 px-3">
              <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
                {refs.map((id) => {
                  const person = byId.get(id);
                  return (
                    <span
                      key={id}
                      className="border-line bg-bg-soft/50 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs"
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
                  <SearchableSelect
                    options={refAddable.map((c) => ({
                      value: c.id,
                      label: c.name,
                      hint: c.jobTitle ?? undefined,
                    }))}
                    value=""
                    onValueChange={(id) => id && setRefs((l) => [...l, id])}
                    placeholder="+ 참조"
                    ariaLabel="참조자 추가"
                    triggerClassName="border-line rounded-full border border-dashed px-2.5 py-0.5 text-[12px]"
                  />
                ) : refs.length === 0 ? (
                  <span className="text-text-faint text-[11px]">
                    결재 없이 열람만 하는 사람 — 없어도 됩니다
                  </span>
                ) : null}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 자주 쓰는 결재선 — 불러오기 드롭다운 + 현재 결재선 저장(이름 입력) + 삭제. */
function TemplateControls({
  templates,
  approvers,
  refs,
  onApply,
}: {
  templates: ApprovalLineTemplate[];
  approvers: string[];
  refs: string[];
  onApply: (t: ApprovalLineTemplate) => void;
}) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [busyDelete, setBusyDelete] = useState<string | null>(null);

  function save() {
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("approverIds", JSON.stringify(approvers));
    fd.append("refIds", JSON.stringify(refs));
    startTransition(async () => {
      const res = await saveLineTemplate(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "저장했습니다");
        setName("");
      }
    });
  }

  function remove(id: string, label: string) {
    const fd = new FormData();
    fd.append("templateId", id);
    setBusyDelete(id);
    startTransition(async () => {
      const res = await deleteLineTemplate(undefined, fd);
      setBusyDelete(null);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) toast.success(`'${label}'을(를) 삭제했습니다`);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {templates.length > 0 ? (
        <>
          <SearchableSelect
            options={templates.map((t) => ({
              value: t.id,
              label: t.name,
              hint: `결재 ${t.approverIds.length}단계${t.refIds.length ? ` · 참조 ${t.refIds.length}` : ""}`,
            }))}
            value=""
            onValueChange={(id) => {
              const t = templates.find((x) => x.id === id);
              if (t) onApply(t);
            }}
            placeholder="자주 쓰는 결재선"
            ariaLabel="자주 쓰는 결재선 불러오기"
            triggerClassName="border-line bg-card rounded-lg border px-2.5 py-1 text-[12px]"
          />
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => remove(t.id, t.name)}
              disabled={busyDelete === t.id}
              className="text-text-faint hover:text-danger"
              title={`'${t.name}' 삭제`}
              aria-label={`저장된 결재선 ${t.name} 삭제`}
            >
              {busyDelete === t.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <EyIcon name="trash" size={12} />
              )}
            </button>
          ))}
          <span className="bg-line mx-1 h-4 w-px" aria-hidden />
        </>
      ) : null}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="결재선 이름"
        className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-[130px] rounded-lg border px-2.5 py-1 text-[12px] outline-none transition"
        aria-label="저장할 결재선 이름"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || !name.trim() || approvers.length === 0}
        onClick={save}
      >
        저장
      </Button>
    </div>
  );
}
