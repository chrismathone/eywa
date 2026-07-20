"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, AlertTriangle, ArrowRight, Banknote, BookOpen, Bus, Cake, Calendar,
  CheckCircle, ChevronDown, ChevronRight, Globe, GraduationCap, Hash, Home, Languages,
  MapPin, MessageSquare, Mic, Save, School, Sparkles, Tag, Target, Users, User, UserCheck, XCircle,
  Droplet, type LucideIcon,
} from "@/components/icons/eywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { useGradeLevels, useSubjectMaps } from "@/features/owner/operations-context";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { EditingBanner } from "@/features/presence/editing-badge";
import type { IntakeChecklist } from "@/features/enrollment/intake-checklist";
import { ChecklistView } from "./checklist-view";
import { AudioRecorderField } from "./audio-recorder-field";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  createEnrollmentConsultation,
  updateEnrollmentConsultation,
} from "@/features/enrollment/server/actions";
import {
  BLOOD_OPTIONS,
  COMMON_FIELDS,
  CONSULTATION_PATHS,
  ENGLISH_GROUPS,
  ENGLISH_TEST_TYPES,
  GENDER_OPTIONS,
  REGISTRATION_STATUSES,
  RELATION_OPTIONS,
  SIBLINGS_OPTIONS,
  SUBJECT_TABS,
  type FieldGroup,
  type SubjectDetails,
} from "@/features/enrollment/form-config";

// 컴팩트 입력(ijw 밀도) — eywa 토큰. 카드/라벨/그리드는 아래 헬퍼로 통일.
const input =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

// 기존 녹음 "마지막 M/D HH:mm" 라벨 — KST 고정(서버/클라 하이드레이션 일치).
const KST_REC_LABEL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export type ConsultationFormInitial = {
  id?: string;
  prospectName?: string | null;
  prospectGrade?: string | null;
  prospectSchool?: string | null;
  englishName?: string | null;
  gender?: string | null;
  bloodType?: string | null;
  birthDate?: string | null;
  studentPhone?: string | null;
  homePhone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentRelation?: string | null;
  address?: string | null;
  zipCode?: string | null;
  addressDetail?: string | null;
  consultationPath?: string | null;
  subject?: string | null;
  careerGoal?: string | null;
  siblings?: string | null;
  safetyNotes?: string | null;
  registrationStatus?: string | null;
  paymentAmount?: string | null;
  paymentDate?: string | null;
  registrar?: string | null;
  followUpDate?: string | null;
  followUpContent?: string | null;
  nonRegistrationReason?: string | null;
  parentRequest?: string | null;
  shuttleBusRequest?: boolean;
  privacyAgreement?: boolean;
  installmentAgreement?: boolean;
  subjectDetails?: SubjectDetails | null;
  /** QR 공개접수 2단계에서 학부모가 낸 사전 체크리스트(0109a). 있으면 읽기 전용 탭으로 보여준다. */
  intakeChecklist?: IntakeChecklist | null;
  // 완전 이식(0064a)
  counselor?: string | null;
  receivedDate?: string | null;
  studentType?: string | null;
  siblingsDetails?: string | null;
  consultationDate?: string | null;
  prevAcademy?: string | null;
  lastScore?: string | null;
};

