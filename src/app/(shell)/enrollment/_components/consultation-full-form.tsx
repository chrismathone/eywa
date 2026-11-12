"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useLicenseOn, useModuleOn } from "@/features/owner/operations-context";
import {
  AlertCircle, AlertTriangle, ArrowRight, BookOpen, Bus, Cake, Calendar,
  CheckCircle, ChevronDown, ChevronRight, Globe, GraduationCap, Hash, Home, Languages,
  MapPin, MessageSquare, Mic, Save, School, Sparkles, Tag, Target, Users, User, UserCheck, XCircle,
  Droplet, type LucideIcon,
} from "@/components/icons/aywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { useGradeLevels, useSubjectMaps } from "@/features/owner/operations-context";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { PriorConsultsHint } from "./prior-consults-hint";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { EditingBanner } from "@/features/presence/editing-badge";
import type { IntakeChecklist } from "@/features/enrollment/intake-checklist";
import { sanitizeScoreInput } from "@/features/enrollment/score-input";
import { ASSIGNED_DRAG_BLOCKED, ENROLLED_REVERT_BLOCKED, boardStatusOf, outcomeForDrop } from "@/features/enrollment/board-stages";
import {
  FOLLOW_UP_BEFORE_BLOCKED,
  FOLLOW_UP_RESULTS,
  followUpRequired,
  initialFollowUpResult,
  parseFollowUpResult,
  resolveFollowUp,
  type FollowUpResult,
} from "@/features/enrollment/follow-up";
import { ChecklistView } from "./checklist-view";
import { ReferrerField } from "./referrer-field";
import type { ReferrerOption } from "@/features/enrollment/referrer";
import { AudioRecorderField } from "./audio-recorder-field";
import { RecordingRecoveryNotice } from "@/components/forms/recording-recovery-notice";
import { clearRecovery, consultationRecordingKey, type RecordingOwner } from "@/lib/recording-recovery";
import { dismissBrowserRecording } from "@/lib/browser-recording";
import { documentHasLiveRecording, formDraftScope, recordingSince } from "@/lib/recording-resume";
import { SavedStayNotice } from "@/components/forms/saved-stay-notice";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import {
  createEnrollmentConsultation,
  updateEnrollmentConsultation,
} from "@/features/enrollment/server/actions";
import {
  BLOOD_OPTIONS,
  COMMON_FIELDS,
  CONSULTATION_PATHS,
  englishGroupsFor,
  englishTestTypesFor,
  GENDER_OPTIONS,
  RELATION_OPTIONS,
  SIBLINGS_OPTIONS,
  SUBJECT_TABS,
  type FieldGroup,
  type SubjectDetails,
} from "@/features/enrollment/form-config";

// 컴팩트 입력(ijw 밀도) — aywa 토큰. 카드/라벨/그리드는 아래 헬퍼로 통일.
const input =
  "border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:cursor-not-allowed disabled:bg-muted/40";

/**
 * 읽기 권한 잠금(원장 2026-11-05 · write-lock.ts) — 글·날짜 칸은 비활성 + 권한 안내 placeholder,
 * 선택·체크·라디오는 placeholder가 없어 비활성만. 쓰기 권한이면 빈 객체라 기존 속성이 그대로 산다.
 * 🔴 JSX에서 **맨 뒤에** 펼칠 것 — 앞의 `disabled={busy}`·자체 placeholder를 덮어야 한다.
 */
function lockedField(readOnly: boolean): { disabled?: boolean; placeholder?: string } {
  return readOnly ? { disabled: true, placeholder: writeLockedPlaceholder("enrollment") } : {};
}
function lockedChoice(readOnly: boolean): { disabled?: boolean } {
  return readOnly ? { disabled: true } : {};
}
/**
 * 녹음 대상(이름·연락처) 칸 — 녹음 중엔 `disabled`가 아니라 `readOnly`로 잠근다. disabled 칸은 임시 저장에서 빠져서
 * (form-draft `readFormValues`) 돌아온 작성 화면에 이름이 비고, 녹음이 다시 붙지 않았다.
 */
const lockedInput = `${input} read-only:bg-muted/40 read-only:text-text-dim`;

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
  assignedClassCount?: number;
  followUpDate?: string | null;
  followUpContent?: string | null;
  nonRegistrationReason?: string | null;
  /** 지금 상태(outcome · 수정 화면) — 후속 조치를 반드시 고를지 · 처음 고른 채로 보일 값을 정한다(follow-up.ts). 새 상담은 없음. */
  outcome?: string | null;
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
  /** 소개한 사람(0362a) — 칸이 DB에 있을 때만 그린다(없으면 저장도 소개 칸을 건드리지 않는다, #95). */
  referrerReady?: boolean;
  /** 연결된 원생·직원 · 신청서에 적은 이름 · 글에 이름이 나온 후보(수정 화면만). */
  referrer?: ReferrerOption | null;
  referrerName?: string | null;
  referrerCandidates?: ReferrerOption[];
};

