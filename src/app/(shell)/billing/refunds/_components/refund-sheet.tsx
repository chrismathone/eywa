"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2, Pencil, Save, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import {
  APPROVAL_SLOTS,
  REFUND_DRAFT_EXCLUDE,
  REFUND_METHODS,
  type RefundRequestData,
} from "@/features/billing/refund-request";
import { saveRefundRequest, type RefundActionState } from "@/features/billing/server/refund-actions";
import { DeleteRefundButton, PrintRefundButton } from "./refund-buttons";
import { RefundStudentPicker } from "./refund-student-picker";

// 종이 서식("환불처리요청서") 레이아웃을 재현한 시트 — 읽기(뷰) ↔ 인라인 편집 한 컴포넌트(WYSIWYG).
// 화면·A4 인쇄 공용. 직원 이력서(resume-sheet) 패턴 — 전 필드가 plain input/textarea라 초안 자동복원도 DOM 캡처만으로 완결.

const T = "w-full border-collapse text-[12px] leading-relaxed print:text-[11px] print:leading-snug";
const cell = "border-foreground/35 border px-2 py-1.5 align-middle print:py-1";
const head = `${cell} bg-bg-soft/70 text-center font-bold whitespace-nowrap`;
const inputBase =
  "w-full min-w-0 rounded-sm bg-bg-soft/40 px-1.5 py-0.5 text-[12px] outline-none placeholder:text-text-faint/60 focus:bg-primary-soft/25 focus:ring-1 focus:ring-primary/50";

const V = (s: string) => s || " ";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

