"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { RichEditor } from "@/components/editor/rich-editor";
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

/**
 * 결재 문서 작성 — **하이웍스 작성 화면 그대로 한 장의 연속 문서**(원장 2026-08-14:
 * *"굳이 저렇게 영역 따로 안 나누고 진짜 하이웍스랑 똑같이"*).
 *
 * 구조: [기본 설정] [결재선] [상세 입력]이 각각 **왼쪽 섹션 라벨 + 오른쪽 표**로 한 판 위에 이어진다
 * (카드 3장으로 쪼개지 않는다 — 하이웍스는 문서 한 장이다).
 *
 * 🔴 **표 안에 팝오버 드롭다운을 넣지 않는다** — `SearchableSelect` 팝오버는 `absolute`라 표의
 *    `overflow-x-auto` 래퍼에 **잘린다**(원장 제보 "드롭다운 등 사용하면 css 깨짐"). 결재자·참조자
 *    선택은 후보를 **칩으로 항상 펼쳐** 클릭해 넣는다(하이웍스의 조직도 팝업 대응이자, 후보가 몇 명인
 *    파일럿에선 클릭 수가 더 적다). 휴가 종류처럼 표 밖 폼 필드는 드롭다운 그대로 둔다.
 * ⚠️ 잔여·결재선 검증의 근거는 서버(line.ts·submitLeaveDraft)다 — 화면은 미리보기·조기경고([[#77]]).
 * ⚠️ 임시저장·인쇄미리보기·보존연한·보안등급은 흉내 내지 않는다(대응 데이터가 없다 — 죽은 컨트롤 금지).
 */

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary rounded-lg border px-3 py-1.5 text-sm outline-none transition";

