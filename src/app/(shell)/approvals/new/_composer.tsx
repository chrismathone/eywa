"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { RichEditor } from "@/components/editor/rich-editor";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import {
  deleteLineTemplate,
  saveLineTemplate,
  submitBasicDraft,
  submitExpenseDraft,
  submitIncomeDraft,
  submitLeaveDraft,
  type ApprovalActionState,
} from "@/features/approvals/server/actions";
import { MAX_APPROVAL_STEPS, MAX_REFS } from "@/features/approvals/line";
import {
  APPROVAL_FORMS,
  APPROVAL_FORM_DESC,
  APPROVAL_FORM_LABEL,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  stepRoleLabels,
  type ApprovalForm,
} from "@/features/approvals/types";
import type { ApprovalLineTemplate, ApprovalPerson } from "@/features/approvals/server/queries";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  countLeaveDays,
  formatLeaveDays,
  LEAVE_KINDS,
  LEAVE_KIND_LABEL,
  validateLeaveRange,
  type LeaveKind,
} from "@/features/leave/request-days";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

/** 읽기 권한 칸의 안내(placeholder) — 판정은 페이지가 기안 액션과 같은 canWriteTenant("approvals")로 내린다. */
const LOCKED_PH = writeLockedPlaceholder("approvals");

/**
 * 결재 문서 작성 — **하이웍스 작성 화면 그대로 한 장의 연속 문서**(원장 2026-08-14:
 * *"굳이 저렇게 영역 따로 안 나누고 진짜 하이웍스랑 똑같이"*).
 *
 * 구조: [기본 설정] [결재선] [상세 입력]이 각각 **왼쪽 섹션 라벨 + 오른쪽 표**로 한 판 위에 이어진다
 * (카드 3장으로 쪼개지 않는다 — 하이웍스는 문서 한 장이다).
 *
 * 결재선 표는 **종이 결재란 문법**(원장 스크린샷): 위 직급 / 가운데 사인 칸(작성 화면이라 비워 둔다) /
 * 아래 이름. 결재자 지정은 표의 **[+] 버튼 → 직원 선택 팝업**(하이웍스 조직도 선택 대응) — 후보가
 * 전 직원이라 칩 상시 나열로는 안 된다.
 *
 * 🔴 **표 안에 팝오버 드롭다운을 넣지 않는다** — `absolute` 팝오버는 표의 `overflow-x-auto` 래퍼에
 *    **잘린다**(원장 제보 "드롭다운 등 사용하면 css 깨짐"). 직원 선택은 **fixed 오버레이 다이얼로그**
 *    (ConfirmDialog 선례)라 잘릴 일이 없다.
 * 양식 4종(휴가신청서·품의서·지출결의서·수입결의서) — 문서 종류 드롭다운이 상세 입력과 제출
 * 액션을 가른다. 결재선·기본 설정은 공용.
 *
 * ⚠️ 잔여·결재선 검증의 근거는 서버(line.ts·각 submit 액션)다 — 화면은 미리보기·조기경고([[#77]]).
 * ⚠️ 임시저장·인쇄미리보기·보존연한·보안등급은 흉내 내지 않는다(대응 데이터가 없다 — 죽은 컨트롤 금지).
 *
 * `canWrite`(필수) = 기안 액션(requireApprovalWriter)과 같은 canWriteTenant("approvals") — 거짓이면(읽기 권한으로
 * 주소에 바로 들어온 경우) 칸은 전부 비활성 + 권한 안내이고, '결재 올리기'·결재선 저장/삭제는 그리지 않는다
 * (원장 2026-11-05 — src/lib/write-lock.ts).
 */

/** Select.Root items — SelectValue가 값 대신 이 라벨을 그린다(base-ui). */
const FORM_ITEMS = Object.fromEntries(APPROVAL_FORMS.map((f) => [f, APPROVAL_FORM_LABEL[f]]));
const KIND_ITEMS = Object.fromEntries(LEAVE_KINDS.map((k) => [k, LEAVE_KIND_LABEL[k]]));

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary rounded-lg border px-3 py-1.5 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-60";