export function ConsultationFullForm({
  mode,
  initial,
  aiSuggestedParentRequest,
  existingRecordings = [],
  confirmConsultedOnSave = false,
}: {
  mode: "create" | "edit";
  initial?: ConsultationFormInitial;
  /** 녹음 분석이 추출한 상담 내용 — 이미 입력값이 있어 자동입력에서 버려진 버전. 있으면 '✨ AI 제안'으로 비파괴 제시. */
  aiSuggestedParentRequest?: string | null;
  /** 이미 등록된 녹음 행(수정 모드) — 새 녹음이 "덮어쓰기"가 아니라 "추가"임을 명시하는 표시용. */
  existingRecordings?: { createdAt: string; status: string }[];
  /** QR 접수 + 대기·예약 건(수정 모드) — 저장 시 "상담 완료로 변경?" 확인 팝업을 띄운다(서버도 조건 재검증). */
  confirmConsultedOnSave?: boolean;
}) {
  const subjects = useSubjectMaps();
  const gradeLevels = useGradeLevels();
  const v = initial ?? {};

  const router = useRouter();
  const isCreate = mode === "create";
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const busy = phase !== "idle";

  // 상단 탭(ijw 구조): 기본 정보 + 과목별 상담. AI 분석은 상세 화면에서 보여준다(폼은 입력 전용).
  // + 사전 체크리스트(읽기 전용) — 학부모가 QR 2단계에서 낸 답변이라 직원이 고칠 값이 아니다. 있는 건에만 탭을
  //   노출한다(수기 등록 건에 빈 탭을 띄우면 "왜 못 쓰지?" 혼란). 저장 페이로드에도 안 들어간다 = 덮어쓸 위험 0.
  const checklist = v.intakeChecklist ?? null;
  const TABS = [
    { key: "basic", label: "기본 정보" },
    ...SUBJECT_TABS.map((t) => ({ key: t.key, label: `${t.label} 상담` })),
    ...(checklist ? [{ key: "checklist", label: "사전 체크리스트" }] : []),
  ];
  const [activeTab, setActiveTab] = useState("basic");

  // 접을 수 있는 확장 섹션(기본 접힘) — ijw와 동일.
  const [showAcademy, setShowAcademy] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  // 과목 점수/상담 detail — 클라 상태, 제출 시 hidden input(JSON)으로 직렬화.
  const [details, setDetails] = useState<SubjectDetails>(() => v.subjectDetails ?? {});
  const setField = (subj: string, key: string, val: string) =>
    setDetails((d) => ({ ...d, [subj]: { ...(d[subj] ?? {}), [key]: val } }));
  const englishType = details.english?.testType ?? "ai";

  // 상담 내용 '✨ AI 제안' — uncontrolled textarea라 ref로 값 주입 + input 이벤트 dispatch(초안/동시편집 가드 포착).
  const parentRequestRef = useRef<HTMLTextAreaElement>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const suggestedPR = (aiSuggestedParentRequest ?? "").trim();
  // 저장값이 제안을 이미 포함(교체/추가 후 저장)하면 숨김 — includes가 정확일치·부분포함 둘 다 커버.
  const showParentRequestSuggestion =
    !isCreate && !!suggestedPR && !(v.parentRequest ?? "").includes(suggestedPR) && !suggestionDismissed;
  function applyParentRequest(kind: "replace" | "append") {
    const el = parentRequestRef.current;
    if (!el || !suggestedPR) return;
    const cur = el.value.trimEnd();
    el.value = kind === "replace" || cur.length === 0 ? suggestedPR : `${cur}\n\n${suggestedPR}`;
    // 초안 자동저장·동시편집 가드가 변경을 포착하도록 input 이벤트 발생(CLAUDE.md 칩 패턴).
    el.dispatchEvent(new Event("input", { bubbles: true }));
    setSuggestionDismissed(true);
  }

  // 로컬 초안 자동저장 — 입력 중 IDB 보관, 다시 열면 복구 배너. 서버 저장 성공 시 clear.
  const formRef = useRef<HTMLFormElement>(null);
  const draftScope = isCreate ? "consultation:new" : `consultation:${v.id ?? "edit"}`;
  const draft = useFormDraft({
    scope: draftScope,
    // 항상 기본값이 채워지는 날짜/상태 필드는 "의미 있는 입력" 판정에서 제외(빈 폼 오탐 배너 방지).
    ignoreForBanner: ["receivedDate", "consultationDate", "registrationStatus", "parentRelation"],
    formRef,
    onRestore: (vals) => {
      if (vals.subjectDetails) {
        try {
          setDetails(JSON.parse(vals.subjectDetails) as SubjectDetails);
        } catch {
          /* ignore */
        }
      }
    },
  });
  const clearDraft = draft.clear;

  // 동시편집 가드(same-browser 저장경고) + cross-user "수정중" presence(edit 모드) — 둘 다 공존.
  const editScope = !isCreate && v.id ? `consultation:${v.id}` : undefined;
  const { notifySaved } = useConcurrentEditGuard({ scope: editScope, formRef });
  const { markSaved } = useUnsavedGuard({ formRef });

  // QR 접수(대기·예약) 재저장 확인 팝업 — 저장 직전에 "상담 완료로 변경?"을 묻는다. 확인=markConsulted 플래그.
  const consultedDialogRef = useRef<HTMLDialogElement>(null);
  const pendingFdRef = useRef<FormData | null>(null);
  function resolveConsultedPrompt(mark: boolean | null) {
    consultedDialogRef.current?.close();
    const fd = pendingFdRef.current;
    pendingFdRef.current = null;
    if (mark === null || !fd) return; // 취소 — 저장 자체를 중단(폼으로 복귀)
    if (mark) fd.set("markConsulted", "1");
    void submitForm(fd);
  }

  // 생성·수정 통합 제출 — 녹음이 있으면 클라에서 티켓 발급→업로드 후 audioPath를 실어 액션 호출(생성/수정 공통).
  // 수정 모드도 녹음 첨부 가능(QR 접수건을 상담사가 수정하며 상담 녹음 → 전사·AI 분석 재실행).
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    if (recordingActive) {
      setSubmitError("녹음을 먼저 중지한 후 저장해주세요.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("subjectDetails", JSON.stringify(details));
    // QR 접수 대기·예약 건 — 저장 전에 상담 완료 전환 여부를 묻고, 선택에 따라 이어서 제출.
    if (confirmConsultedOnSave && !isCreate) {
      pendingFdRef.current = fd;
      consultedDialogRef.current?.showModal();
      return;
    }
    await submitForm(fd);
  }

  async function submitForm(fd: FormData) {
    try {
      if (audioFile) {
        setPhase("uploading");
        const ext = audioFile.name.split(".").pop()?.toLowerCase() || "webm";
        const ct = audioFile.type.startsWith("audio/") ? audioFile.type : `audio/${ext}`;
        const fdT = new FormData();
        fdT.set("kind", "registration");
        fdT.set("ext", ext);
        fdT.set("contentType", ct);
        fdT.set("size", String(audioFile.size));
        const tk = await issueAudioUploadTicket(undefined, fdT);
        if (tk?.error || !tk?.ticket) {
          setSubmitError(tk?.error ?? "업로드 준비 실패");
          setPhase("idle");
          return;
        }
        try {
          await uploadToTicket(tk.ticket, audioFile);
        } catch (err) {
          setSubmitError(err instanceof Error ? err.message : "업로드 실패");
          setPhase("idle");
          return;
        }
        fd.set("audioPath", tk.ticket.path);
        fd.set("audioSizeBytes", String(audioFile.size));
      }
      setPhase("submitting");
      if (isCreate) {
        // 성공 시 서버가 redirect(NEXT_REDIRECT throw) → catch에서 clearDraft.
        const result = await createEnrollmentConsultation(undefined, fd);
        if (result?.error) {
          setSubmitError(result.error);
          setPhase("idle");
        }
      } else {
        const result = await updateEnrollmentConsultation(undefined, fd);
        if (result?.error) {
          setSubmitError(result.error);
          setPhase("idle");
          // 부분 성공(필드는 저장, 녹음 첨부만 실패)이면 폼은 저장된 상태 — 미저장 가드 해제(닫아도 거짓 확인 안 뜸).
          if (result.saved) markSaved();
          return;
        }
        if (result?.ok && v.id) {
          clearDraft();
          notifySaved();
          markSaved();
          router.push(`/enrollment/${v.id}`);
          router.refresh();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/NEXT_REDIRECT/.test(msg)) {
        clearDraft();
        markSaved();
        return;
      }
      setSubmitError(msg);
      setPhase("idle");
    }
  }

  const errorMsg = submitError;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      {mode === "edit" && v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <input type="hidden" name="subjectDetails" value={JSON.stringify(details)} />

      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {editScope ? <EditingBanner scope={editScope} /> : null}

      {/* 녹음 바 — 생성·수정 공통. 저장 시 자동 전사·13섹션 AI 분석(입력값 보존).
          수정: 녹음은 여러 행으로 **누적**(0068a) — 여러 상담사가 각자 추가하고, 분석은 전체 합본으로 갱신. */}
      <div className="border-primary/25 bg-primary/5 space-y-2.5 rounded-2xl border p-3">
        {!isCreate && existingRecordings.length > 0 ? (
          <p className="text-text-dim flex items-center gap-1.5 text-[11px]">
            <Mic className="size-3.5" />
            이미 등록된 녹음 <span className="num text-foreground font-bold">{existingRecordings.length}개</span>
            {" "}(마지막 {KST_REC_LABEL.format(new Date(existingRecordings[existingRecordings.length - 1].createdAt))})
            — 새 녹음은 기존 녹음을 지우지 않고 <span className="text-foreground font-bold">추가</span>됩니다.
          </p>
        ) : null}
        <AudioRecorderField
          file={audioFile}
          onChange={setAudioFile}
          onRecordingChange={setRecordingActive}
          disabled={busy}
        />
        {/* 안내 — 흐린 11px 한 줄이라 잘 안 보이던 것 → 아이콘 + 핵심 강조 + 12px로 또렷하게. */}
        <div className="border-primary/20 bg-card/70 flex items-start gap-2 rounded-md border px-2.5 py-2">
          <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
          <p className="text-foreground text-xs leading-relaxed">
            {isCreate ? (
              <>
                <span className="text-primary font-bold">저장하면 한국어 전사 + 13섹션 AI 분석이 자동 실행</span>
                됩니다. <span className="text-text-dim">입력하신 내용은 그대로 보존됩니다.</span>
              </>
            ) : (
              <>
                <span className="text-primary font-bold">
                  저장하면 이 녹음이 추가되고 전사 + AI 분석이 전체 녹음 기준으로 다시 실행
                </span>
                됩니다. 접수만 된 상담을 직접 상담하며 녹음하거나, 추가 상담을 이어 붙일 때 쓰세요.{" "}
                <span className="text-text-dim">기존 녹음·입력하신 내용은 그대로 보존됩니다.</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* 상단 탭바 — overflow-y-hidden: overflow-x-auto가 버튼 -mb-px로 세로 1px 넘쳐 세로 스크롤바가
          생기던 것 차단(가로만 스크롤). */}
      <div className="border-border scrollbar-thin flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-1.5 text-sm whitespace-nowrap ${
              activeTab === t.key
                ? "border-primary text-primary font-bold"
                : "text-text-dim hover:text-foreground border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 기본 정보 탭 — 항상 마운트(inactive는 hidden). 숨겨도 DOM 유지 → FormData/초안 필드 유실 방지. */}
      <div className={`space-y-3 ${activeTab === "basic" ? "" : "hidden"}`}>
        {/* 1. 접수 정보 */}
        <Card title="접수 정보">
          <Grid cols={3}>
            <L label="상담자" icon={UserCheck}>
              <input name="counselor" defaultValue={v.counselor ?? ""} placeholder="상담 선생님" className={input} />
            </L>
            <L label="접수일" icon={Calendar}>
              <input name="receivedDate" type="date" defaultValue={v.receivedDate ?? (isCreate ? kstToday() : "")} className={`${input} num`} />
            </L>
            <L label="상담 경로" icon={Globe}>
              <select name="consultationPath" defaultValue={v.consultationPath ?? ""} className={input}>
                <option value="">선택</option>
                {CONSULTATION_PATHS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </L>
          </Grid>
        </Card>

        {/* 2. 학생 정보 ↔ 상담 내용 (2단, 높이 맞춰 stretch — 상담내용 textarea가 빈 세로공간 채움) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
          <Card title="학생 정보">
            <Grid cols={2}>
              <L label="학생 이름" icon={User} required>
                <input name="prospectName" defaultValue={v.prospectName ?? ""} className={input} />
              </L>
              <L label="학생 전화" icon={MessageSquare}>
                <input name="studentPhone" defaultValue={v.studentPhone ?? ""} placeholder="010-0000-0000" className={input} />
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="보호자 성함" icon={User}>
                <input name="parentName" defaultValue={v.parentName ?? ""} placeholder="김영희" className={input} />
              </L>
              <L label="보호자 연락처" icon={MessageSquare}>
                <input name="parentPhone" defaultValue={v.parentPhone ?? ""} className={input} />
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="학교" icon={School}>
                <input name="prospectSchool" defaultValue={v.prospectSchool ?? ""} className={input} />
              </L>
              <L label="학년" icon={GraduationCap}>
                <select name="prospectGrade" defaultValue={v.prospectGrade ?? ""} className={input}>
                  <option value="">선택</option>
                  {gradeLevels.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="영문 이름" icon={Languages}>
                <input name="englishName" defaultValue={v.englishName ?? ""} className={input} />
              </L>
              <L label="집 전화" icon={Home}>
                <input name="homePhone" defaultValue={v.homePhone ?? ""} className={input} />
              </L>
            </Grid>
            <L label="주소 (동 또는 아파트)" icon={MapPin}>
              <input name="address" defaultValue={v.address ?? ""} placeholder="복현동" className={input} />
            </L>
            <Grid cols={2}>
              <L label="상세주소" icon={MapPin}>
                <input name="addressDetail" defaultValue={v.addressDetail ?? ""} className={input} />
              </L>
              <L label="우편번호" icon={Hash}>
                <input name="zipCode" defaultValue={v.zipCode ?? ""} className={input} />
              </L>
            </Grid>
            {/* 셔틀버스 신청 — 강조 단독 줄 */}
            <label className="border-amber/40 bg-amber/5 text-amber flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-bold">
              <input type="checkbox" name="shuttleBusRequest" value="true" defaultChecked={v.shuttleBusRequest} className="size-4" />
              <Bus className="size-4" />
              셔틀버스 신청
            </label>
            <Grid cols={2}>
              <L label="성별" icon={User}>
                <select name="gender" defaultValue={v.gender ?? ""} className={input}>
                  <option value="">선택 안함</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </L>
              <L label="혈액형" icon={Droplet}>
                <select name="bloodType" defaultValue={v.bloodType ?? ""} className={input}>
                  <option value="">선택 안함</option>
                  {BLOOD_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}형</option>
                  ))}
                </select>
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="생년월일" icon={Cake}>
                <input name="birthDate" type="date" defaultValue={v.birthDate ?? ""} className={`${input} num`} />
              </L>
              <L label="학생과의 관계" icon={Users}>
                <select name="parentRelation" defaultValue={v.parentRelation ?? ""} className={input}>
                  <option value="">선택 안함</option>
                  {RELATION_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </L>
            </Grid>
          </Card>

          <Card title="상담 내용" fill>
            <Grid cols={2}>
              <L label="상담일" icon={Calendar}>
                <input name="consultationDate" type="date" defaultValue={v.consultationDate ?? (isCreate ? kstToday() : "")} className={`${input} num`} />
              </L>
              <L label="과목" icon={BookOpen}>
                <select name="subject" defaultValue={v.subject ?? ""} className={input}>
                  <option value="">선택</option>
                  {subjects.options.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </L>
            </Grid>
            {/* 상담 내용 — 남는 세로공간 전부 채움(학생정보 카드 높이에 맞춰 늘어남) */}
            <label className="flex flex-1 flex-col space-y-1">
              <span className="text-text-dim flex items-center gap-1 text-[11px] font-medium">
                <MessageSquare className="size-3 shrink-0" />
                상담 내용
              </span>
              <textarea
                ref={parentRequestRef}
                name="parentRequest"
                defaultValue={v.parentRequest ?? ""}
                placeholder="상담 내용 / 학부모 요구사항 / 관찰"
                className={`${input} min-h-40 flex-1 resize-none`}
              />
            </label>
            {/* 녹음 분석이 정리한 상담 내용 — 이미 입력값이 있어 자동입력에서 버려진 버전. 비파괴로 제시(교체/추가/무시). */}
            {showParentRequestSuggestion ? (
              <div className="border-gold/40 bg-gold-soft/30 space-y-2 rounded-md border px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="text-gold size-3.5 shrink-0" />
                  <span className="text-foreground text-xs font-medium">AI가 정리한 상담 내용</span>
                </div>
                <p className="text-text-dim max-h-32 overflow-y-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
                  {suggestedPR}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyParentRequest("replace")}
                    className="border-gold/50 bg-gold text-white hover:bg-gold/90 rounded-lg border px-2 py-0.5 text-xs font-medium transition"
                  >
                    교체
                  </button>
                  <button
                    type="button"
                    onClick={() => applyParentRequest("append")}
                    className="border-gold/50 text-gold hover:bg-gold-soft rounded-lg border px-2 py-0.5 text-xs font-medium transition"
                  >
                    아래에 추가
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestionDismissed(true)}
                    className="text-text-faint hover:text-foreground px-1 text-xs transition"
                  >
                    무시
                  </button>
                  <span className="text-text-faint ml-auto text-[10px]">저장해야 반영됩니다</span>
                </div>
              </div>
            ) : null}
          </Card>
        </div>

        {/* 3. 학원 관리 정보 (선택, 접이식) */}
        <Collapsible
          icon={Tag}
          tone="amber"
          title="학원 관리 정보 (선택)"
          subtitle="안전사항, 희망진로, 남매 관계 등"
          open={showAcademy}
          onToggle={() => setShowAcademy((s) => !s)}
        >
          <L label="안전사항" icon={AlertTriangle}>
            <textarea name="safetyNotes" rows={2} defaultValue={v.safetyNotes ?? ""} placeholder="알레르기, 주의사항 등" className={`${input} resize-none`} />
          </L>
          <Grid cols={2}>
            <L label="희망진로" icon={Target}>
              <input name="careerGoal" defaultValue={v.careerGoal ?? ""} placeholder="의사, 교사 등" className={input} />
            </L>
            <L label="학생 구분" icon={Tag}>
              <input name="studentType" defaultValue={v.studentType ?? ""} placeholder="예비/재원" className={input} />
            </L>
          </Grid>
          <Grid cols={2}>
            <L label="남매 관계" icon={Users}>
              <select name="siblings" defaultValue={v.siblings ?? ""} className={input}>
                <option value="">선택</option>
                {SIBLINGS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </L>
            <L label="남매 관계 기록" icon={Users}>
              <input name="siblingsDetails" defaultValue={v.siblingsDetails ?? ""} placeholder="재원생 여부 등" className={input} />
            </L>
          </Grid>
          <Grid cols={2}>
            <L label="이전 학원" icon={School}>
              <input name="prevAcademy" defaultValue={v.prevAcademy ?? ""} className={input} />
            </L>
            <L label="최근 성적" icon={Target}>
              <input name="lastScore" defaultValue={v.lastScore ?? ""} className={input} />
            </L>
          </Grid>
        </Collapsible>

        {/* 4. 후속 조치 (선택, 접이식) */}
        <Collapsible
          icon={Calendar}
          tone="purple"
          title="후속 조치 (선택)"
          subtitle="후속 조치일, 미등록 사유 등"
          open={showFollowUp}
          onToggle={() => setShowFollowUp((s) => !s)}
        >
          <Grid cols={2}>
            <L label="후속 조치일" icon={Calendar}>
              <input name="followUpDate" type="date" defaultValue={v.followUpDate ?? ""} className={`${input} num`} />
            </L>
            <L label="조치 내용" icon={MessageSquare}>
              <input name="followUpContent" defaultValue={v.followUpContent ?? ""} className={input} />
            </L>
          </Grid>
          <L label="미등록 사유" icon={XCircle}>
            <input name="nonRegistrationReason" defaultValue={v.nonRegistrationReason ?? ""} placeholder="등록 안한 이유" className={input} />
          </L>
        </Collapsible>

        {/* 5. 등록 / 결제 */}
        <Card title="등록 / 결제">
          <L label="등록 상태" icon={CheckCircle}>
            <select name="registrationStatus" defaultValue={v.registrationStatus ?? ""} className={input}>
              <option value="">선택</option>
              {REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </L>
          <Grid cols={3}>
            <L label="결제 금액" icon={Banknote}>
              <input name="paymentAmount" defaultValue={v.paymentAmount ?? ""} placeholder="예: 150000" className={input} />
            </L>
            <L label="결제일" icon={Calendar}>
              <input name="paymentDate" type="date" defaultValue={v.paymentDate ?? ""} className={`${input} num`} />
            </L>
            <L label="등록자" icon={UserCheck}>
              <input name="registrar" defaultValue={v.registrar ?? ""} className={input} />
            </L>
          </Grid>
          <div className="flex flex-wrap gap-4 pt-1">
            <Check name="installmentAgreement" label="환불·학칙 동의" defaultChecked={v.installmentAgreement} />
            <Check name="privacyAgreement" label="개인정보 활용 동의" defaultChecked={v.privacyAgreement} />
          </div>
        </Card>
      </div>

      {/* 과목별 상담 탭 — 각각 항상 마운트, inactive는 hidden(과목 detail은 컨트롤드 state라 값 보존). */}
      {SUBJECT_TABS.map((tab) => (
        <div key={tab.key} className={activeTab === tab.key ? "" : "hidden"}>
          <Card title={`${tab.label} 상담`}>
            {tab.english ? (
              <div className="space-y-3">
                <L label="테스트 유형" icon={BookOpen}>
                  <select
                    value={englishType}
                    onChange={(e) => setField("english", "testType", e.target.value)}
                    className={`${input} max-w-xs`}
                  >
                    {ENGLISH_TEST_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </L>
                {[...(ENGLISH_GROUPS[englishType] ?? []), COMMON_FIELDS].map((g, i) => (
                  <GroupInputs key={i} group={g} subjectKey="english" details={details} onChange={setField} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(tab.groups ?? []).map((g, i) => (
                  <GroupInputs key={i} group={g} subjectKey={tab.key} details={details} onChange={setField} />
                ))}
              </div>
            )}
          </Card>
        </div>
      ))}

      {/* 사전 체크리스트 탭(읽기 전용) — 학부모가 QR 2단계에서 낸 답변. 입력 필드가 없어 저장 payload와 무관
          = 직원이 다른 탭을 고쳐 저장해도 학부모 답변은 그대로 보존된다. */}
      {checklist ? (
        <div className={activeTab === "checklist" ? "" : "hidden"}>
          <Card title="사전 체크리스트">
            <p className="text-text-dim mb-3 text-xs">
              학부모님이 QR 접수 2단계에서 직접 작성한 내용입니다 — 상담 참고용(수정 불가).
            </p>
            <ChecklistView checklist={checklist} />
          </Card>
        </div>
      ) : null}

      {errorMsg ? (
        <p className="text-danger bg-danger/5 border-danger/20 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {errorMsg}
        </p>
      ) : null}

      {/* QR 접수(대기·예약) 재저장 확인 — native dialog(showModal: 배경 inert·Esc·포커스 격리).
          form 안이지만 전 버튼 type="button"이라 중첩 제출 없음(subjects-section AbsorbDialog 패턴). */}
      {confirmConsultedOnSave && !isCreate ? (
        <dialog
          ref={consultedDialogRef}
          onCancel={() => resolveConsultedPrompt(null)}
          className="bg-card border-line backdrop:bg-ink/40 m-auto w-full max-w-sm rounded-xl border p-5 shadow-lg"
        >
          <h3 className="text-foreground text-sm font-bold">상담 완료로 변경할까요?</h3>
          <p className="text-text-dim mt-2 text-xs leading-relaxed">
            QR로 접수된 <span className="text-foreground font-bold">대기 · 예약</span> 상담입니다. 저장하면서
            상태를 <span className="text-foreground font-bold">상담 완료</span>로 옮길 수 있습니다.
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => resolveConsultedPrompt(null)}
              className="text-text-dim hover:text-foreground rounded-md px-2.5 py-1.5 text-xs transition"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => resolveConsultedPrompt(false)}
              className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft rounded-md border px-2.5 py-1.5 text-xs transition"
            >
              상태 유지하고 저장
            </button>
            <Button type="button" size="sm" onClick={() => resolveConsultedPrompt(true)}>
              상담 완료로 저장
            </Button>
          </div>
        </dialog>
      ) : null}

      <FormActionBar>
        <Button type="submit" disabled={busy || recordingActive}>
          {recordingActive
            ? "녹음 중 — 정지 후 저장"
            : phase === "uploading"
              ? "음성 업로드 중…"
              : phase === "submitting"
                ? "저장 중…"
                : isCreate
                  ? "저장하고 상세로"
                  : "저장"}
          {isCreate ? <ArrowRight className="size-4" /> : <Save className="size-4" />}
        </Button>
      </FormActionBar>
    </form>
  );
}

// 자동 높이 textarea — 수동 리사이즈 핸들 없이 기본 minRows(4줄) → 내용 따라 자동 확장 → maxRows(10줄) 넘으면 스크롤.
// 컨트롤드라 value가 바뀔 때마다(타이핑·초안 복구·과목 전환) effect가 높이 재계산. lineHeight/패딩은 실제 computed에서 도출.
function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
  minRows = 4,
  maxRows = 10,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad =
      parseFloat(cs.paddingTop) +
      parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderBottomWidth);
    const min = line * minRows + pad;
    const max = line * maxRows + pad;
    el.style.height = "auto";
    el.style.height = `${Math.max(min, Math.min(el.scrollHeight, max))}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [value, minRows, maxRows]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      style={{ resize: "none" }}
    />
  );
}

function GroupInputs({
  group,
  subjectKey,
  details,
  onChange,
}: {
  group: FieldGroup;
  subjectKey: string;
  details: SubjectDetails;
  onChange: (subj: string, key: string, val: string) => void;
}) {
  return (
    <div className="space-y-2">
      {group.title ? <p className="text-text-dim text-xs font-bold">{group.title}</p> : null}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${group.cols ?? 2}, minmax(0, 1fr))` }}>
        {group.fields.map((f) => {
          const val = details[subjectKey]?.[f.key] ?? "";
          // 히스토리·진도·성적·상담내역·기타 = 여러 줄(full-width). 점수 = 3자리 좁은 칸. 나머지 = 1행.
          if (f.type === "textarea") {
            return (
              <label key={f.key} className="col-span-full block space-y-1">
                <span className="text-text-dim text-[11px]">{f.label}</span>
                <AutoGrowTextarea
                  value={val}
                  onChange={(e) => onChange(subjectKey, f.key, e.target.value)}
                  className={input}
                />
              </label>
            );
          }
          if (f.type === "score") {
            return (
              <label key={f.key} className="block space-y-1">
                <span className="text-text-dim text-[11px]">{f.label}</span>
                <input
                  inputMode="numeric"
                  maxLength={3}
                  value={val}
                  onChange={(e) => onChange(subjectKey, f.key, e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                  className={`${input} max-w-[5rem] text-center`}
                />
              </label>
            );
          }
          return (
            <label key={f.key} className="block space-y-1">
              <span className="text-text-dim text-[11px]">{f.label}</span>
              <input
                type={f.type === "date" ? "date" : "text"}
                value={val}
                onChange={(e) => onChange(subjectKey, f.key, e.target.value)}
                className={input}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

// fill=true면 grid의 align-items:stretch로 늘어난 셀 높이를 flex-col로 채운다(상담내용 textarea가 학생정보 높이에 맞춤).
// ⚠️ 여기에 h-full(height:100%)을 주면 auto-height grid 행에서 퍼센트 높이가 content로 resolve돼 stretch가 무력화된다 → 금지.
function Card({ title, children, fill }: { title: string; children: ReactNode; fill?: boolean }) {
  return (
    <div className={`bg-card border-border overflow-hidden rounded-2xl border ${fill ? "flex flex-col" : ""}`}>
      <div className="border-border bg-bg-soft/50 border-b px-3 py-1.5">
        <h3 className="text-primary text-xs font-bold">{title}</h3>
      </div>
      <div className={`space-y-2 p-2.5 ${fill ? "flex flex-1 flex-col" : ""}`}>{children}</div>
    </div>
  );
}

function Grid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={`grid grid-cols-1 gap-2 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>{children}</div>
  );
}

function L({
  label,
  icon: Icon,
  required,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-text-dim flex items-center gap-1 text-[11px] font-medium">
        {Icon ? <Icon className="size-3 shrink-0" /> : null}
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Collapsible({
  icon: Icon,
  title,
  subtitle,
  tone,
  open,
  onToggle,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle: string;
  tone: "amber" | "purple";
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const tones = {
    amber: "border-amber/30 bg-amber/5 text-amber",
    purple: "border-purple/30 bg-purple/5 text-purple",
  } as const;
  return (
    <div className={`overflow-hidden rounded-2xl border ${tones[tone]}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span className="text-foreground text-sm font-bold">{title}</span>
        <span className="text-text-dim text-[11px]">{subtitle}</span>
      </button>
      {open ? <div className="space-y-2 px-3 pb-3 pt-1">{children}</div> : null}
    </div>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="text-foreground inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}
