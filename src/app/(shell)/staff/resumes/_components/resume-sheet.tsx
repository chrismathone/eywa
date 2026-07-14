"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckSquare, Loader2, Pencil, Save, Square, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { EMPLOYMENT_TYPES, WORKDAYS, type StaffResumeData } from "@/features/staff/resume";
import { saveStaffResume, type ResumeActionState } from "@/features/staff/server/resume-actions";
import { DeleteResumeButton, PrintResumeButton } from "./resume-buttons";

// 종이 서식("인재원 이력서") 레이아웃을 재현한 시트 — 읽기(뷰) ↔ 인라인 편집(칸에 바로 타이핑) 한 컴포넌트.
// 화면·A4 인쇄 공용. "수정"을 누르면 별도 폼으로 넘어가지 않고 이 종이 칸들이 그대로 입력칸이 된다(WYSIWYG).

// 인쇄(print:)는 A4 1장에 들어가게 압축 — 화면은 여유 있게.
const T = "w-full border-collapse text-[12px] leading-relaxed print:text-[11px] print:leading-snug";
const cell = "border-foreground/35 border px-2 py-1.5 align-middle print:py-1";
// 화면(모바일)에선 헤더가 keep-all로 어절 단위 접혀 표가 카드폭에 수용됨. 인쇄만 nowrap(A4는 폭 여유).
const head = `${cell} bg-bg-soft/70 text-center font-semibold print:whitespace-nowrap`;
const inputBase =
  "w-full min-w-0 rounded-sm bg-bg-soft/40 px-1.5 py-0.5 text-[12px] outline-none placeholder:text-text-faint/60 focus:bg-primary-soft/25 focus:ring-1 focus:ring-primary/50";

const V = (s: string) => s || " ";

function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground mt-5 mb-1.5 text-[13px] font-bold print:mt-3 print:text-[12px]">{children}</h2>;
}