/** 섹션 한 줄 — 좌측 라벨 칸 + 우측 내용(하이웍스 작성 화면의 행 문법). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-line flex flex-col gap-2 border-b py-4 last:border-b-0 sm:flex-row sm:gap-4">
      <p className="text-foreground w-[84px] shrink-0 pt-1 text-base font-bold">{label}</p>
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
  canWrite,
}: {
  drafterName: string;
  drafterJobTitle: string | null;
  candidates: ApprovalPerson[];
  templates: ApprovalLineTemplate[];
  initialApproverIds: string[];
  /** 기안 권한 — 거짓이면 읽기 전용 양식(칸 비활성 + 안내, 제출·저장 단추 없음). */
  canWrite: boolean;
  /** 연차 구간 끝 — 입사일 미등록이면 null. **휴가신청서만** 막고 다른 양식은 기안할 수 있어야 한다. */
  periodEnd: string | null;
  /** 잔여 연차. null = 사용 조회 실패로 셀 수 없음(E10) — 화면 사전 경고만 끄고, 판정은 서버가 한다. */
  remaining: number | null;
  today: string;
}) {
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const [approvers, setApprovers] = useState<string[]>(
    initialApproverIds.filter((id) => byId.has(id)),
  );
  const [refs, setRefs] = useState<string[]>([]);

  // 문서 종류 — 상세 입력과 제출 액션이 여기서 갈린다.
  const [form, setForm] = useState<ApprovalForm>("leave");

  // 휴가신청서
  const [kind, setKind] = useState<LeaveKind>("annual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  // 제목 — 품의·지출·수입 공용(양식을 오가도 입력이 유지되게 하나로 둔다).
  const [title, setTitle] = useState("");
  // 지출·수입결의서 공용 — 분류 어휘만 양식 따라 다르다(EXPENSE_/INCOME_CATEGORIES).
  const [category, setCategory] = useState<string>("기타");
  const [amountDigits, setAmountDigits] = useState(""); // 숫자만 보관, 표시할 때 콤마
  const [moneyDate, setMoneyDate] = useState(today); // 지출일(expense)·수입일(income) 공용

  // 양식별 제출 액션 — 폼 element는 하나고 action만 갈아 끼운다.
  const [leaveState, leaveAction] = useActionState<ApprovalActionState, FormData>(
    submitLeaveDraft,
    undefined,
  );
  const [basicState, basicAction] = useActionState<ApprovalActionState, FormData>(
    submitBasicDraft,
    undefined,
  );
  const [expenseState, expenseAction] = useActionState<ApprovalActionState, FormData>(
    submitExpenseDraft,
    undefined,
  );
  const [incomeState, incomeAction] = useActionState<ApprovalActionState, FormData>(
    submitIncomeDraft,
    undefined,
  );
  useSubmitToast(leaveState);
  useSubmitToast(basicState);
  useSubmitToast(expenseState);
  useSubmitToast(incomeState);
  const action =
    form === "leave"
      ? leaveAction
      : form === "expense"
        ? expenseAction
        : form === "income"
          ? incomeAction
          : basicAction;

  // ── 휴가신청서 검증(기존 규칙 그대로 — 입사일 없으면 계산 불가) ─────────────
  const leaveReady = periodEnd !== null;
  const effectiveEnd = kind === "annual" ? end : start; // 반차·반반차는 하루
  const days = countLeaveDays(start, effectiveEnd, kind);
  const inCurrentPeriod = leaveReady && !!start && start <= periodEnd;
  const invalid = validateLeaveRange({
    start,
    end: effectiveEnd,
    kind,
    periodEnd: inCurrentPeriod ? periodEnd : null,
  });
  const over =
    inCurrentPeriod && !invalid && remaining !== null && days > remaining
      ? remaining <= 0
        ? "남은 연차가 없어 올릴 수 없습니다"
        : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다`
      : null;

  // ── 양식별 조기경고(서버가 최종 판정, [[#77]]) ──────────────────────────────
  const amountValue = Number(amountDigits || "0");
  const detailProblem =
    form === "leave"
      ? !leaveReady
        ? "입사일이 등록되지 않아 연차를 계산할 수 없습니다"
        : (invalid ?? over)
      : !title.trim()
        ? "제목을 입력하세요"
        : form === "expense" || form === "income"
          ? amountValue <= 0
            ? "금액을 입력하세요"
            : !moneyDate
              ? form === "expense"
                ? "지출일을 선택하세요"
                : "수입일을 선택하세요"
              : null
          : null;
  const blocked = !!detailProblem || approvers.length === 0;
  const locked = !canWrite;

  return (
    // 읽기 권한이면 제출 단추가 없고 칸도 잠겨 있지만, 제출 경로를 하나라도 남기지 않는다(서버도 막는다).
    <form action={action} onSubmit={locked ? (e) => e.preventDefault() : undefined}>
      {locked ? (
        <p className="text-text-dim bg-bg-soft mb-3 rounded-lg px-3 py-2 text-sm">{writeLockedNote("approvals")}</p>
      ) : null}
      <input type="hidden" name="approverIds" value={JSON.stringify(approvers)} />
      <input type="hidden" name="refIds" value={JSON.stringify(refs)} />
      {form === "leave" ? <input type="hidden" name="kind" value={kind} /> : null}
      {form === "proposal" ? <input type="hidden" name="formType" value="proposal" /> : null}
      {form === "expense" || form === "income" ? (
        <input type="hidden" name="category" value={category} />
      ) : null}

      {/* 문서 한 장 — 섹션이 카드로 갈라지지 않고 구분선으로만 이어진다. */}
      <article className="bg-card shadow-card rounded-2xl px-5 py-1 sm:px-6">
        <Row label="기본 설정">
          <div className="overflow-hidden rounded-lg">
            <table className="w-full table-fixed border-collapse text-sm">
              <tbody className="[&_th]:bg-bg-soft/60 [&_th]:text-text-dim [&_th]:border-line [&_td]:border-line [&_th]:border [&_td]:border [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold [&_th]:whitespace-nowrap">
                <tr>
                  <th className="w-[88px]">문서 종류</th>
                  <td>
                    {/* 드롭다운(원장 2026-08-19) — ui/select는 Portal 렌더라 overflow-hidden 표 래퍼에
                        안 잘린다(인플레이스 absolute 팝오버 금지 규칙은 그대로 유효). */}
                    <Select
                      value={form}
                      disabled={locked}
                      onValueChange={(v) => {
                        if (!v) return;
                        setForm(v as ApprovalForm);
                        // 지출↔수입은 분류 어휘가 달라 남은 값이 다른 양식의 어휘일 수 있다 — 안전하게 리셋.
                        setCategory("기타");
                      }}
                      items={FORM_ITEMS}
                    >
                      <SelectTrigger className="bg-card w-[150px]" aria-label="문서 종류">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {APPROVAL_FORMS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {APPROVAL_FORM_LABEL[f]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  {/* 1열과 같은 88px — table-fixed라 2행 '기안 일시'(16px semibold 4자+공백 ≈59px + px-3 24 + border 2 = 85px)가
                      이 폭을 그대로 물려받는다. 76px이던 시절엔 9px가 표 선을 뚫고 나왔다(2026-09-08 v5 글자 기준 실측). */}
                  <th className="w-[88px]">작성자</th>
                  <td className="text-sm">
                    <span className="text-foreground font-medium">{drafterName}</span>
                    {drafterJobTitle ? (
                      <span className="text-text-faint ml-1 text-xs">{drafterJobTitle}</span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th>문서 번호</th>
                  <td className="text-text-faint text-xs">올리면 자동으로 부여됩니다</td>
                  <th>기안 일시</th>
                  <td className="num text-text-dim text-xs">{today}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {APPROVAL_FORM_DESC[form] ? (
            <p className="text-text-dim mt-1.5 text-sm">{APPROVAL_FORM_DESC[form]}</p>
          ) : null}
        </Row>

        <Row label="결재선">
          <LineTable
            drafterName={drafterName}
            drafterJobTitle={drafterJobTitle}
            byId={byId}
            candidates={candidates}
            approvers={approvers}
            setApprovers={setApprovers}
            refs={refs}
            setRefs={setRefs}
            locked={locked}
          />
          <TemplateControls
            templates={templates}
            approvers={approvers}
            refs={refs}
            locked={locked}
            onApply={(t) => {
              setApprovers(t.approverIds.filter((x) => byId.has(x)));
              setRefs(t.refIds.filter((x) => byId.has(x)));
              toast.info(`결재선 '${t.name}'을(를) 불러왔습니다`);
            }}
          />
        </Row>

        <Row label="상세 입력">
          {form === "leave" ? (
            !leaveReady ? (
              <div className="border-line bg-bg-soft/50 text-text-dim rounded-lg border border-dashed px-4 py-6 text-center text-xs">
                입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 입사일 등록을
                요청하세요.
                {locked ? null : (
                  <>
                    <br />
                    품의서·지출결의서·수입결의서는 지금도 기안할 수 있습니다.
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="block">
                    <span className="micro mb-1 block">휴가 종류</span>
                    {/* 드롭다운(원장 2026-08-19: 반반차 추가로 셋) — Portal 렌더라 잘림 없음. */}
                    <Select
                      value={kind}
                      disabled={locked}
                      onValueChange={(v) => {
                        if (v) setKind(v as LeaveKind);
                      }}
                      items={KIND_ITEMS}
                    >
                      <SelectTrigger className="bg-card w-[120px]" aria-label="휴가 종류">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {LEAVE_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {LEAVE_KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                      disabled={locked}
                      className={inputClass}
                      required
                    />
                  </label>
                  {kind !== "annual" ? (
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
                        disabled={locked}
                        className={inputClass}
                        required
                      />
                    </label>
                  )}
                  <p className="text-text-faint pb-2 text-xs">
                    연차 사용 기간 <span className="num">~{periodEnd}</span> · 일요일은 차감하지
                    않습니다
                  </p>
                </div>

                <div className="mt-3">
                  <span className="micro mb-1 block">사유</span>
                  {/* 표·서식이 필요해 리치 에디터(원장 요구). 무거운 라이브러리라 지연로드된다(B5). */}
                  <RichEditor
                    name="reason"
                    placeholder={locked ? LOCKED_PH : "사유를 적어 주세요 — 표·목록·서식을 쓸 수 있습니다"}
                    ariaLabel="사유"
                    disabled={locked}
                  />
                </div>
              </>
            )
          ) : (
            <>
              <label className="block">
                <span className="micro mb-1 block">제목</span>
                <input
                  name="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  disabled={locked}
                  placeholder={
                    locked
                      ? LOCKED_PH
                      : form === "expense"
                        ? "예: 8월 교재 구입비 지출"
                        : form === "income"
                          ? "예: 여름 특강 교재 판매 수입"
                          : "예: 겨울 특강 교재 구매 품의"
                  }
                  className={`${inputClass} w-full max-w-[520px]`}
                  required
                />
              </label>

              {form === "expense" || form === "income" ? (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="micro mb-1 block">분류</span>
                    <span className="flex flex-wrap items-center gap-1">
                      {(form === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategory(c)}
                          disabled={locked}
                          className={`rounded-full border px-2.5 py-0.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            category === c
                              ? "border-primary bg-primary text-primary-foreground font-medium"
                              : "border-line bg-card text-text-dim hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </span>
                  </label>
                  <label className="block">
                    <span className="micro mb-1 block">금액</span>
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        name="amount"
                        inputMode="numeric"
                        value={amountDigits ? Number(amountDigits).toLocaleString("ko-KR") : ""}
                        onChange={(e) =>
                          setAmountDigits(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))
                        }
                        // 좁은 칸(140px)이라 안내 문구가 잘린다 — 읽기 권한 안내는 양식 위 한 줄이 맡고 여기는 툴팁만.
                        placeholder="0"
                        title={locked ? LOCKED_PH : undefined}
                        disabled={locked}
                        className={`${inputClass} w-[140px] text-right`}
                        aria-label="금액(원)"
                        required
                      />
                      <span className="text-text-dim text-sm">원</span>
                    </span>
                  </label>
                  <label className="block">
                    <span className="micro mb-1 block">{form === "expense" ? "지출일" : "수입일"}</span>
                    <input
                      type="date"
                      name={form === "expense" ? "spendDate" : "incomeDate"}
                      value={moneyDate}
                      onChange={(e) => setMoneyDate(e.target.value)}
                      disabled={locked}
                      className={inputClass}
                      required
                    />
                  </label>
                </div>
              ) : null}

              <div className="mt-3">
                <span className="micro mb-1 block">본문</span>
                {/* ⚠️ 문서 종류를 바꾸면 에디터가 재마운트돼 본문이 비워진다 — 양식이 다르면 문서도
                    다른 것이라 의도된 동작(하이웍스도 양식 전환 시 본문을 잇지 않는다). */}
                <RichEditor
                  name="body"
                  placeholder={
                    locked
                      ? LOCKED_PH
                      : form === "expense"
                        ? "지출 내역을 적어 주세요 — 품목·수량 표를 넣을 수 있습니다"
                        : form === "income"
                          ? "수입 내역을 적어 주세요 — 항목·수량 표를 넣을 수 있습니다"
                          : "내용을 적어 주세요 — 표·목록·서식을 쓸 수 있습니다"
                  }
                  ariaLabel="본문"
                  disabled={locked}
                />
              </div>
            </>
          )}
        </Row>
      </article>

      {/* 하단 — 요약 + 상신(문서 판 바깥, 하이웍스의 하단 액션 바 대응). 읽기 권한이면 바째 없다 —
          "제목을 입력하세요"·"결재자를 지정하세요" 같은 재촉과 '결재 올리기'가 할 수 없는 일을 권한다(안내는 양식 위 한 줄). */}
      {locked ? null : (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-sm">
          {form === "leave" && leaveReady && !detailProblem ? (
            <>
              <span className="text-text-dim">차감 </span>
              <b className="num text-foreground">{formatLeaveDays(days)}</b>
              {inCurrentPeriod ? (
                <>
                  <span className="text-text-faint"> / 잔여 </span>
                  <b className="num text-foreground">{remaining === null ? "확인 불가" : formatLeaveDays(remaining)}</b>
                </>
              ) : (
                <span className="text-text-faint"> · 다음 연차 구간이라 잔여는 그 구간 기준입니다</span>
              )}
            </>
          ) : detailProblem ? (
            <span className="text-danger">{detailProblem}</span>
          ) : (
            <span className="text-text-faint">작성한 내용은 결재선 전원이 봅니다</span>
          )}
          {approvers.length === 0 ? (
            <span className="text-danger ml-2 font-medium">결재자를 1명 이상 지정하세요</span>
          ) : null}
        </p>
        <SubmitButton blocked={blocked} />
      </div>
      )}
    </form>
  );
}