export function ConsultationFullForm({
  mode,
  initial,
  aiSuggestedParentRequest,
  existingRecordings = [],
  confirmConsultedOnSave = false,
  recordingOwner,
  instance,
  readOnly = false,
}: {
  mode: "create" | "edit";
  initial?: ConsultationFormInitial;
  /** 녹음 분석이 추출한 상담 내용 — 이미 입력값이 있어 자동입력에서 버려진 버전. 있으면 '✨ AI 제안'으로 비파괴 제시. */
  aiSuggestedParentRequest?: string | null;
  /** 이미 등록된 녹음 행(수정 모드) — 새 녹음이 "덮어쓰기"가 아니라 "추가"임을 명시하는 표시용. */
  existingRecordings?: { createdAt: string; status: string }[];
  /** QR 접수 + 대기·예약 건(수정 모드) — 저장 시 "상담 완료로 변경?" 확인 팝업을 띄운다(서버도 조건 재검증). */
  confirmConsultedOnSave?: boolean;
  recordingOwner: RecordingOwner;
  /**
   * 작성 화면 한 벌(recording-resume.ts) — `formId`가 있으면(녹음이 걸린 신규 작성 화면이 있을 때 연 새 화면) 임시 저장 칸을 따로
   * 쓴다. 이 화면에 걸린 녹음이 있으면(녹음 아이콘의 '작성 화면 열기'·뒤로 가기로 돌아옴) 그 뒤의 임시 저장을 안내 없이 되살린다.
   */
  instance?: { formId?: string };
  /**
   * 읽기 권한(`canWriteTenant(…,"enrollment")`가 false — 페이지가 서버 게이트와 같은 함수로 계산해 내려 준다).
   * 칸은 전부 비활성 + 권한 안내, 저장·녹음·AI 제안 반영 단추는 그리지 않고, 임시 저장·'수정 중' 표시도 켜지 않는다
   * (원장 2026-11-05 *"읽기 권한인데 쓸 수 있는것처럼 오해 불러오지 않도록"* · write-lock.ts). 탭·접기는 읽기라 그대로.
   */
  readOnly?: boolean;
}) {
  const subjects = useSubjectMaps();
  const gradeLevels = useGradeLevels();
  const v = initial ?? {};
  // 학년 선택지 = 학원설정 + **현재 값**. 설정에 없는 옛 표기("1"·"예비 1"·"7세" 등 시트 임포트본이
  // 1,500건 넘는다)를 안 남기면 <select>가 어느 옵션과도 안 맞아 "선택"으로 렌더되고, 다른 칸만
  // 고쳐 저장해도 학년이 조용히 지워진다(학생 정보 폼이 쓰는 방식과 동일).
  const currentGrade = (v.prospectGrade ?? "").trim();
  const gradeOptions =
    currentGrade && !gradeLevels.includes(currentGrade) ? [...gradeLevels, currentGrade] : gradeLevels;

  const inFrame = useInFrame();
  const isCreate = mode === "create";
  const shuttleOn = useModuleOn("shuttle");
  const eieOn = useModuleOn("eie");
  const recordingOn = useLicenseOn("meeting_recording");
  const aiOn = useLicenseOn("ai_analysis");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioRecoveryId, setAudioRecoveryId] = useState<string | null>(null);
  const [recordingDraftId, setRecordingDraftId] = useState("");
  const [recordingSubject, setRecordingSubject] = useState({ name: v.prospectName ?? "", phone: v.parentPhone || v.studentPhone || "" });
  const recordingKey = consultationRecordingKey(v.id, recordingSubject.name, recordingSubject.phone, recordingDraftId);
  const recordingScope = recordingKey ? { ...recordingOwner, recordKey: recordingKey, label: recordingSubject.name.trim() || "상담" } : null;
  function selectAudio(file: File | null, recoveryId?: string) {
    setAudioFile(file);
    setAudioRecoveryId(file ? recoveryId ?? null : null);
  }
  function syncRecordingSubject(form: HTMLFormElement) {
    if (recordingActive || busy) return;
    const data = new FormData(form);
    const name = String(data.get("prospectName") ?? "");
    const phone = String(data.get("parentPhone") || data.get("studentPhone") || "");
    if (name === recordingSubject.name && phone === recordingSubject.phone) return;
    const draftId = name !== recordingSubject.name ? crypto.randomUUID() : recordingDraftId;
    if (consultationRecordingKey(v.id, name, phone, draftId) !== recordingKey) selectAudio(null);
    setRecordingDraftId(draftId);
    setRecordingSubject({ name, phone });
  }
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const onRecordingChange = useCallback((live: boolean, paused: boolean) => {
    setRecordingActive(live);
    setRecordingPaused(paused);
  }, []);
  // 녹음이 붙어 있으면(녹음 중·일시정지 — '작성 화면 열기'로 돌아온 화면 포함) 녹음 칸을 펼쳐 바로 보이게 한다.
  const recordingDetailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (recordingActive && recordingDetailsRef.current) recordingDetailsRef.current.open = true;
  }, [recordingActive]);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 막힌 저장은 이유가 보이는 곳으로 데려간다 — 오류 문구는 폼 맨 아래, 후속 조치는 '기본 정보' 탭 안이라
  // 과목 탭에서 저장을 누르면 아무 반응이 없는 것처럼 보였다(원장 제보 2026-10-26, 영어 상담 탭).
  // 같은 문구로 다시 막혀도 다시 데려가도록 횟수로 effect를 건다(탭 전환·문구가 그려진 뒤에 스크롤).
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorFocusRef = useRef<"followUp" | "message">("message");
  const [errorSeq, setErrorSeq] = useState(0);
  function showError(message: string, at: "followUp" | "message" = "message") {
    errorFocusRef.current = at;
    if (at === "followUp") setActiveTab("basic");
    setSubmitError(message);
    setErrorSeq((n) => n + 1);
  }
  /** 저장이 끝나 상세로 떠나는 중 — 폼 전체를 잠근다(아래 form의 inert 주석). */
  const [leaving, setLeaving] = useState(false);
  /** 저장했지만 이 문서의 다른 녹음 때문에 머문다 — 상세로 가는 링크(SavedStayNotice). */
  const [stayHref, setStayHref] = useState<string | null>(null);
  const busy = phase !== "idle";
  const lockF = lockedField(readOnly);
  const lockC = lockedChoice(readOnly);

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
  // 후속 조치(원장 2026-10-22 *"선택이 아닌 필수로 … 자동적으로 등록, 미등록으로 처리"*) — 상담 끝난 건은 반드시 고르고, 고르면 칸반 칸이
  // 따라 움직인다(follow-up.ts · 서버가 같은 함수로 다시 판정). 고른 값은 라디오(name=followUpResult)가 실어 보낸다.
  const assignedClassCount = v.assignedClassCount ?? 0;
  const [followUpResult, setFollowUpResult] = useState<FollowUpResult | null>(() => initialFollowUpResult(v.outcome, v.followUpDate, assignedClassCount));
  const followUpRef = useRef<HTMLDivElement>(null);
  const followUpMust = assignedClassCount === 0 && (isCreate || followUpRequired(v.outcome ?? "consulted"));
  // 다음 상담일은 '상담 완료'에서도 선택(원장 2026-10-26 — 10-23 '날짜 필수'를 뒤집음 · follow-up.ts와 같은 규칙).
  useEffect(() => {
    if (errorSeq === 0) return;
    const followUp = errorFocusRef.current === "followUp";
    (followUp ? followUpRef.current : errorRef.current)?.scrollIntoView({ block: followUp ? "center" : "nearest", behavior: "smooth" });
  }, [errorSeq]);
  const selectedStage = FOLLOW_UP_RESULTS.find((r) => r.value === followUpResult)?.stage;
  const stageLabel = boardStatusOf({
    outcome: selectedStage ? outcomeForDrop(selectedStage, v.outcome ?? "consulted") : (v.outcome ?? "consulted"),
    assignedClassCount,
  }).label;
  function pickFollowUp(value: FollowUpResult) {
    setFollowUpResult(value);
  }

  // 과목 점수/상담 detail — 클라 상태, 제출 시 hidden input(JSON)으로 직렬화.
  const [details, setDetails] = useState<SubjectDetails>(() => v.subjectDetails ?? {});
  const setField = (subj: string, key: string, val: string) =>
    setDetails((d) => ({ ...d, [subj]: { ...(d[subj] ?? {}), [key]: val } }));
  const englishType = details.english?.testType ?? "ai";
  const visibleEnglishType = !eieOn && englishType === "eie" ? "ai" : englishType;

  // 상담 내용 '✨ AI 제안' — uncontrolled textarea라 ref로 값 주입 + input 이벤트 dispatch(초안/동시편집 가드 포착).
  const parentRequestRef = useRef<HTMLTextAreaElement>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const suggestedPR = (aiSuggestedParentRequest ?? "").trim();
  // 저장값이 제안을 이미 포함(교체/추가 후 저장)하면 숨김 — includes가 정확일치·부분포함 둘 다 커버.
  const showParentRequestSuggestion =
    aiOn && !readOnly && !isCreate && !!suggestedPR && !(v.parentRequest ?? "").includes(suggestedPR) && !suggestionDismissed;
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
  // 수정 화면을 연 때의 값 — 저장 때 함께 보내 서버가 **이 사람이 바꾼 칸만** 쓴다(원장 2026-10-26: 먼저 열어 둔 화면으로 저장해
  // 다른 사람이 막 저장한 상담자 칸을 빈칸으로 덮었다 · consultation-changed.ts).
  // 🔴 초안 복원보다 먼저 잡는다(되살린 입력은 '바꾼 것'이어야 저장된다) — 그래서 이 효과는 useFormDraft보다 위에 둔다.
  const editBaseRef = useRef<string | null>(null);
  useEffect(() => {
    if (isCreate || editBaseRef.current !== null || !formRef.current) return;
    const values: Record<string, string> = {};
    for (const [key, value] of new FormData(formRef.current)) if (typeof value === "string") values[key] = value;
    editBaseRef.current = JSON.stringify(values);
  }, [isCreate]);
  const draftScope = isCreate ? formDraftScope("consultation:new", instance?.formId) : `consultation:${v.id ?? "edit"}`;
  const draft = useFormDraft({
    scope: draftScope,
    // 읽기 권한이면 임시 저장·복구 배너를 켜지 않는다 — 고칠 수 없는 칸에 옛 초안을 되살리면 저장값처럼 보인다.
    enabled: !readOnly,
    // 항상 기본값이 채워지는 날짜/상태 필드는 "의미 있는 입력" 판정에서 제외(빈 폼 오탐 배너 방지).
    // 작성 화면의 상담자도 그렇다 — 추가하는 사람 이름이 기본으로 들어간다(원장 2026-10-19).
    ignoreForBanner: [
      "receivedDate", "consultationDate", "parentRelation", "recordingDraftId",
      ...(isCreate ? ["counselor"] : []),
    ],
    // 소개한 사람은 고르기 칸의 상태(이름 표시)와 숨은 칸이 짝이라 초안으로 되살리지 않는다(값만 돌아오고 이름은 옛것인 채로 저장되지 않게).
    exclude: ["referrer", "referrerName"],
    formRef,
    // 이 화면에 걸린 녹음으로 돌아왔으면 그 녹음 뒤의 입력을 안내 없이 바로 — 이름·연락처가 되살아나 녹음이 다시 붙는다.
    restoreSince: () => recordingSince(instance?.formId),
    onRestore: (vals) => {
      const restoredFollowUp = parseFollowUpResult(vals.followUpResult);
      // 옛 초안의 '상담 전'은 상담을 마친 건에선 고를 수 없는 값이라 비운다(다시 고르게) — 비활성 단추가 눌린 채 남지 않게.
      setFollowUpResult(
        assignedClassCount > 0
          ? "enrolled"
          : (restoredFollowUp === "before" || restoredFollowUp === "consulted") && v.outcome === "enrolled"
            ? "enrolled"
            : restoredFollowUp === "before" && followUpMust
              ? null
              : restoredFollowUp,
      );
      if (formRef.current) syncRecordingSubject(formRef.current);
      setRecordingDraftId(vals.recordingDraftId || crypto.randomUUID());
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
  // 녹음이 붙는 순간 지금 입력을 바로 남긴다 — 그 뒤 아무것도 안 치고 떠나도 돌아온 화면이 이 값을 되살린다(restoreSince).
  const saveDraftNow = draft.save;
  useEffect(() => {
    if (recordingActive) saveDraftNow();
  }, [recordingActive, saveDraftNow]);

  /** 저장 뒤 상세로 — 풀 문서 이동(#102). 이 문서에 다른 녹음이 살아 있으면 떠나지 않고 링크를 보인다(문서가 내려가면 끊긴다). */
  function leaveTo(path: string) {
    const dest = inFrame ? withEmbed(path) : path;
    setLeaving(true);
    if (documentHasLiveRecording()) setStayHref(dest);
    else window.location.assign(dest);
  }

  // 동시편집 가드(same-browser 저장경고) + cross-user "수정중" presence(edit 모드) — 둘 다 공존.
  // 읽기 권한이면 scope를 넘기지 않는다 — 열어 보기만 해도 다른 사람 화면에 '수정 중'이 뜨지 않게.
  const editScope = !isCreate && v.id && !readOnly ? `consultation:${v.id}` : undefined;
  const { notifySaved } = useConcurrentEditGuard({ scope: editScope, formRef });
  const { markSaved } = useUnsavedGuard({ formRef, enabled: !readOnly });

  // QR 접수(대기·예약) 재저장 확인 팝업 — 저장 직전에 "상담 완료로 변경?"을 묻는다. 확인=markConsulted 플래그.
  const consultedDialogRef = useRef<HTMLDialogElement>(null);
  const pendingFdRef = useRef<FormData | null>(null);
  function resolveConsultedPrompt(mark: boolean | null) {
    consultedDialogRef.current?.close();
    const fd = pendingFdRef.current;
    pendingFdRef.current = null;
    if (mark === null || !fd) return; // 취소 — 저장 자체를 중단(폼으로 복귀)
    if (mark) fd.set("markConsulted", "1");
    if (!checkFollowUp(fd, mark)) return;
    void submitForm(fd);
  }

  /** 후속 조치 미리 확인 — 서버(`resolveFollowUp`)와 같은 함수 · 막히면 그 구역으로 데려간다. */
  function checkFollowUp(fd: FormData, markConsulted: boolean): boolean {
    const r = resolveFollowUp({
      current: isCreate || markConsulted ? "consulted" : (v.outcome ?? "consulted"),
      result: parseFollowUpResult(fd.get("followUpResult")),
      followUpDate: String(fd.get("followUpDate") ?? "") || null,
      storedDate: v.followUpDate ?? null,
      today: kstToday(),
      assignedClassCount,
    });
    if ("error" in r) {
      showError(r.error, "followUp");
      return false;
    }
    return true;
  }

  // 생성·수정 통합 제출 — 녹음이 있으면 클라에서 티켓 발급→업로드 후 audioPath를 실어 액션 호출(생성/수정 공통).
  // 수정 모드도 녹음 첨부 가능(QR 접수건을 상담사가 수정하며 상담 녹음 → 전사·AI 분석 재실행).
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readOnly) return; // 저장 단추가 없지만 다른 제출 길도 닫는다(서버도 같은 판정으로 막는다).
    setSubmitError(null);
    if (recordingActive) {
      showError("녹음을 끝낸 뒤 저장해 주세요.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("subjectDetails", JSON.stringify(details));
    if (editBaseRef.current) fd.set("editBase", editBaseRef.current);
    // QR 접수 대기·예약 건 — 후속 조치를 안 골랐을 때만 상담 완료 전환 여부를 묻는다(고르면 그 값이 상태를 정한다).
    if (confirmConsultedOnSave && !isCreate && !parseFollowUpResult(fd.get("followUpResult"))) {
      pendingFdRef.current = fd;
      consultedDialogRef.current?.showModal();
      return;
    }
    if (!checkFollowUp(fd, false)) return;
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
          showError(tk?.error ?? "업로드 준비 실패");
          setPhase("idle");
          return;
        }
        try {
          await uploadToTicket(tk.ticket, audioFile);
        } catch (err) {
          showError(err instanceof Error ? err.message : "업로드 실패");
          setPhase("idle");
          return;
        }
        fd.set("audioPath", tk.ticket.path);
        fd.set("audioSizeBytes", String(audioFile.size));
      }
      setPhase("submitting");
      if (isCreate) {
        // 저장된 상담 id를 확인한 뒤에만 해당 녹음의 로컬 복구본을 비운다.
        const result = await createEnrollmentConsultation(undefined, fd);
        if (result?.error) {
          showError(result.error);
          setPhase("idle");
        } else if (result?.id) {
          if (audioRecoveryId) { await clearRecovery(audioRecoveryId); dismissBrowserRecording({ recoveryId: audioRecoveryId }); }
          clearDraft();
          markSaved();
          leaveTo(`/enrollment/${result.id}`);
        } else {
          showError("저장 결과를 확인하지 못했습니다. 목록에서 확인해 주세요.");
          setPhase("idle");
        }
      } else {
        const result = await updateEnrollmentConsultation(undefined, fd);
        if (result?.error) {
          showError(result.error);
          setPhase("idle");
          // 부분 성공(필드는 저장, 녹음 첨부만 실패)이면 폼은 저장된 상태 — 미저장 가드 해제(닫아도 거짓 확인 안 뜸).
          if (result.saved) markSaved();
          return;
        }
        if (result?.ok && v.id) {
          if (audioRecoveryId) { await clearRecovery(audioRecoveryId); dismissBrowserRecording({ recoveryId: audioRecoveryId }); }
          clearDraft();
          notifySaved();
          markSaved(); // ⚠️ 이동보다 먼저 — 뒤면 풀 문서 이동에 미저장 가드의 '떠나시겠습니까?'가 뜬다
          // 🔴 `router.push`가 아니라 풀 문서 이동 — 서버 액션 직후의 push는 액션 응답이 이 수정 폼 트리를
          //    다시 적용하면서 삼켜진다(#102: 저장됐는데 수정 폼에 그대로 머문다). 풀 로드라 상세는 항상 새로
          //    그려진다(refresh 불필요). phase는 '저장 중…'인 채로 둔다 — 이동 중에 다시 누르면 녹음이 한 번 더 붙는다.
          leaveTo(`/enrollment/${v.id}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showError(msg);
      setPhase("idle");
    }
  }

  const errorMsg = submitError;

  return (
    <>
    {stayHref ? <SavedStayNotice href={stayHref} saved={isCreate ? "상담을 저장했습니다." : "저장했습니다."} /> : null}
    {/* 🔴 저장 뒤 이동 대기 중엔 폼 전체를 잠근다(inert = 입력·포커스·클릭 불가). 풀 문서 이동은 응답이 올 때까지
        이 화면이 살아 있는데, 그 사이 칸에 치면 ① 초안 자동저장이 방금 지운 초안을 pagehide에서 되살리고
        ② 미저장 가드가 다시 dirty가 되어 이동에 '떠나시겠습니까?'가 뜬다. 머무는 동안(stayHref)도 잠근 채 둔다. */}
    <form ref={formRef} onSubmit={handleSubmit} onInput={(e) => syncRecordingSubject(e.currentTarget)} className="space-y-3" inert={leaving}>
      {mode === "edit" && v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <input type="hidden" name="subjectDetails" value={JSON.stringify(details)} />
      <input type="hidden" name="recordingDraftId" value={recordingDraftId} />

      {readOnly ? (
        <p role="note" className="border-line bg-bg-soft/60 text-text-dim rounded-md border px-3 py-2 text-xs">{writeLockedNote("enrollment")}</p>
      ) : null}
      <DraftBanner savedAt={isCreate && recordingSubject.name.trim() ? null : draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {editScope ? <EditingBanner scope={editScope} /> : null}
      {recordingOn && !readOnly ? <RecordingRecoveryNotice key={recordingScope?.recordKey ?? "empty"} kind="consultation"
        scope={recordingScope} selectedId={audioRecoveryId} disabled={busy || recordingActive}
        onRestore={(file, meta) => selectAudio(file, meta.id)} /> : null}

      {/* 녹음 바 — 생성·수정 공통. 저장 시 자동 전사·13섹션 AI 분석(입력값 보존).
          수정: 녹음은 여러 행으로 **누적**(0068a) — 여러 상담사가 각자 추가하고, 분석은 전체 합본으로 갱신. */}
      {/* 읽기 권한이면 녹음·파일 첨부째 없다(업로드 = 쓰기). */}
      {readOnly || !recordingOn ? null : (
      <details ref={recordingDetailsRef} className="border-line rounded-lg border px-3 py-2">
        <summary className="cursor-pointer text-sm font-bold">
          상담 녹음·파일 첨부 <span className="ml-2 font-medium" aria-live="polite">{recordingActive ? recordingPaused ? "일시정지 · 열어서 이어서 녹음" : "녹음 중 · 열어서 일시정지·끝내기" : audioFile ? audioFile.name : existingRecordings.length > 0 ? `기존 녹음 ${existingRecordings.length}개 · 추가 가능` : aiOn ? "선택 · 저장 후 전사·AI 분석" : "선택 · 저장 후 전사"}</span>
        </summary>
        <div className="mt-3 space-y-2.5">
        {!isCreate && existingRecordings.length > 0 ? (
          <p className="text-text-dim flex items-center gap-1.5 text-xs">
            <Mic className="size-3.5" />
            이미 등록된 녹음 <span className="num text-foreground font-bold">{existingRecordings.length}개</span>
            {" "}(마지막 {KST_REC_LABEL.format(new Date(existingRecordings[existingRecordings.length - 1].createdAt))})
            — 새 녹음은 기존 녹음을 지우지 않고 <span className="text-foreground font-bold">추가</span>됩니다.
          </p>
        ) : null}
        <AudioRecorderField
          file={audioFile}
          onChange={selectAudio}
          scope={recordingScope}
          selectedRecoveryId={audioRecoveryId}
          showRecovery={false}
          onRecordingChange={onRecordingChange}
          disabled={busy}
        />
        {/* 안내 — 흐린 11px 한 줄이라 잘 안 보이던 것 → 아이콘 + 핵심 강조 + 12px로 또렷하게. */}
        <div className="border-primary/20 bg-card/70 flex items-start gap-2 rounded-md border px-2.5 py-2">
          {aiOn ? <Sparkles className="text-primary mt-0.5 size-4 shrink-0" /> : <Mic className="text-primary mt-0.5 size-4 shrink-0" />}
          <p className="text-foreground text-xs leading-relaxed">
            {isCreate ? (
              <>
                <span className="text-primary font-bold">{aiOn ? "저장하면 한국어 전사 + 13섹션 AI 분석이 자동 실행" : "저장하면 한국어 전사가 자동 실행"}</span>
                됩니다. <span className="text-text-dim">입력하신 내용은 그대로 보존됩니다.</span>
              </>
            ) : (
              <>
                <span className="text-primary font-bold">
                  {aiOn ? "저장하면 이 녹음이 추가되고 전사 + AI 분석이 전체 녹음 기준으로 다시 실행" : "저장하면 이 녹음이 추가되고 전체 녹음을 다시 전사"}
                </span>
                됩니다. 접수만 된 상담을 직접 상담하며 녹음하거나, 추가 상담을 이어 붙일 때 쓰세요.{" "}
                <span className="text-text-dim">기존 녹음·입력하신 내용은 그대로 보존됩니다.</span>
              </>
            )}
          </p>
        </div>
        </div>
      </details>
      )}

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
              <input name="counselor" defaultValue={v.counselor ?? ""} className={input} {...lockF} />
            </L>
            <L label="접수일" icon={Calendar}>
              <input name="receivedDate" type="date" defaultValue={v.receivedDate ?? (isCreate ? kstToday() : "")} className={`${input} num`} {...lockF} />
            </L>
            {/* 🔴 신규일 때만 필수(원장 2026-08-04). 유입경로가 지금 31%만 기재돼 있어 "소개가 잘 붙는가"
                같은 판단이 안 되는데, 옛 상담을 **수정할 때**까지 강제하면 모르는 값을 지어내게 된다
                — 그건 미기재보다 나쁘다(틀린 값은 아무도 못 알아본다). 앞으로 들어오는 것만 막는다. */}
            <L label="상담 경로" icon={Globe} required={isCreate}>
              <select
                name="consultationPath"
                defaultValue={v.consultationPath ?? ""}
                required={isCreate}
                className={input}
                {...lockC}
              >
                <option value="">선택</option>
                {withCurrent(CONSULTATION_PATHS, v.consultationPath).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </L>
            {/* 소개한 사람(0362a) — 강사평가 '원생 소개'가 이 연결만 센다. 고르기 칸 안에 버튼이 있어 <label>로 감싸지 않는다. */}
            {v.referrerReady ? (
              <div className="space-y-1">
                <span className="text-text-dim flex items-center gap-1 text-xs font-medium">
                  <Users className="size-3 shrink-0" />
                  소개한 사람
                </span>
                <ReferrerField initial={v.referrer ?? null} initialName={v.referrerName ?? null} candidates={v.referrerCandidates ?? []} disabled={readOnly} />
              </div>
            ) : null}
          </Grid>
        </Card>

        {/* 2. 학생 정보 ↔ 상담 내용 (2단, 높이 맞춰 stretch — 상담내용 textarea가 빈 세로공간 채움) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
          <Card title="학생 정보">
            <Grid cols={2}>
              <L label="학생 이름" icon={User} required>
                <input name="prospectName" defaultValue={v.prospectName ?? ""} readOnly={recordingActive} disabled={busy} className={lockedInput} {...lockF} />
              </L>
              <L label="학생 전화" icon={MessageSquare}>
                <input name="studentPhone" defaultValue={v.studentPhone ?? ""} readOnly={recordingActive} disabled={busy} className={lockedInput} {...lockF} />
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="보호자 성함" icon={User}>
                <input name="parentName" defaultValue={v.parentName ?? ""} className={input} {...lockF} />
              </L>
              <L label="보호자 연락처" icon={MessageSquare}>
                <input name="parentPhone" defaultValue={v.parentPhone ?? ""} readOnly={recordingActive} disabled={busy} className={lockedInput} {...lockF} />
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="학교" icon={School}>
                <input name="prospectSchool" defaultValue={v.prospectSchool ?? ""} className={input} {...lockF} />
              </L>
              <L label="학년" icon={GraduationCap}>
                <select name="prospectGrade" defaultValue={v.prospectGrade ?? ""} className={input} {...lockC}>
                  <option value="">선택</option>
                  {gradeOptions.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </L>
            </Grid>
            {/* 새 상담에서만 — 같은 학생의 이전 상담이 있으면 그 자리에서 알린다(판정 = 카드 'N건' 배지와 같은 한 벌). */}
            {isCreate ? <PriorConsultsHint /> : null}
            <Grid cols={2}>
              <L label="영문 이름" icon={Languages}>
                <input name="englishName" defaultValue={v.englishName ?? ""} className={input} {...lockF} />
              </L>
              <L label="집 전화" icon={Home}>
                <input name="homePhone" defaultValue={v.homePhone ?? ""} className={input} {...lockF} />
              </L>
            </Grid>
            <L label="주소 (동 또는 아파트)" icon={MapPin}>
              <input name="address" defaultValue={v.address ?? ""} className={input} {...lockF} />
            </L>
            <Grid cols={2}>
              <L label="상세주소" icon={MapPin}>
                <input name="addressDetail" defaultValue={v.addressDetail ?? ""} className={input} {...lockF} />
              </L>
              <L label="우편번호" icon={Hash}>
                <input name="zipCode" defaultValue={v.zipCode ?? ""} className={input} {...lockF} />
              </L>
            </Grid>
            {/* 셔틀버스 신청 — 강조 단독 줄. 셔틀 기능이 꺼진 학원엔 칸이 없다(2026-09-30) — 저장값은 hidden으로 보존. */}
            {shuttleOn ? (
              <label className="border-amber/40 bg-amber/5 text-amber flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-bold">
                <input type="checkbox" name="shuttleBusRequest" value="true" defaultChecked={v.shuttleBusRequest} className="size-4" {...lockC} />
                <Bus className="size-4" />
                셔틀버스 신청
              </label>
            ) : v.shuttleBusRequest ? (
              <input type="hidden" name="shuttleBusRequest" value="true" />
            ) : null}
            <Grid cols={2}>
              <L label="성별" icon={User}>
                <select name="gender" defaultValue={v.gender ?? ""} className={input} {...lockC}>
                  <option value="">선택 안함</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </L>
              <L label="혈액형" icon={Droplet}>
                <select name="bloodType" defaultValue={v.bloodType ?? ""} className={input} {...lockC}>
                  <option value="">선택 안함</option>
                  {BLOOD_OPTIONS.map((b) => (
                    <option key={b} value={b}>{b}형</option>
                  ))}
                </select>
              </L>
            </Grid>
            <Grid cols={2}>
              <L label="생년월일" icon={Cake}>
                <input name="birthDate" type="date" defaultValue={v.birthDate ?? ""} className={`${input} num`} {...lockF} />
              </L>
              <L label="학생과의 관계" icon={Users}>
                <select name="parentRelation" defaultValue={v.parentRelation ?? ""} className={input} {...lockC}>
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
                <input name="consultationDate" type="date" defaultValue={v.consultationDate ?? (isCreate ? kstToday() : "")} className={`${input} num`} {...lockF} />
              </L>
              <L label="과목" icon={BookOpen}>
                <select name="subject" defaultValue={v.subject ?? ""} className={input} {...lockC}>
                  <option value="">선택</option>
                  {[...subjects.options, ...(v.subject?.trim() && !subjects.options.some((s) => s.value === v.subject) ? [{ value: v.subject, label: v.subject }] : [])].map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </L>
            </Grid>
            {/* 상담 내용 — 남는 세로공간 전부 채움(학생정보 카드 높이에 맞춰 늘어남) */}
            <label className="flex flex-1 flex-col space-y-1">
              <span className="text-text-dim flex items-center gap-1 text-xs font-medium">
                <MessageSquare className="size-3 shrink-0" />
                상담 내용
              </span>
              <textarea
                ref={parentRequestRef}
                name="parentRequest"
                defaultValue={v.parentRequest ?? ""}
                placeholder="학부모 요구사항 / 관찰"
                className={`${input} min-h-40 flex-1 resize-none`}
                {...lockF}
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
                  <span className="text-text-faint ml-auto text-xs">저장해야 반영됩니다</span>
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
            <textarea name="safetyNotes" rows={2} defaultValue={v.safetyNotes ?? ""} placeholder="알레르기, 주의사항 등" className={`${input} resize-none`} {...lockF} />
          </L>
          <Grid cols={2}>
            <L label="희망진로" icon={Target}>
              <input name="careerGoal" defaultValue={v.careerGoal ?? ""} className={input} {...lockF} />
            </L>
            <L label="학생 구분" icon={Tag}>
              <input name="studentType" defaultValue={v.studentType ?? ""} placeholder="예비/재원" className={input} {...lockF} />
            </L>
          </Grid>
          <Grid cols={2}>
            <L label="남매 관계" icon={Users}>
              <select name="siblings" defaultValue={v.siblings ?? ""} className={input} {...lockC}>
                <option value="">선택</option>
                {withCurrent(SIBLINGS_OPTIONS, v.siblings).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </L>
            <L label="남매 관계 기록" icon={Users}>
              <input name="siblingsDetails" defaultValue={v.siblingsDetails ?? ""} placeholder="재원생 여부 등" className={input} {...lockF} />
            </L>
          </Grid>
          <Grid cols={2}>
            <L label="이전 학원" icon={School}>
              <input name="prevAcademy" defaultValue={v.prevAcademy ?? ""} className={input} {...lockF} />
            </L>
            <L label="최근 성적" icon={Target}>
              <input name="lastScore" defaultValue={v.lastScore ?? ""} className={input} {...lockF} />
            </L>
          </Grid>
        </Collapsible>

        {/* 4. 후속 조치 — 상담 끝난 건은 필수(원장 2026-10-22, 종전 '선택 · 접이식'). 고르면 칸반 칸이 따라 움직인다:
            칸반과 같은 네 상태 · 다음 상담 날짜는 별도로 선택. */}
        <div ref={followUpRef} className="border-purple/30 bg-purple/5 space-y-2 rounded-2xl border px-3 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-foreground inline-flex items-center gap-1 text-sm font-bold">
              <Calendar className="text-purple size-3.5 shrink-0" />
              후속 조치
              {followUpMust ? <span className="text-danger">*</span> : null}
            </span>
            <span className="text-text-dim text-xs break-keep">
              {assignedClassCount > 0 ? ASSIGNED_DRAG_BLOCKED : followUpMust
                ? "상담을 마쳤으면 등록 완료 · 미등록 · 상담 완료 중 하나를 고릅니다(다음 상담일은 선택) · 저장하면 해당 칸으로 이동합니다"
                : `현재 상태: ${stageLabel} · 저장하면 선택한 상태로 이동합니다`}
            </span>
          </div>
          <div role="radiogroup" aria-label="후속 조치" className="flex flex-wrap gap-1.5">
            {FOLLOW_UP_RESULTS.map((r) => {
              // 등록 완료를 '상담 완료'로 되돌리지 않는다(상태 변경·칸반과 같은 규칙) — 고를 수 없게 미리 막는다.
              // 상담을 마친 건은 '상담 전'을 고를 수 없다(필수 조치를 피하는 문 — follow-up.ts `FOLLOW_UP_BEFORE_BLOCKED`).
              const reverting = (r.value === "before" || r.value === "consulted") && v.outcome === "enrolled";
              const skipping = r.value === "before" && followUpMust;
              const blocked = assignedClassCount > 0 ? r.value !== "enrolled" : reverting || skipping;
              const on = followUpResult === r.value;
              return (
                <label
                  key={r.value}
                  title={blocked ? (assignedClassCount > 0 ? ASSIGNED_DRAG_BLOCKED : reverting ? ENROLLED_REVERT_BLOCKED : FOLLOW_UP_BEFORE_BLOCKED) : undefined}
                  className={`relative inline-flex items-center rounded-full border px-3 py-1 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40 ${
                    blocked
                      ? "border-line text-text-faint cursor-not-allowed"
                      : on
                        ? `border-primary bg-primary text-primary-foreground font-medium ${readOnly ? "cursor-not-allowed" : "cursor-pointer"}`
                        : readOnly
                          ? "border-line text-text-faint cursor-not-allowed"
                          : "border-line text-foreground hover:bg-bg-soft cursor-pointer"
                  }`}
                >
                  <input
                    type="radio"
                    name="followUpResult"
                    value={r.value}
                    checked={on}
                    disabled={blocked || readOnly}
                    onChange={() => pickFollowUp(r.value)}
                    className="sr-only"
                  />
                  {r.label}
                </label>
              );
            })}
          </div>
          <Grid cols={2}>
            <L label="다음 상담일 (선택)" icon={Calendar}>
              <input name="followUpDate" type="date" defaultValue={v.followUpDate ?? ""} className={`${input} num`} {...lockF} />
            </L>
            <L label="조치 내용" icon={MessageSquare}>
              <input name="followUpContent" defaultValue={v.followUpContent ?? ""} className={input} {...lockF} />
            </L>
          </Grid>
          <L label="미등록 사유" icon={XCircle}>
            <input name="nonRegistrationReason" defaultValue={v.nonRegistrationReason ?? ""} className={input} {...lockF} />
          </L>
          {followUpResult === "before" || followUpResult === "consulted" ? (
            <p className="text-text-dim text-xs break-keep">다음 상담일을 정하면 하루 전 · 당일 · 기한이 지난 뒤 상담자에게 알립니다.</p>
          ) : null}
        </div>

        <Card title="상담 상태 / 동의">
          <L label="상담 상태" icon={CheckCircle}>
            <span aria-label="상담 상태" className="text-sm font-semibold">{stageLabel}</span>
          </L>
          <div className="flex flex-wrap gap-4 pt-1">
            <Check name="installmentAgreement" label="환불·학칙 동의" defaultChecked={v.installmentAgreement} disabled={readOnly} />
            <Check name="privacyAgreement" label="개인정보 활용 동의" defaultChecked={v.privacyAgreement} disabled={readOnly} />
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
                    value={visibleEnglishType}
                    onChange={(e) => setField("english", "testType", e.target.value)}
                    className={`${input} max-w-xs`}
                    {...lockC}
                  >
                    {englishTestTypesFor(eieOn).map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </L>
                {[...englishGroupsFor(visibleEnglishType, eieOn), COMMON_FIELDS].map((g, i) => (
                  <GroupInputs key={i} group={g} subjectKey="english" details={details} onChange={setField} readOnly={readOnly} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {(tab.groups ?? []).map((g, i) => (
                  <GroupInputs key={i} group={g} subjectKey={tab.key} details={details} onChange={setField} readOnly={readOnly} />
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
        <p ref={errorRef} className="text-danger bg-danger/5 border-danger/20 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
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

      {readOnly ? null : (
      <FormActionBar>
        <Button type="submit" disabled={busy || recordingActive}>
          {recordingActive
            ? "녹음 중 — 녹음을 끝낸 뒤 저장"
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
      )}
    </form>
    </>
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
  disabled,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
  maxRows?: number;
  disabled?: boolean;
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
      disabled={disabled}
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
  readOnly = false,
}: {
  group: FieldGroup;
  subjectKey: string;
  details: SubjectDetails;
  onChange: (subj: string, key: string, val: string) => void;
  /** 읽기 권한 — 칸 비활성 + 권한 안내(write-lock.ts). */
  readOnly?: boolean;
}) {
  const lock = lockedField(readOnly);
  return (
    <div className="space-y-2">
      {group.title ? <p className="text-text-dim text-xs font-bold">{group.title}</p> : null}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${group.cols ?? 2}, minmax(0, 1fr))` }}>
        {group.fields.map((f) => {
          const val = details[subjectKey]?.[f.key] ?? "";
          // 히스토리·진도·성적·상담내역·기타 = 여러 줄(full-width). 점수 = 좁은 칸(소수 허용). 나머지 = 1행.
          if (f.type === "textarea") {
            return (
              <label key={f.key} className="col-span-full block space-y-1">
                <span className="text-text-dim text-xs">{f.label}</span>
                <AutoGrowTextarea
                  value={val}
                  onChange={(e) => onChange(subjectKey, f.key, e.target.value)}
                  className={input}
                  {...lock}
                />
              </label>
            );
          }
          if (f.type === "score") {
            return (
              <label key={f.key} className="block space-y-1">
                <span className="text-text-dim text-xs">{f.label}</span>
                {/* 소수 허용(67.5·55.93). inputMode=decimal이라야 폰 키패드에 소수점이 뜬다. */}
                <input
                  inputMode="decimal"
                  value={val}
                  onChange={(e) => onChange(subjectKey, f.key, sanitizeScoreInput(e.target.value))}
                  className={`${input} max-w-[5rem] text-center`}
                  {...lock}
                />
              </label>
            );
          }
          return (
            <label key={f.key} className="block space-y-1">
              <span className="text-text-dim text-xs">{f.label}</span>
              <input
                type={f.type === "date" ? "date" : "text"}
                value={val}
                onChange={(e) => onChange(subjectKey, f.key, e.target.value)}
                className={input}
                {...lock}
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
      <span className="text-text-dim flex items-center gap-1 text-xs font-medium">
        {Icon ? <Icon className="size-3 shrink-0" /> : null}
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </span>
      {children}
    </label>
  );
}

/** 저장된 값이 선택지에 없으면(옛 시트·메이크에듀에서 옮긴 '등록-수학' 같은 글) 선택지 끝에 더한다 — 없으면 그냥 저장만 해도 select가 ""로 떨어져 값이 지워진다(학년 칸과 같은 방식, 2026-10-21). */
function withCurrent(options: readonly string[], current: string | null | undefined): string[] {
  const value = current?.trim();
  return value && !options.includes(value) ? [...options, value] : [...options];
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
        <span className="text-text-dim text-xs">{subtitle}</span>
      </button>
      <div hidden={!open} style={!open ? { display: "none" } : undefined} className="space-y-2 px-3 pb-3 pt-1">{children}</div>
    </div>
  );
}

function Check({
  name,
  label,
  defaultChecked,
  disabled,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="text-foreground inline-flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} disabled={disabled} className="size-4" />
      {label}
    </label>
  );
}