function EditInput({
  name,
  defaultValue,
  placeholder,
  type = "text",
  align = "left",
  className = "",
}: {
  name: string;
  defaultValue: string;
  placeholder?: string;
  type?: string;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  const a = align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      type={type}
      className={`${inputBase} ${a} ${className}`}
    />
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

export function ResumeSheet({
  data,
  id,
  canWrite = false,
  startEditing = false,
}: {
  data: StaffResumeData;
  id?: string;
  canWrite?: boolean;
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [state, formAction] = useActionState<ResumeActionState, FormData>(saveStaffResume, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  // 근무형태(단일 선택)·근무요일(다중)은 컨트롤드 — 초안 복원 시 onRestore로 rehydrate.
  const [empType, setEmpType] = useState(data.contract.employmentType);
  const [workDays, setWorkDays] = useState<string[]>(data.contract.workDays);

  const draft = useFormDraft({
    scope: id ? `staff-resume:${id}` : "staff-resume:new",
    formRef,
    enabled: editing,
    onRestore: (vals) => {
      setEmpType(vals.c_employmentType ?? "");
      setWorkDays(WORKDAYS.filter((d) => vals[`c_workday_${d.key}`] === "true").map((d) => d.key));
    },
  });
  const clearDraft = draft.clear;
  // 편집 중일 때만 미저장 가드 활성(뷰 모드는 dirty 없음) → 편집 중 창 X 시 확인.
  const { markSaved } = useUnsavedGuard({ formRef, enabled: editing });
  // 저장 성공 확정(nonce) 1회만 처리(#67 가드). 편집 종료(setEditing)는 렌더 중 조정(React 권장 #25 —
  // effect setState 금지 회피, enrollment-assign-dialog 패턴), 부수효과(초안 삭제·네비)는 아래 effect에서.
  const [seenNonce, setSeenNonce] = useState<number | undefined>(undefined);
  if (state?.ok && state.nonce && state.nonce !== seenNonce) {
    setSeenNonce(state.nonce);
    if (id) setEditing(false); // 수정(기존): 뷰로 복귀. 생성은 아래 effect가 새 뷰로 이동(그대로 언마운트).
  }
  const doneNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state?.ok || !state.nonce || state.nonce === doneNonce.current) return;
    doneNonce.current = state.nonce;
    clearDraft();
    markSaved();
    if (id) router.refresh(); // 수정: 배경 서버 데이터 재조회 → 뷰에 반영.
    else if (state.redirectTo) router.push(state.redirectTo); // 생성: 새 이력서 뷰로 이동.
  }, [state, router, clearDraft, markSaved, id]);

  function startEdit() {
    setEmpType(data.contract.employmentType);
    setWorkDays(data.contract.workDays);
    setEditing(true);
  }
  function cancel() {
    if (id) setEditing(false);
    else router.push("/staff?tab=resumes");
  }
  const toggleDay = (key: string) =>
    setWorkDays((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const p = data.personal;
  const c = data.contract;
  const field = (
    name: string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right"; type?: string } = {},
  ) =>
    editing ? (
      <EditInput name={name} defaultValue={value} placeholder={opts.ph} align={opts.align} type={opts.type} />
    ) : (
      <>{V(value)}</>
    );

  const sheet = (
    <div className="resume-sheet border-line bg-card text-foreground mx-auto w-full max-w-[780px] rounded-md border shadow-card p-6 sm:p-8 print:rounded-none print:border-2 print:border-foreground/60 print:shadow-none print:p-3">
      <h1 className="text-center text-[26px] font-bold tracking-[0.6em] print:text-[20px]">이력서</h1>

      <SectionHead>1. 인적사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-28`}>성명</th>
            <td className={cell}>{field("p_name", p.name, { ph: "성명" })}</td>
            <th className={`${head} w-28`}>영문</th>
            <td className={cell}>{field("p_nameEn", p.nameEn, { ph: "영문 이름" })}</td>
          </tr>
          <tr>
            <th className={head}>주민등록번호</th>
            <td className={`${cell} num`} colSpan={3}>
              {field("p_residentId", p.residentId, { ph: "000000-0000000" })}
            </td>
          </tr>
          <tr>
            <th className={head}>주소</th>
            <td className={cell} colSpan={3}>
              {field("p_address", p.address, { ph: "주소" })}
            </td>
          </tr>
          <tr>
            <th className={head}>전화번호</th>
            <td className={`${cell} num`}>{field("p_phone", p.phone, { ph: "010-0000-0000" })}</td>
            <th className={head}>E-mail</th>
            <td className={cell}>{field("p_email", p.email, { ph: "email@example.com", type: "email" })}</td>
          </tr>
        </tbody>
      </table>

      <SectionHead>2. 학력사항</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={`${head} w-36`}>재학 기간</th>
            <th className={head}>학교명</th>
            <th className={head}>전공</th>
            <th className={`${head} w-16`}>학점</th>
            <th className={head}>소재지</th>
          </tr>
        </thead>
        <tbody>
          {data.education.map((r, i) => (
            <tr key={i}>
              <td className={`${cell} num text-center`}>
                {field(`edu_${i}_period`, r.period, { ph: "0000.00 ~ 0000.00", align: "center" })}
              </td>
              <td className={cell}>{field(`edu_${i}_school`, r.school, { ph: "학교명" })}</td>
              <td className={cell}>{field(`edu_${i}_major`, r.major, { ph: "전공" })}</td>
              <td className={`${cell} text-center`}>{field(`edu_${i}_gpa`, r.gpa, { align: "center" })}</td>
              <td className={cell}>{field(`edu_${i}_location`, r.location, { ph: "소재지" })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>3. 경력사항</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}>직장명</th>
            <th className={`${head} w-36`}>근무 기간</th>
            <th className={head}>담당 업무</th>
            <th className={`${head} w-24`}>월급여</th>
            <th className={head}>퇴직 사유</th>
          </tr>
        </thead>
        <tbody>
          {data.career.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{field(`car_${i}_company`, r.company, { ph: "직장명" })}</td>
              <td className={`${cell} num text-center`}>
                {field(`car_${i}_period`, r.period, { ph: "0000.00 ~ 0000.00", align: "center" })}
              </td>
              <td className={cell}>{field(`car_${i}_duties`, r.duties, { ph: "담당 업무" })}</td>
              <td className={`${cell} num text-right`}>
                {field(`car_${i}_salary`, r.salary, { ph: "월급여", align: "right" })}
              </td>
              <td className={cell}>{field(`car_${i}_leaveReason`, r.leaveReason, { ph: "퇴직 사유" })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>4. 자격증 및 외국어 능력</SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}>자격증 취득사항</th>
            <th className={`${head} w-32`}>취득년월일</th>
            <th className={head}>발행처</th>
          </tr>
        </thead>
        <tbody>
          {data.certificates.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{field(`cert_${i}_name`, r.name, { ph: "자격증명" })}</td>
              <td className={`${cell} num text-center`}>
                {field(`cert_${i}_date`, r.date, { ph: "취득년월일", align: "center" })}
              </td>
              <td className={cell}>{field(`cert_${i}_issuer`, r.issuer, { ph: "발행처" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={`${T} mt-2`}>
        <thead>
          <tr>
            <th className={head}>외국어 능력</th>
            <th className={`${head} w-32`}>시험일</th>
            <th className={head}>점수/등급</th>
          </tr>
        </thead>
        <tbody>
          {data.languages.map((r, i) => (
            <tr key={i}>
              <td className={cell}>{field(`lang_${i}_name`, r.name, { ph: "외국어 (시험명)" })}</td>
              <td className={`${cell} num text-center`}>
                {field(`lang_${i}_testDate`, r.testDate, { ph: "시험일", align: "center" })}
              </td>
              <td className={`${cell} text-center`}>
                {field(`lang_${i}_score`, r.score, { ph: "점수/등급", align: "center" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead>5. 계약사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}>근무부서</th>
            <td className={cell} colSpan={3}>
              {field("c_department", c.department, { ph: "근무부서" })}
            </td>
          </tr>
          <tr>
            <th className={head}>근무요일</th>
            <td className={cell} colSpan={3}>
              {editing
                ? WORKDAYS.map((d) => (
                    <label key={d.key} className="mr-3 inline-flex cursor-pointer items-center gap-1 select-none">
                      <input
                        type="checkbox"
                        name={`c_workday_${d.key}`}
                        value="1"
                        checked={workDays.includes(d.key)}
                        onChange={() => toggleDay(d.key)}
                        className="sr-only"
                      />
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        {workDays.includes(d.key) ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                        {d.label}
                      </span>
                    </label>
                  ))
                : WORKDAYS.map((d) => (
                    <span key={d.key} className="mr-3 inline-flex items-center gap-1 whitespace-nowrap">
                      {c.workDays.includes(d.key) ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                      {d.label}
                    </span>
                  ))}
            </td>
          </tr>
          <tr>
            <th className={head}>급여 계약</th>
            <td className={cell} colSpan={3}>
              {editing ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="whitespace-nowrap">(월급)</span>
                  <span className="min-w-[8rem] flex-1">
                    <EditInput name="c_salaryMonthly" defaultValue={c.salaryMonthly} placeholder="예: 2,800,000원" />
                  </span>
                  <span className="whitespace-nowrap">(연봉)</span>
                  <span className="min-w-[8rem] flex-1">
                    <EditInput name="c_salaryAnnual" defaultValue={c.salaryAnnual} placeholder="연봉" />
                  </span>
                </span>
              ) : (
                <>
                  (월급) {c.salaryMonthly || "      "} &nbsp;&nbsp; (연봉) {c.salaryAnnual || " "}
                </>
              )}
            </td>
          </tr>
          <tr>
            <th className={head}>근무형태</th>
            <td className={cell} colSpan={3}>
              <input type="hidden" name="c_employmentType" value={editing ? empType : ""} />
              {editing
                ? EMPLOYMENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEmpType((prev) => (prev === t ? "" : t))}
                      className="mr-3 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap"
                    >
                      {t === empType ? "■" : "□"} {t}
                    </button>
                  ))
                : EMPLOYMENT_TYPES.map((t) => (
                    <span key={t} className="mr-3 whitespace-nowrap">
                      {t === c.employmentType ? "■" : "□"} {t}
                    </span>
                  ))}
            </td>
          </tr>
          <tr>
            <th className={head}>계좌번호</th>
            <td className={`${cell} num`} colSpan={3}>
              {editing ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-[10rem] flex-[2]">
                    <EditInput name="c_account" defaultValue={c.account} placeholder="계좌번호" />
                  </span>
                  <span className="min-w-[6rem] flex-1">
                    <EditInput name="c_bank" defaultValue={c.bank} placeholder="은행명" />
                  </span>
                </span>
              ) : (
                <>
                  {V(c.account)} {c.bank ? `(${c.bank})` : "(은행)"}
                </>
              )}
            </td>
          </tr>
          <tr>
            <th className={head}>입사일</th>
            <td className={`${cell} num`} colSpan={3}>
              {field("c_startDate", c.startDate, { type: "date" })}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const toolbar = (
    <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
      <p className="text-text-dim text-xs">
        {editing ? "칸을 클릭해 바로 입력하세요 — 저장해야 반영됩니다." : "종이 서식 그대로 — 인쇄하거나 수정할 수 있습니다."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {/* 편집 중 취소/저장은 하단 고정 FormActionBar로(다른 창 폼과 동일 위치). 뷰 모드 액션만 여기. */}
        {editing ? null : (
          <>
            {canWrite ? (
              <Button type="button" onClick={startEdit}>
                <Pencil className="size-4" />
                수정
              </Button>
            ) : null}
            <PrintResumeButton />
            {canWrite && id ? <DeleteResumeButton id={id} name={p.name} /> : null}
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
      {state?.error ? (
        <p className="text-danger flex items-center gap-1.5 text-sm">
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {sheet}
      <FormActionBar>
        <Button type="button" variant="outline" onClick={cancel}>
          <X className="size-4" />
          취소
        </Button>
        <SaveButton />
      </FormActionBar>
    </form>
  );
}
