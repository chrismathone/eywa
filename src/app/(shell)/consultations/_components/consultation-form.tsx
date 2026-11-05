"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { kstDateTimeLocal } from "@/lib/date-kst";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2, Save } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { FORM_PARAM, formDraftScope, recordingSince } from "@/lib/recording-resume";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { EditingBanner } from "@/features/presence/editing-badge";
import {
  createStudentConsultation,
  updateStudentConsultation,
  type ConsultationFormState,
} from "@/features/consultations/server/actions";
import type {
  StudentConsultationAudience,
  StudentConsultationCategory,
  StudentOption,
} from "@/features/consultations/server/queries";
import type { TeacherOption } from "@/features/students/server/queries";
import type { ConsultationTemplate } from "@/features/owner/settings-types";
import { fillTemplate, formatConsultDate, type TemplateVars } from "@/features/consultations/template-vars";
import type { NewcomerLinkTarget } from "@/features/newcomers/consult-link";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import { NewcomerLinkField } from "./newcomer-link-field";
import { ConsultationClassField } from "./class-field";

type Mode = "create" | "edit";

export type ConsultationFormValue = {
  id?: string;
  studentId: string;
  counselorId: string | null;
  consultedAt: string; // ISO
  category: StudentConsultationCategory | null;
  subject: string | null;
  audience: StudentConsultationAudience | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  /** 반 매핑(0318a) — 저장된 반·출처. 출처가 manual이면 폼도 '직접 고름'으로 연다. */
  classId?: string | null;
  className?: string | null;
  classSource?: "auto" | "manual" | null;
};

const CATEGORY_OPTIONS: { value: StudentConsultationCategory; label: string }[] = [
  { value: "general", label: "일반" },
  { value: "academic", label: "학습/성적" },
  { value: "emotional", label: "정서/심리" },
  { value: "career", label: "진로" },
  { value: "social", label: "교우관계" },
  { value: "other", label: "기타" },
];

const AUDIENCE_OPTIONS: { value: StudentConsultationAudience; label: string }[] = [
  { value: "parent", label: "학부모" },
  { value: "student", label: "학생" },
  { value: "both", label: "학부모+학생" },
];

/** datetime-local 기본값 — **KST 지금**(런타임 시간대로 만들면 SSR과 브라우저가 9시간 어긋난다). */
const nowLocalIso = (): string => kstDateTimeLocal();

/**
 * 저장된 절대시각 → `datetime-local` 입력 값. 🔴 **KST로 읽는다** — 런타임 로컬 게터로 풀면 서버(UTC)
 * 렌더에서 9시간 이른 시각이 폼에 박히고, 사용자가 손대지 않고 저장하면 그 값이 그대로 들어간다.
 */
const isoToLocal = (iso: string): string =>
  // 🔴 시간대가 **붙은** 값(DB의 timestamptz)만 KST로 푼다. 새 상담 기본값(nowLocalIso)은 이미 KST 벽시계라
  //    `new Date()`로 다시 읽으면 서버(UTC)가 그 벽시계를 UTC로 읽어 9시간 뒤가 박혔다(감사 F12).
  /T.*(Z|[+-]\d{2}(:?\d{2})?)$/.test(iso) ? kstDateTimeLocal(new Date(iso)) : iso.slice(0, 16);

function SubmitButton({ mode }: { mode: Mode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "등록" : "저장"}
    </Button>
  );
}