/** 섹션 한 줄 — 좌측 라벨 칸 + 우측 내용(하이웍스 작성 화면의 행 문법). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line flex flex-col gap-2 border-b py-4 last:border-b-0 sm:flex-row sm:gap-4">
      <p className="text-foreground w-[84px] shrink-0 pt-1 text-[13px] font-bold">{label}</p>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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
  const [approvers, setApprovers] = useState<string[]>(
    initialApproverIds.filter((id) => byId.has(id)),
  );
  const [refs, setRefs] = useState<string[]>([]);
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
    <form action={action}>
      <input type="hidden" name="approverIds" value={JSON.stringify(approvers)} />
      <input type="hidden" name="refIds" value={JSON.stringify(refs)} />
      <input type="hidden" name="kind" value={kind} />

      {/* 문서 한 장 — 섹션이 카드로 갈라지지 않고 구분선으로만 이어진다. */}
      <article className="border-line bg-card shadow-card rounded-2xl border px-5 py-1 sm:px-6">
        <Row label="기본 설정">
          <div className="overflow-hidden rounded-lg">
            <table className="w-full table-fixed border-collapse text-sm">
              <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap">
                <tr>
                  <th className="w-[88px]">문서 종류</th>
                  <td className="text-foreground text-[13px]">
                    공통 · <b>{APPROVAL_FORM_LABEL.leave}</b>
                    <span className="text-text-faint ml-1 text-[11px]">(현재 양식 1종)</span>
                  </td>
                  <th className="w-[76px]">작성자</th>
                  <td className="text-[13px]">
                    <span className="text-foreground font-medium">{drafterName}</span>
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
        </Row>

        <Row label="결재선">
          <LineTable
            drafterName={drafterName}
            byId={byId}
            approvers={approvers}
            setApprovers={setApprovers}
            refs={refs}
          />
          <PeoplePicker
            candidates={candidates}
            approvers={approvers}
            refs={refs}
            setApprovers={setApprovers}
            setRefs={setRefs}
          />
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
        </Row>

        <Row label="상세 입력">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="micro mb-1 block">휴가 종류</span>
              {/* 표 밖이라 팝오버가 잘리지 않는다 — 여긴 칩 대신 토글 두 개로(선택지가 둘뿐). */}
              <span className="border-line inline-flex overflow-hidden rounded-lg border">
                {(["annual", "half"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`px-3 py-1.5 text-[13px] transition ${
                      kind === k
                        ? "bg-primary text-primary-foreground font-medium"
                        : "bg-card text-text-dim hover:bg-bg-soft"
                    }`}
                  >
                    {k === "annual" ? "연차" : "반차"}
                  </button>
                ))}
              </span>
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
            <p className="text-text-faint pb-2 text-[11px]">
              연차 사용 기간 <span className="num">~{periodEnd}</span> · 일요일은 차감하지 않습니다
            </p>
          </div>

          <div className="mt-3">
            <span className="micro mb-1 block">사유</span>
            {/* 표·서식이 필요해 리치 에디터(원장 요구). 무거운 라이브러리라 지연로드된다(B5). */}
            <RichEditor name="reason" placeholder="사유를 적어 주세요 — 표·목록·서식을 쓸 수 있습니다" ariaLabel="사유" />
          </div>
        </Row>
      </article>

      {/* 하단 — 차감 요약 + 상신(문서 판 바깥, 하이웍스의 하단 액션 바 대응) */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
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
 * 결재선 표 — 하이웍스처럼 **사람이 열로** 선다(왼쪽 세로 [결재] 라벨 + 기안 칸 + 결재자 칸들).
 * 이 표 안에는 **팝오버가 없다**(잘림 방지) — 추가는 아래 PeoplePicker가 맡는다.
 */
function LineTable({
  drafterName,
  byId,
  approvers,
  setApprovers,
  refs,
}: {
  drafterName: string;
  byId: Map<string, ApprovalPerson>;
  approvers: string[];
  setApprovers: React.Dispatch<React.SetStateAction<string[]>>;
  refs: string[];
}) {
  const roles = stepRoleLabels(approvers.length);

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
    <div className="overflow-x-auto">
      <table className="border-line border-collapse border text-center text-sm">
        <tbody>
          <tr>
            <th className="border-line bg-bg-soft/60 text-text-dim w-9 border px-2.5 text-xs font-semibold">
              결재
            </th>
            <td className="border-line min-w-[110px] border px-3 py-2 align-top">
              <p className="micro">기안</p>
              <p className="text-foreground mt-1 text-[13px] font-medium whitespace-nowrap">
                {drafterName}
              </p>
            </td>
            {approvers.length === 0 ? (
              <td className="border-line text-text-faint min-w-[180px] border px-3 py-4 text-xs">
                아래에서 결재자를 골라 주세요
              </td>
            ) : (
              approvers.map((id, i) => {
                const person = byId.get(id);
                return (
                  <td key={id} className="border-line min-w-[128px] border px-3 py-2 align-top">
                    <p className="micro">
                      {i + 1}차 {roles[i]}
                    </p>
                    <p className="text-foreground mt-1 text-[13px] font-medium whitespace-nowrap">
                      {person?.name ?? "(알 수 없음)"}
                      {person?.jobTitle ? (
                        <span className="text-text-faint ml-1 text-[11px] font-normal">
                          {person.jobTitle}
                        </span>
                      ) : null}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1.5">
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
              })
            )}
          </tr>
          <tr>
            <th className="border-line bg-bg-soft/60 text-text-dim border px-2.5 py-1.5 text-xs font-semibold">
              참조
            </th>
            <td
              colSpan={Math.max(1, approvers.length) + 1}
              className="border-line border px-3 py-1.5 text-left"
            >
              {refs.length === 0 ? (
                <span className="text-text-faint text-[11px]">
                  결재 없이 열람만 하는 사람 — 없어도 됩니다
                </span>
              ) : (
                <span className="text-foreground inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                  {refs.map((id) => (
                    <span key={id}>{byId.get(id)?.name ?? "(알 수 없음)"}</span>
                  ))}
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * 사람 고르기 — 후보를 **칩으로 펼쳐** 클릭해 결재선·참조에 넣는다(팝오버 없음 = 잘릴 일 없음).
 * 이미 들어간 사람은 눌린 상태로 표시하고 다시 누르면 빠진다.
 */
function PeoplePicker({
  candidates,
  approvers,
  refs,
  setApprovers,
  setRefs,
}: {
  candidates: ApprovalPerson[];
  approvers: string[];
  refs: string[];
  setApprovers: React.Dispatch<React.SetStateAction<string[]>>;
  setRefs: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  function toggleApprover(id: string) {
    setApprovers((l) => {
      if (l.includes(id)) return l.filter((x) => x !== id);
      if (l.length >= MAX_APPROVAL_STEPS) return l;
      setRefs((r) => r.filter((x) => x !== id)); // 결재자는 참조에서 뺀다(어차피 문서를 본다)
      return [...l, id];
    });
  }
  function toggleRef(id: string) {
    if (approvers.includes(id)) return;
    setRefs((l) => (l.includes(id) ? l.filter((x) => x !== id) : l.length >= MAX_REFS ? l : [...l, id]));
  }

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="micro">결재자 선택</span>
        {candidates.map((c) => {
          const on = approvers.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleApprover(c.id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                on
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line bg-card text-text-dim hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {c.name}
              {c.jobTitle ? <span className="ml-1 opacity-70">{c.jobTitle}</span> : null}
            </button>
          );
        })}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="micro">참조 선택</span>
        {candidates.map((c) => {
          const disabled = approvers.includes(c.id);
          const on = refs.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggleRef(c.id)}
              disabled={disabled}
              title={disabled ? "결재자는 이미 문서를 봅니다" : undefined}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-30 ${
                on
                  ? "border-blue bg-blue-soft text-blue font-medium"
                  : "border-line bg-card text-text-dim hover:border-blue/50 hover:text-foreground"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </span>
    </div>
  );
}

/** 자주 쓰는 결재선 — 저장(이름) · 불러오기 · 삭제. 불러오기도 팝오버 없이 **버튼 나열**. */
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
    <div className="border-line mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-2.5">
      <span className="micro">자주 쓰는 결재선</span>
      {templates.length === 0 ? (
        <span className="text-text-faint text-[11px]">저장된 결재선이 없습니다</span>
      ) : (
        templates.map((t) => (
          <span
            key={t.id}
            className="border-line bg-card inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2.5 text-xs"
          >
            <button
              type="button"
              onClick={() => onApply(t)}
              className="text-foreground hover:text-primary"
              title={`결재 ${t.approverIds.length}단계${t.refIds.length ? ` · 참조 ${t.refIds.length}명` : ""}`}
            >
              {t.name}
            </button>
            <button
              type="button"
              onClick={() => remove(t.id, t.name)}
              disabled={busyDelete === t.id}
              className="text-text-faint hover:text-danger"
              aria-label={`저장된 결재선 ${t.name} 삭제`}
            >
              {busyDelete === t.id ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <EyIcon name="close" size={11} />
              )}
            </button>
          </span>
        ))
      )}
      <span className="ml-auto inline-flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="이름 붙여 저장"
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
      </span>
    </div>
  );
}