/** 제출 결과 토스트 — 양식별 useActionState 3개가 같은 규약을 공유한다. */
function useSubmitToast(state: ApprovalActionState) {
  const seen = useRef<ApprovalActionState>(undefined);
  const inFrame = useInFrame();
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.notice ?? "결재를 올렸습니다");
      // 상신 성공 = 방금 만든 문서로 이동(원장 2026-08-18: "alert만 뜨니까 인지가 안 됨").
      // ⚠️ 서버 액션 직후의 router.push는 액션 응답 RSC 적용에 삼켜진다([[#102]]) — window.location.assign.
      // ⚠️ 창(iframe) 안이면 embed=1 유지(원생 삭제와 같은 규칙) — 빼면 방금 만든 문서가 창 안에 전체 셸로 뜬다.
      if (state.docId) {
        const dest = `/approvals/${state.docId}`;
        window.location.assign(inFrame ? withEmbed(dest) : dest);
      }
    }
  }, [state, inFrame]);
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || blocked}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      결재 올리기
    </Button>
  );
}

/**
 * 결재선 표 — 종이 결재란 문법 **세 줄**(위 직급 / 가운데 사인 칸 / 아래 이름). 작성 화면이라 사인 칸은
 * 전부 비워 둔다(원장: "사인 란도 작성칸이지만 비워놓고"). 지정·추가는 [+] → 오버레이 다이얼로그.
 */