export function RefundSheet({
  data,
  id,
  userId,
  canWrite = false,
  startEditing = false,
  completionLock = null,
}: {
  data: RefundRequestData;
  id?: string;
  /** 초안 스코프 격리용 — 공용 PC에서 다른 사람의 초안이 복구 제안되지 않게 한다. */
  userId: string;
  canWrite?: boolean;
  startEditing?: boolean;
  /**
   * 환불완료일자 잠금 사유(원장 2026-11-06) — 퇴원보고서에 이어진 요청서는 그 데스크 담당과 원장만 넣거나 지운다. 잠기면 수정 중에도 칸 대신
   * 지금 값과 사유를 보이고, 같은 값을 숨은 칸으로 보낸다(저장해도 바뀌지 않는다 · 서버 저장 액션·DB 트리거가 다시 막는다).
   */
  completionLock?: string | null;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [state, formAction] = useActionState<RefundActionState, FormData>(saveRefundRequest, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const draft = useFormDraft({
    // 스코프에 userId 포함 — 사무실 공용 PC에서 앞사람 초안이 뒷사람에게 복구 제안되면 안 된다.
    scope: `billing-refund:${userId}:${id ?? "new"}`,
    formRef,
    enabled: editing,
    // 계좌·카드정보·주소는 IDB에 아예 안 남긴다 — 복구 시 그 칸만 비어 있다.
    exclude: REFUND_DRAFT_EXCLUDE,
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 1회만 처리(#67 가드). 편집 종료(setEditing)는 렌더 중 조정(#25 회피),
  // 부수효과(초안 삭제·네비)만 아래 effect에서 — resume-sheet와 동일 패턴.
  const [seenNonce, setSeenNonce] = useState<number | undefined>(undefined);
  if (state?.ok && state.nonce && state.nonce !== seenNonce) {
    setSeenNonce(state.nonce);
    if (id) setEditing(false); // 수정(기존): 뷰로 복귀. 생성은 아래 effect가 새 뷰로 이동.
  }
  const doneNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state?.ok || !state.nonce || state.nonce === doneNonce.current) return;
    doneNonce.current = state.nonce;
    clearDraft();
    if (id) router.refresh(); // 수정: 서버 데이터 재조회 → 뷰에 반영.
    else if (state.redirectTo) router.push(state.redirectTo); // 생성: 새 요청서 뷰로 이동.
  }, [state, router, clearDraft, id]);

  function cancel() {
    // 취소 = 명시적 폐기 → 초안도 함께 비운다(창 X는 미저장 가드가 잡고, 그땐 초안이 남아 이어쓰기 가능).
    clearDraft();
    if (id) setEditing(false);
    else router.push("/billing?tab=refunds");
  }

  const s = data.student;
  const r = data.refund;
  const res = data.result;

  const field = (
    name: string,
    value: string,
    opts: { label: string; ph?: string; type?: string; align?: "left" | "center"; required?: boolean },
  ) =>
    editing ? (
      <input
        name={name}
        defaultValue={value}
        placeholder={opts.ph}
        type={opts.type ?? "text"}
        required={opts.required}
        aria-label={opts.label}
        aria-required={opts.required ? true : undefined}
        className={`${inputBase} ${opts.align === "center" ? "text-center" : ""}`}
      />
    ) : (
      <>{V(value)}</>
    );

  const areaField = (name: string, value: string, rows: number, label: string, ph?: string) =>
    editing ? (
      <textarea
        name={name}
        defaultValue={value}
        rows={rows}
        placeholder={ph}
        aria-label={label}
        className={`${inputBase} resize-y`}
      />
    ) : (
      <div className="min-h-[1.5em] whitespace-pre-wrap">{V(value)}</div>
    );

  const sheet = (
    <div className="paper-scale border-line bg-card text-foreground mx-auto w-full max-w-[780px] rounded-2xl border p-6 shadow-card sm:p-8 print:rounded-none print:border-2 print:border-foreground/60 print:p-3 print:shadow-none">
      {/* 상단 — 제목 + 결재란(담당/부원장/원장) */}
      <table className={T}>
        <tbody>
          <tr>
            <td className={`${cell} w-[46%] border-2 text-center`} rowSpan={2}>
              <span className="text-[24px] font-bold tracking-[0.3em] print:text-[19px]">환불처리요청서</span>
            </td>
            <th className={`${head} w-14`} rowSpan={2}>
              결재
            </th>
            {APPROVAL_SLOTS.map((a) => (
              <th key={a.key} className={head}>
                {a.label}
              </th>
            ))}
          </tr>
          <tr>
            {APPROVAL_SLOTS.map((a) => (
              <td key={a.key} className={`${cell} h-16 text-center align-bottom`}>
                {editing ? (
                  <input
                    name={`a_${a.key}`}
                    defaultValue={data.approval[a.key]}
                    placeholder="(서명)"
                    aria-label={`${a.label} 서명`}
                    className={`${inputBase} text-center`}
                  />
                ) : (
                  V(data.approval[a.key])
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* 학생 정보 */}
      <table className={`${T} mt-4 print:mt-2`}>
        <tbody>
          <tr>
            <th className={`${head} w-20`} rowSpan={10}>
              학생 정보
            </th>
            <th className={`${head} w-28`}>
              이 름{editing ? <span className="text-danger"> *</span> : null}
            </th>
            <td className={cell}>{field("s_name", s.name, { label: "이름", ph: "학생 이름", required: true })}</td>
          </tr>
          <tr>
            <th className={head}>학교/학년</th>
            <td className={cell}>{field("s_schoolGrade", s.schoolGrade, { label: "학교/학년", ph: "예: 경명중 2" })}</td>
          </tr>
          <tr>
            <th className={head}>주소</th>
            <td className={cell}>{field("s_address", s.address, { label: "주소" })}</td>
          </tr>
          <tr>
            <th className={head}>환불사유</th>
            <td className={cell}>{areaField("s_reason", s.reason, 5, "환불사유", "환불 사유를 입력하세요")}</td>
          </tr>
          <tr>
            <th className={head}>담임선생님</th>
            <td className={cell}>{field("s_homeroomTeacher", s.homeroomTeacher, { label: "담임선생님" })}</td>
          </tr>
          <tr>
            <th className={head}>수강반</th>
            <td className={cell}>{areaField("s_className", s.className, 2, "수강반")}</td>
          </tr>
          <tr>
            <th className={head}>담당선생님</th>
            <td className={cell}>{field("s_staffTeacher", s.staffTeacher, { label: "담당선생님" })}</td>
          </tr>
          <tr>
            <th className={head}>수업날짜</th>
            <td className={`${cell} num`}>{field("s_classDate", s.classDate, { label: "수업날짜", ph: "예: 2026-06-01 ~ 06-30" })}</td>
          </tr>
          <tr>
            <th className={head}>총수업횟수</th>
            <td className={`${cell} num`}>{field("s_totalSessions", s.totalSessions, { label: "총수업횟수", ph: "예: 12회" })}</td>
          </tr>
          <tr>
            <th className={head}>환불요청일자</th>
            <td className={`${cell} num`}>{field("s_requestDate", s.requestDate, { label: "환불요청일자", type: "date" })}</td>
          </tr>
        </tbody>
      </table>

      {/* 환불내역 */}
      <table className={`${T} mt-4 print:mt-2`}>
        <tbody>
          <tr>
            <th className={`${head} w-20`} rowSpan={6}>
              환불내역
            </th>
            <th className={`${head} w-28`}>결제내역</th>
            <td className={cell} colSpan={2}>
              {/* 자동입력이 월×항목별로 줄을 만들어 길다 — 8줄 기본(더 길면 resize-y로 늘린다). */}
              {areaField("r_paymentDetails", r.paymentDetails, 8, "결제내역", "결제 내역(월·금액·결제수단 등)")}
            </td>
          </tr>
          <tr>
            <th className={head}>미환불금액</th>
            <td className={cell} colSpan={2}>
              {areaField("r_deductionDetails", r.deductionDetails, 4, "미환불금액", "미환불금액(수강 회차·교재비 등)")}
            </td>
          </tr>
          <tr>
            <th className={head}>총 환불금액</th>
            <td className={`${cell} num font-bold`} colSpan={2}>
              {field("r_totalAmount", r.totalAmount, { label: "총 환불금액", ph: "예: 200,000원" })}
            </td>
          </tr>
          {REFUND_METHODS.map((m, i) => (
            <tr key={m.key}>
              {i === 0 ? (
                <th className={head} rowSpan={REFUND_METHODS.length}>
                  환불방식
                </th>
              ) : null}
              <th className={`${head} w-28`}>{m.label}</th>
              <td className={`${cell} num`}>
                {field(`m_${m.key}`, r.method[m.key], { label: m.label, ph: m.key === "account" ? "은행·계좌번호" : "" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 처리결과 */}
      <table className={`${T} mt-4 print:mt-2`}>
        <tbody>
          <tr>
            <th className={`${head} w-20`} rowSpan={5}>
              처리결과
            </th>
            <th className={`${head} w-28`}>환불처리일자</th>
            <td className={`${cell} num`}>{field("res_processedDate", res.processedDate, { label: "환불처리일자", type: "date" })}</td>
          </tr>
          <tr>
            <th className={head}>전산처리여부</th>
            <td className={cell}>{field("res_systemProcessed", res.systemProcessed, { label: "전산처리여부", ph: "예: 완료 / 미처리" })}</td>
          </tr>
          <tr>
            <th className={head}>담당자</th>
            <td className={cell}>{field("res_manager", res.manager, { label: "담당자" })}</td>
          </tr>
          <tr>
            <th className={head}>환불완료일자</th>
            <td className={`${cell} num`}>
              {editing && completionLock ? (
                <>
                  <input type="hidden" name="res_completedDate" value={res.completedDate} />
                  {V(res.completedDate)}
                  <span className="text-text-faint mt-0.5 block text-[11px] print:hidden">{completionLock}</span>
                </>
              ) : (
                field("res_completedDate", res.completedDate, { label: "환불완료일자", type: "date" })
              )}
            </td>
          </tr>
          <tr>
            {/* 완료 처리자 = 환불완료일자 저장 시 서버가 자동 기록(읽기 전용, 위조 불가) */}
            <th className={head}>완료 처리자</th>
            <td className={cell}>
              {res.completedByName ? (
                V(res.completedByName)
              ) : editing ? (
                <span className="text-text-faint text-[11px] print:hidden">
                  환불완료일자를 입력·저장하면 자동 기록됩니다
                </span>
              ) : (
                V("")
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <p className="text-text-dim text-xs">
        {editing ? (
          <>
            칸을 클릭해 바로 입력하세요 — <span className="text-danger">*</span>는 필수, 저장해야 반영됩니다.
          </>
        ) : (
          // 읽기 권한에겐 '수정'이 없다 — 할 수 없는 일을 안내하지 않는다(원장 2026-11-05).
          canWrite ? "종이 서식 그대로 — 인쇄하거나 수정할 수 있습니다." : "종이 서식 그대로 — 인쇄할 수 있습니다."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button type="button" variant="outline" onClick={cancel}>
              <X className="size-4" />
              취소
            </Button>
            <SaveButton />
          </>
        ) : (
          <>
            {canWrite ? (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
                수정
              </Button>
            ) : null}
            <PrintRefundButton />
            {canWrite && id ? <DeleteRefundButton id={id} name={s.name} /> : null}
          </>
        )}
      </div>
    </div>
  );

  if (!editing) {
    return (
      <div className="space-y-4">
        {toolbar}
        {sheet}
      </div>
    );
  }

  return (
    <form action={formAction} ref={formRef} className="space-y-4">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {toolbar}
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      <RefundStudentPicker formRef={formRef} />
      {state?.error ? (
        <p className="text-danger flex items-center gap-1.5 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {sheet}
    </form>
  );
}