export function ConsultationForm({
  mode,
  initialValue,
  students,
  counselors,
  subjectLabels,
  currentUserId,
  templates,
  currentUserName,
  newcomerTargets,
  classSupported = false,
  readOnly = false,
}: {
  mode: Mode;
  initialValue?: ConsultationFormValue;
  students: StudentOption[];
  counselors: TeacherOption[];
  subjectLabels: Record<string, string>;
  currentUserId: string;
  /** 상담 양식(테넌트 공용) — 등록(create) 모드에서만 양식 선택기로 소비. 기본양식은 요약을 프리필. */
  templates?: ConsultationTemplate[];
  /** 현재 로그인 사용자 표시명 — 상담사 "본인" 선택 시 {{담당}} 태그 치환값. */
  currentUserName?: string;
  /** 90일 관리 신규생(0295a 반자동) — 고른 학생이 여기 있으면 '신규생 관리' 칸을 그린다. */
  newcomerTargets?: NewcomerLinkTarget[];
  /** 0318a(반 칸)가 DB에 있나 — 없으면 '반' 칸을 그리지 않는다([[#95]]). */
  classSupported?: boolean;
  /**
   * 원생상담 **읽기 권한**(서버 게이트와 같은 `canWriteTenant(…,"consultations")`를 page가 계산) — 칸은 전부 비활성 +
   * 권한 안내 placeholder, 저장 단추는 그리지 않는다. 초안 자동저장·동시편집 표시도 켜지 않는다(원장 2026-11-05 — 양식을 다 쓴 뒤에야
   * "권한이 없습니다"가 뜨지 않게, src/lib/write-lock.ts).
   */
  readOnly?: boolean;
}) {
  const action = mode === "create" ? createStudentConsultation : updateStudentConsultation;
  const [state, formAction] = useActionState<ConsultationFormState, FormData>(action, undefined);
  const router = useRouter();
  // 작성 화면 한 벌(`form`) — 페이지가 이 값으로 폼을 새로 그린다(recording-resume.ts · gotchas #146).
  const formId = useSearchParams()?.get(FORM_PARAM) ?? undefined;

  const v: ConsultationFormValue = initialValue ?? {
    studentId: "",
    counselorId: null,
    consultedAt: nowLocalIso(),
    category: "general",
    subject: null,
    audience: "parent",
    summary: "",
    followUpAction: null,
    followUpDate: null,
    followUpDone: false,
  };
  const subjectFor = (counselorId: string | null) => {
    const counselor = counselors.find((c) => c.id === (counselorId || currentUserId));
    const subjects = counselor?.subjects ?? [];
    return subjects.length === 1 ? subjectLabels[subjects[0]] ?? subjects[0] : "";
  };
  const initialAutoSubject = v.subject ? "" : subjectFor(v.counselorId);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastAutoSubject = useRef(
    v.subject && v.subject === subjectFor(v.counselorId) ? v.subject : initialAutoSubject,
  );

  // 신규생 관리 칸이 보는 값 — 나머지 입력은 uncontrolled라 바뀔 때만 따로 붙잡는다.
  const [linkStudentId, setLinkStudentId] = useState(v.studentId);
  const [linkConsultedAt, setLinkConsultedAt] = useState(isoToLocal(v.consultedAt || nowLocalIso()));
  const [linkSubject, setLinkSubject] = useState(v.subject ?? initialAutoSubject);
  const [linkCounselorId, setLinkCounselorId] = useState(v.counselorId ?? "");
  // 🔴 일시·과목은 uncontrolled라 **폼이 스스로 값을 바꾸는** 두 경우를 React onChange가 못 본다 — 초안 복구
  //    (값을 넣고 이벤트를 쏘면 React 값 추적기가 삼킨다)와 제출 뒤 자동 리셋([[#83]]). 그래서 폼의 네이티브
  //    이벤트로 DOM을 다시 읽는다. 리셋이면 칸도 다시 마운트해(사람이 고른 값 포함) 화면과 제출값을 맞춘다.
  const [linkResetKey, setLinkResetKey] = useState(0);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const read = () => {
      const val = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
      setLinkConsultedAt(val("consultedAt"));
      setLinkSubject(val("subject"));
      setLinkCounselorId(val("counselorId"));
    };
    const onReset = () => {
      // reset 이벤트는 값이 돌아가기 **전에** 온다 — 한 틱 뒤에 읽는다.
      setTimeout(read, 0);
      setLinkResetKey((k) => k + 1);
    };
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    form.addEventListener("reset", onReset);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
      form.removeEventListener("reset", onReset);
    };
  }, []);
  const linkTarget = newcomerTargets?.find((t) => t.studentId === linkStudentId);
  const linkSubjectKey =
    Object.entries(subjectLabels).find(([key, label]) => label === linkSubject.trim() || key === linkSubject.trim())?.[0] ??
    null;
  const linkCounselorSubjects =
    counselors.find((c) => c.id === (linkCounselorId || currentUserId))?.subjects ?? [];

  function onCounselorChange(nextId: string) {
    setLinkCounselorId(nextId);
    const field = subjectRef.current;
    if (!field || (field.value && field.value !== lastAutoSubject.current)) return;
    const next = subjectFor(nextId || null);
    field.value = next;
    setLinkSubject(next);
    lastAutoSubject.current = next;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // 기본양식(등록 모드) — 요약·범주·대상 초기값을 프리필. 초안 복구는 배너(사용자 확인)라 여기 프리필과 충돌 없음.
  const defaultTemplate = mode === "create" ? templates?.find((t) => t.isDefault) : undefined;

  // 양식 치환 태그({{날짜}}·{{담당}}·{{학생}}·{{학년}}) 값 해석 — 상담일시/상담사/학생 선택에서 도출.
  const resolveVars = (consultedAt: string, counselorId: string, studentId: string): TemplateVars => {
    const d = consultedAt ? new Date(consultedAt) : new Date();
    const counselor = counselorId
      ? counselors.find((c) => c.id === counselorId)?.displayName ?? currentUserName
      : currentUserName;
    const st = studentId ? students.find((s) => s.id === studentId) : undefined;
    return {
      date: formatConsultDate(Number.isNaN(d.getTime()) ? new Date() : d),
      counselor: counselor || undefined,
      student: st?.name,
      grade: st?.grade ?? undefined,
    };
  };

  // 마운트 프리필 — DOM 이전이라 props(초기값)에서 태그 치환.
  const initSummary = defaultTemplate
    ? fillTemplate(defaultTemplate.body, resolveVars(v.consultedAt, v.counselorId ?? "", v.studentId))
    : v.summary;
  const initCategory: string = defaultTemplate?.category ?? v.category ?? "general";
  const initAudience: string = defaultTemplate?.audience ?? v.audience ?? "parent";

  // 요약·범주·대상은 uncontrolled(defaultValue) — 양식 선택 시 ref로 값만 주입(초안 훅과 동일한 DOM 모델 유지).
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const audienceRef = useRef<HTMLSelectElement>(null);
  const [templateKey, setTemplateKey] = useState<string>(defaultTemplate?.key ?? "");
  // 마지막으로 주입한(치환 완료) 요약 — 사용자가 그 뒤로 직접 고쳤는지 판정(덮어쓰기 확인)용.
  const lastAppliedRef = useRef<string>(initSummary);

  // 현재 폼 선택값(상담일시·상담사·학생)에서 치환 태그 값 수집.
  const collectVars = (): TemplateVars => {
    const form = formRef.current;
    const val = (name: string) =>
      (form?.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    return resolveVars(val("consultedAt"), val("counselorId"), val("studentId") || v.studentId);
  };

  // 양식 선택 → 요약(+지정된 범주/대상) 주입. 본문의 {{태그}}는 현재 선택값으로 치환. 이전 프리필을 손대지 않았으면
  // 무확인, 사용자가 직접 고친 내용이 있을 때만 덮어쓰기 확인(입력 유실 방지, design-conventions).
  function applyTemplate(key: string) {
    const t = templates?.find((x) => x.key === key);
    const nextBody = fillTemplate(t ? t.body : "", collectVars());
    const cur = summaryRef.current?.value ?? "";
    const dirty = cur.trim() !== "" && cur !== lastAppliedRef.current; // 프리필 이후 사용자가 수정했는가
    if (dirty && cur !== nextBody && !window.confirm("작성 중인 요약을 선택한 양식으로 바꿀까요?")) {
      return; // 취소 — 이전 선택·내용 유지
    }
    setTemplateKey(key);
    if (summaryRef.current) summaryRef.current.value = nextBody;
    lastAppliedRef.current = nextBody;
    if (t?.category && categoryRef.current) categoryRef.current.value = t.category;
    if (t?.audience && audienceRef.current) audienceRef.current.value = t.audience;
    // 자동저장·미저장 가드가 변경을 인지하도록 form에 input 이벤트 발화.
    formRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  const errors = state?.fieldErrors ?? {};

  // 로컬 초안 자동저장 — 요약 등 텍스트 입력 보관, 다시 열면 복구. studentId(SearchableSelect)는 복원 신뢰성이
  // 낮아 제외(복구 후 재선택), 기본값이 항상 채워지는 일시/범주/대상은 빈 폼 오탐 방지로 banner 판정서 제외.
  // ⚠️ scope는 등록상담(consultation:*)과 분리(student-consultation:*) — 안 그러면 두 폼이 IDB 초안을 덮어씀.
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft({
    // 작성 화면 한 벌마다 칸이 따로다(recording-resume.ts) — 이 화면에 걸린 녹음으로 돌아왔으면 그 뒤의 입력을 안내 없이 바로.
    scope: mode === "create" ? formDraftScope("student-consultation:new", formId) : `student-consultation:${initialValue?.id ?? "edit"}`,
    restoreSince: mode === "create" ? () => recordingSince(formId) : undefined,
    formRef,
    // 읽기 권한이면 쓸 수 없는 칸의 초안을 남기거나 되살리지 않는다.
    enabled: !readOnly,
    // 신규생 관리 칸은 학생마다 선택지가 달라 초안으로 되살리면 엉뚱한 칸이 잡힌다.
    // 반(classId·classPick)도 학생·일시에 따라 선택지가 달라 초안으로 되살리지 않는다(자동 판정이 다시 잡는다).
    exclude: ["studentId", "newcomerLink", "newcomerLinkRow", "classId", "classPick"],
    ignoreForBanner: ["consultedAt", "category", "audience"],
  });
  const clearDraft = draft.clear;

  // 동시편집 가드(same-browser 저장경고) + cross-user "수정중" presence(edit 모드).
  // 🔴 읽기 권한은 열기만 해도 남에게 "수정중"으로 뜨지 않게 scope를 넘기지 않는다. 남이 고치는 중이라는 띠는 그대로 본다.
  const editScope = mode === "edit" && initialValue?.id ? `student-consultation:${initialValue.id}` : undefined;
  const { notifySaved } = useConcurrentEditGuard({ scope: readOnly ? undefined : editScope, formRef });
  const { markSaved } = useUnsavedGuard({ formRef, enabled: !readOnly });
  /** 비활성 칸의 안내 — 읽기 권한일 때만(평소 placeholder는 그대로). */
  const locked = (normal?: string) => (readOnly ? writeLockedPlaceholder("consultations") : normal);

  // 저장 성공 확정(nonce) 후에만 초안 삭제 → 이동(B-2). 제출 시점 무조건 clear는 서버 검증 실패 시
  // (학생 미선택·요약 5자 미만 등) 입력이 먼저 사라져 창을 닫으면 복구 불가라 성공 기반으로 전환.
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, router, clearDraft, notifySaved, markSaved]);

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {editScope ? <EditingBanner scope={editScope} /> : null}
      {mode === "edit" && initialValue?.id ? (
        <input type="hidden" name="id" value={initialValue.id} />
      ) : null}
      {/* 값이 차 있는 칸(상담사·일시·대상 등)은 placeholder가 안 보여 한 줄로 알린다. */}
      {readOnly ? <p className="text-muted-foreground text-sm">{writeLockedNote("consultations")}</p> : null}

      {/* 읽기 권한이면 fieldset째 비활성 — 반·신규생 칸처럼 안쪽 부품의 선택·단추까지 한 번에 잠긴다. */}
      <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
      {/* 2단 배치 — 좌: 짧은 메타 필드(컴팩트) / 우: 상담 양식 + 큰 요약(주인공, 창 높이를 채움).
          좁은 창(md 미만)에선 자동으로 세로 1열로 접힘. minmax(0,…)로 그리드 자식 overflow 방지(좁은 창 줄바꿈 깨짐 예방). */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:items-stretch">
        {/* 좌측 — 메타 필드(단일 열) */}
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="학생 *" htmlFor="studentId" error={errors.studentId}>
            <SearchableSelect
              name="studentId"
              defaultValue={v.studentId}
              onValueChange={setLinkStudentId}
              disabled={readOnly}
              placeholder={locked("학생 선택...")}
              searchPlaceholder="학생 이름 검색..."
              options={students.map((s) => ({
                value: s.id,
                label: s.name,
                hint: s.grade ? `(${s.grade})` : undefined,
              }))}
            />
          </Field>
          <Field label="상담사" htmlFor="counselorId">
            <select
              id="counselorId"
              name="counselorId"
              defaultValue={v.counselorId ?? ""}
              onChange={(event) => onCounselorChange(event.target.value)}
              className={inputClass}
            >
              <option value="">본인</option>
              {counselors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="상담 일시 *" htmlFor="consultedAt" error={errors.consultedAt}>
            <input
              id="consultedAt"
              name="consultedAt"
              type="datetime-local"
              defaultValue={isoToLocal(v.consultedAt || nowLocalIso())}
              required
              className={inputClass}
            />
          </Field>
          {/* 대상·범주 — 짧은 select 2개는 좁은 열에서도 나란히(각 ~150px 확보). */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="대상" htmlFor="audience">
              <select
                id="audience"
                name="audience"
                ref={audienceRef}
                defaultValue={initAudience}
                className={inputClass}
              >
                {AUDIENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="범주" htmlFor="category">
              <select
                id="category"
                name="category"
                ref={categoryRef}
                defaultValue={initCategory}
                className={inputClass}
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="과목 (선택)" htmlFor="subject">
            <input
              id="subject"
              name="subject"
              ref={subjectRef}
              defaultValue={v.subject ?? initialAutoSubject}
              placeholder={locked("예: 수학")}
              className={inputClass}
            />
          </Field>
          {classSupported ? (
            <ConsultationClassField
              key={linkStudentId || "none"}
              studentId={linkStudentId}
              consultedAt={linkConsultedAt}
              counselorId={linkCounselorId}
              subject={linkSubject}
              // 원래 학생으로 돌아오면 저장된 선택을 되살린다 — 다른 학생이면 새로 판정한다.
              initialPick={linkStudentId === v.studentId && v.classSource === "manual" ? "manual" : "auto"}
              initialClassId={linkStudentId === v.studentId ? (v.classId ?? null) : null}
              initialClassName={linkStudentId === v.studentId ? (v.className ?? null) : null}
            />
          ) : null}
          {linkTarget ? (
            <NewcomerLinkField
              key={`${linkTarget.studentId}:${linkResetKey}`}
              target={linkTarget}
              consultedOn={linkConsultedAt.slice(0, 10)}
              consultSubjectKey={linkSubjectKey}
              counselorSubjects={linkCounselorSubjects}
              suggest={mode === "create"}
            />
          ) : null}
          {/* 후속 조치 — 구분선으로 본 메타와 분리(영역 구분). */}
          <div className="border-border flex flex-col gap-4 border-t pt-4">
            <Field label="후속 조치" htmlFor="followUpAction">
              <input
                id="followUpAction"
                name="followUpAction"
                defaultValue={v.followUpAction ?? ""}
                placeholder={locked("예: 다음주 화요일 학부모 통화")}
                className={inputClass}
              />
            </Field>
            <Field label="후속 조치 기한" htmlFor="followUpDate">
              <input
                id="followUpDate"
                name="followUpDate"
                type="date"
                defaultValue={v.followUpDate ?? ""}
                className={inputClass}
              />
            </Field>
            <label className="text-foreground inline-flex items-center gap-2 text-sm break-keep">
              <input
                type="checkbox"
                name="followUpDone"
                value="true"
                defaultChecked={v.followUpDone}
                className="size-4 shrink-0"
              />
              후속 조치 완료
            </label>
          </div>
        </div>

        {/* 우측 — 상담 양식 선택기 + 요약(창 높이를 채우는 주인공). 좁은 창에선 좌측 아래로 접힘. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 md:h-full">
          {/* 상담 양식(등록 모드) — 기본양식은 요약을 자동 프리필. 다른 양식·'무양식'으로 변경 가능. */}
          {mode === "create" && templates && templates.length > 0 ? (
            <Field label="상담 양식" htmlFor="__template">
              <select
                id="__template"
                value={templateKey}
                onChange={(e) => applyTemplate(e.target.value)}
                className={inputClass}
              >
                <option value="">무양식 (빈 요약으로 시작)</option>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            <label htmlFor="summary" className="text-foreground block text-sm font-medium break-keep">
              요약 *
            </label>
            <textarea
              id="summary"
              name="summary"
              ref={summaryRef}
              defaultValue={initSummary}
              required
              placeholder={locked("상담 내용 요약")}
              className={`${inputClass} min-h-[18rem] flex-1 resize-y break-keep`}
            />
            {errors.summary ? <p className="text-chart-4 text-xs">{errors.summary}</p> : null}
          </div>
        </div>
      </div>
      </fieldset>

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      {readOnly ? null : (
        <FormActionBar>
          <SubmitButton mode={mode} />
        </FormActionBar>
      )}
    </form>
  );
}

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-foreground block text-sm font-medium break-keep">
        {label}
      </label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