function LineTable({
  drafterName,
  drafterJobTitle,
  byId,
  candidates,
  approvers,
  setApprovers,
  refs,
  setRefs,
  locked,
}: {
  drafterName: string;
  drafterJobTitle: string | null;
  byId: Map<string, ApprovalPerson>;
  candidates: ApprovalPerson[];
  approvers: string[];
  setApprovers: React.Dispatch<React.SetStateAction<string[]>>;
  refs: string[];
  setRefs: React.Dispatch<React.SetStateAction<string[]>>;
  /** 읽기 권한 — [+]·[지정] 단추를 잠그고 빈 칸 안내를 권한 안내로 바꾼다. */
  locked: boolean;
}) {
  const roles = stepRoleLabels(approvers.length);
  const [picker, setPicker] = useState<null | "approver" | "ref">(null);

  // 순서 이동 — **모달 안에서만** 쓴다(원장 2026-08-14: "위치 조정하는거랑 사람 찾는거 모달에서
  // 정하고 넣는걸로"). 표는 종이처럼 표시 전용이라 컨트롤이 없다.
  function move(i: number, dir: -1 | 1) {
    setApprovers((list) => {
      const next = [...list];
      const j = i + dir;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  function toggleApprover(id: string) {
    setApprovers((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id);
      if (list.length >= MAX_APPROVAL_STEPS) return list;
      setRefs((r) => r.filter((x) => x !== id)); // 결재자는 참조에서 뺀다(어차피 문서를 본다)
      return [...list, id];
    });
  }

  function toggleRef(id: string) {
    if (approvers.includes(id)) return;
    setRefs((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_REFS ? list : [...list, id],
    );
  }

  // 참조 행 colSpan = 기안 1 + 결재자 칸(없으면 안내 1) + [지정] 열(항상 있다 — 수정 진입점).
  const bodyCols = 1 + Math.max(1, approvers.length) + 1;

  return (
    <DragScrollArea>
      <table className="border-line border-collapse border text-center text-sm">
        <tbody>
          {/* 1줄 — 직급 */}
          <tr>
            <th
              rowSpan={3}
              className="border-line bg-bg-soft/60 text-text-dim w-9 border px-2.5 text-sm font-semibold"
            >
              결재
            </th>
            <th className="border-line bg-bg-soft/60 text-text-dim min-w-[104px] border px-2 py-1 text-sm font-semibold">
              {drafterJobTitle ?? "기안"}
            </th>
            {approvers.length === 0 ? (
              <td rowSpan={3} className="border-line text-text-faint min-w-[180px] border px-4 text-xs">
                {locked ? LOCKED_PH : "[+]를 눌러 결재자를 지정하세요"}
              </td>
            ) : (
              approvers.map((id) => (
                <th
                  key={id}
                  className="border-line bg-bg-soft/60 text-text-dim min-w-[112px] border px-2 py-1 text-sm font-semibold"
                >
                  {byId.get(id)?.jobTitle ?? "직원"}
                </th>
              ))
            )}
            {/* [지정]은 항상 보인다 — 표에 편집 컨트롤이 없으므로 수정·제거도 이 모달이 유일한 문이다. */}
            <td rowSpan={3} className="border-line w-[52px] border px-2 align-middle">
              <button
                type="button"
                onClick={() => setPicker("approver")}
                disabled={locked}
                className="border-line text-text-dim hover:border-primary/60 hover:text-primary mx-auto flex size-9 items-center justify-center rounded-lg border border-dashed transition disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="결재선 지정·순서 변경"
                title={locked ? LOCKED_PH : "결재선 지정·순서 변경"}
              >
                <EyIcon name={approvers.length > 0 ? "edit" : "plus"} size={15} />
              </button>
            </td>
          </tr>
          {/* 2줄 — 사인 칸(작성 화면이라 비움 · 원장 "사인란 더 크게") */}
          <tr>
            <td className="border-line h-20 border" aria-label="기안자 사인 칸(비어 있음)" />
            {approvers.map((id) => (
              <td key={id} className="border-line h-20 border" aria-label="결재자 사인 칸(비어 있음)" />
            ))}
          </tr>
          {/* 3줄 — 이름(표시 전용 — 편집은 [지정] 모달에서) */}
          <tr>
            <td className="border-line border px-2 py-1.5">
              <p className="text-foreground text-sm font-medium whitespace-nowrap">{drafterName}</p>
              <p className="text-text-faint text-xs">기안</p>
            </td>
            {approvers.map((id, i) => (
              <td key={id} className="border-line border px-2 py-1.5">
                <p className="text-foreground text-sm font-medium whitespace-nowrap">
                  {byId.get(id)?.name ?? "(알 수 없음)"}
                </p>
                <p className="text-text-faint text-xs">
                  {i + 1}차 {roles[i]}
                </p>
              </td>
            ))}
          </tr>
          {/* 참조 행 */}
          <tr>
            <th className="border-line bg-bg-soft/60 text-text-dim border px-2.5 py-1.5 text-sm font-semibold">
              참조
            </th>
            <td colSpan={bodyCols} className="border-line border px-3 py-1.5 text-left">
              <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 align-middle">
                {refs.map((id) => (
                  <span key={id} className="text-foreground text-sm">
                    {byId.get(id)?.name ?? "(알 수 없음)"}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setPicker("ref")}
                  disabled={locked}
                  className="border-line text-text-dim hover:border-blue/60 hover:text-blue flex size-6 items-center justify-center rounded-lg border border-dashed transition disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="참조자 지정"
                  title={locked ? LOCKED_PH : "참조자 지정"}
                >
                  <EyIcon name={refs.length > 0 ? "edit" : "plus"} size={12} />
                </button>
                {refs.length === 0 && !locked ? (
                  <span className="text-text-faint text-xs">결재 없이 열람만 — 없어도 됩니다</span>
                ) : null}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      {picker && !locked ? (
        <StaffPickerDialog
          mode={picker}
          candidates={candidates}
          byId={byId}
          approvers={approvers}
          refs={refs}
          onToggle={picker === "approver" ? toggleApprover : toggleRef}
          onMove={move}
          onRemove={(id) =>
            picker === "approver"
              ? setApprovers((l) => l.filter((x) => x !== id))
              : setRefs((l) => l.filter((x) => x !== id))
          }
          onClose={() => setPicker(null)}
        />
      ) : null}
    </DragScrollArea>
  );
}

/**
 * 결재선 지정 다이얼로그 — 하이웍스 조직도 팝업 대응. **fixed 오버레이**(ConfirmDialog 선례)라 표의
 * 가로 스크롤 래퍼에 잘리지 않는다.
 *
 * 결재자 모드 = **2열**: 왼쪽 직원 목록(검색·클릭=넣고 빼기) + 오른쪽 **결재 순서**(↑↓·제거) —
 * 지정과 순서 조정을 **모달 안에서 끝낸다**(원장 2026-08-14: "위치 조정하는거랑 사람 찾는거 모달에서
 * 정하고 넣는걸로"). 표에는 편집 컨트롤이 없다. 참조 모드 = 순서가 없어 1열.
 */
function StaffPickerDialog({
  mode,
  candidates,
  byId,
  approvers,
  refs,
  onToggle,
  onMove,
  onRemove,
  onClose,
}: {
  mode: "approver" | "ref";
  candidates: ApprovalPerson[];
  byId: Map<string, ApprovalPerson>;
  approvers: string[];
  refs: string[];
  onToggle: (id: string) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const selected = mode === "approver" ? approvers : refs;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return candidates;
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(t) || (c.jobTitle ?? "").toLowerCase().includes(t),
    );
  }, [q, candidates]);
  const max = mode === "approver" ? MAX_APPROVAL_STEPS : MAX_REFS;
  const roles = stepRoleLabels(approvers.length);
  const twoPane = mode === "approver";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`bg-background border-line flex max-h-[84vh] w-full flex-col rounded-xl border p-4 shadow-lg ${
          twoPane ? "max-w-2xl" : "max-w-sm"
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={twoPane ? "결재선 지정" : "참조자 지정"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-foreground text-sm font-bold">{twoPane ? "결재선 지정" : "참조자 지정"}</h2>
          <p className="text-text-faint text-xs">
            {selected.length}/{max}명 · 클릭해서 넣고 빼세요
          </p>
        </div>

        <div className={`mt-2.5 grid min-h-0 flex-1 gap-3 ${twoPane ? "sm:grid-cols-[1fr_240px]" : ""}`}>
          {/* 왼쪽 — 직원 찾기 */}
          <div className="flex min-h-0 flex-col">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름·직급 검색"
              autoFocus
              className={`${inputClass} w-full`}
              aria-label="직원 검색"
            />
            <ul className="border-line mt-2 max-h-[320px] flex-1 divide-y overflow-y-auto rounded-lg border">
              {list.length === 0 ? (
                <li className="text-text-faint px-3 py-6 text-center text-xs">검색 결과가 없습니다</li>
              ) : (
                list.map((c) => {
                  const isSelected = selected.includes(c.id);
                  // 참조 지정에서 이미 결재자인 사람은 막는다(결재자는 어차피 문서를 본다).
                  const lockedAsApprover = mode === "ref" && approvers.includes(c.id);
                  const full = !isSelected && selected.length >= max;
                  return (
                    <li key={c.id} className="divide-line">
                      <button
                        type="button"
                        onClick={() => onToggle(c.id)}
                        disabled={lockedAsApprover || full}
                        title={
                          lockedAsApprover
                            ? "결재선에 있는 사람은 참조로 지정할 수 없습니다"
                            : full
                              ? `최대 ${max}명까지 지정할 수 있습니다`
                              : undefined
                        }
                        className="hover:bg-bg-soft flex w-full items-center justify-between px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <span className="min-w-0">
                          <span className="text-foreground text-sm font-medium">{c.name}</span>
                          {c.jobTitle ? (
                            <span className="text-text-faint ml-1.5 text-xs">{c.jobTitle}</span>
                          ) : null}
                          {lockedAsApprover ? (
                            <span className="text-text-faint ml-1.5 text-xs">결재선에 있음</span>
                          ) : null}
                        </span>
                        {isSelected ? (
                          <span className="text-primary shrink-0">
                            <EyIcon name="check" size={15} />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          {/* 오른쪽 — 결재 순서(결재자 모드만): 여기서 ↑↓·제거로 결재선을 완성한다. */}
          {twoPane ? (
            <div className="flex min-h-0 flex-col">
              <p className="micro pt-2.5">결재 순서</p>
              <ol className="border-line mt-2 flex-1 divide-y overflow-y-auto rounded-lg border">
                {approvers.length === 0 ? (
                  <li className="text-text-faint px-3 py-6 text-center text-xs">
                    왼쪽에서 결재자를 고르세요
                  </li>
                ) : (
                  approvers.map((id, i) => {
                    const person = byId.get(id);
                    return (
                      <li key={id} className="divide-line flex items-center gap-2 px-2.5 py-2">
                        <span className="text-text-dim w-[52px] shrink-0 text-xs">
                          {i + 1}차 {roles[i]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground block truncate text-sm font-medium">
                            {person?.name ?? "(알 수 없음)"}
                          </span>
                          {person?.jobTitle ? (
                            <span className="text-text-faint block truncate text-xs">
                              {person.jobTitle}
                            </span>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onMove(i, -1)}
                            disabled={i === 0}
                            className="text-text-faint hover:text-foreground disabled:opacity-30"
                            aria-label={`${person?.name ?? ""} 순서 위로`}
                          >
                            <EyIcon name="chevronUp" size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onMove(i, 1)}
                            disabled={i === approvers.length - 1}
                            className="text-text-faint hover:text-foreground disabled:opacity-30"
                            aria-label={`${person?.name ?? ""} 순서 아래로`}
                          >
                            <EyIcon name="chevronDown" size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(id)}
                            className="text-text-faint hover:text-danger"
                            aria-label={`${person?.name ?? ""} 결재선에서 제거`}
                          >
                            <EyIcon name="close" size={13} />
                          </button>
                        </span>
                      </li>
                    );
                  })
                )}
              </ol>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * 자주 쓰는 결재선 — 저장(이름) · 불러오기 · 삭제. 팝오버 없이 **칩 나열**.
 * 읽기 권한(`locked`)이면 저장 칸·저장·× 삭제는 그리지 않고(saveLineTemplate·deleteLineTemplate가 같은 판정으로 거절),
 * 불러오기 칩은 잠긴 결재선 칸을 채우는 입력이라 비활성으로만 남긴다.
 */
function TemplateControls({
  templates,
  approvers,
  refs,
  onApply,
  locked,
}: {
  templates: ApprovalLineTemplate[];
  approvers: string[];
  refs: string[];
  onApply: (t: ApprovalLineTemplate) => void;
  locked: boolean;
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
        <span className="text-text-faint text-xs">저장된 결재선이 없습니다</span>
      ) : (
        templates.map((t) => (
          <span
            key={t.id}
            className="border-line bg-card inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-2.5 text-xs"
          >
            <button
              type="button"
              onClick={() => onApply(t)}
              disabled={locked}
              className="text-foreground hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              title={`결재 ${t.approverIds.length}단계${t.refIds.length ? ` · 참조 ${t.refIds.length}명` : ""}`}
            >
              {t.name}
            </button>
            {locked ? null : (
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
            )}
          </span>
        ))
      )}
      {locked ? null : (
      <span className="ml-auto inline-flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="이름 붙여 저장"
          className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-[130px] rounded-lg border px-2.5 py-1 text-xs outline-none transition"
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
      )}
    </div>
  );
}
