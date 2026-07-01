"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  AlertCircle, AlertTriangle, ArrowRight, Banknote, BookOpen, Bus, Cake, Calendar,
  CheckCircle, ChevronDown, ChevronRight, Globe, GraduationCap, Hash, Home, Languages,
  MapPin, MessageSquare, Save, School, Tag, Target, Users, User, UserCheck, XCircle,
  Droplet, type LucideIcon,
} from "lucide-react";
import { kstToday } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { useGradeLevels, useSubjectMaps } from "@/features/owner/operations-context";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { EditingBanner } from "@/features/presence/editing-badge";
import { AudioRecorderField } from "./audio-recorder-field";
import { issueAudioUploadTicket } from "@/features/media/server/upload-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  createEnrollmentConsultation,
  updateEnrollmentConsultation,
  type UpdateConsultationState,
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
}: {
  mode: "create" | "edit";
  initial?: ConsultationFormInitial;
}) {
  const subjects = useSubjectMaps();
  const gradeLevels = useGradeLevels();
  const v = initial ?? {};

  const router = useRouter();
  const isCreate = mode === "create";
  const [editState, editFormAction] = useActionState<UpdateConsultationState, FormData>(
    updateEnrollmentConsultation,
    undefined,
  );
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">("idle");
  const [createError, setCreateError] = useState<string | null>(null);
  const busy = phase !== "idle";

  // 상단 탭(ijw 구조): 기본 정보 + 과목별 상담. AI 분석은 상세 화면에서 보여준다(폼은 입력 전용).
  const TABS = [{ key: "basic", label: "기본 정보" }, ...SUBJECT_TABS.map((t) => ({ key: t.key, label: `${t.label} 상담` }))];
  const [activeTab, setActiveTab] = useState("basic");

  // 접을 수 있는 확장 섹션(기본 접힘) — ijw와 동일.
  const [showAcademy, setShowAcademy] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);

  // 과목 점수/상담 detail — 클라 상태, 제출 시 hidden input(JSON)으로 직렬화.
  const [details, setDetails] = useState<SubjectDetails>(() => v.subjectDetails ?? {});
  const setField = (subj: string, key: string, val: string) =>
    setDetails((d) => ({ ...d, [subj]: { ...(d[subj] ?? {}), [key]: val } }));
  const englishType = details.english?.testType ?? "ai";

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

  useEffect(() => {
    if (!isCreate && editState?.ok && v.id) {
      clearDraft();
      notifySaved();
      router.push(`/enrollment/${v.id}`);
      router.refresh();
    }
  }, [editState, isCreate, v.id, router, clearDraft, notifySaved]);

  async function handleCreateSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreateError(null);
    if (recordingActive) {
      setCreateError("녹음을 먼저 중지한 후 저장해주세요.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    fd.set("subjectDetails", JSON.stringify(details));
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
          setCreateError(tk?.error ?? "업로드 준비 실패");
          setPhase("idle");
          return;
        }
        try {
          await uploadToTicket(tk.ticket, audioFile);
        } catch (err) {
          setCreateError(err instanceof Error ? err.message : "업로드 실패");
          setPhase("idle");
          return;
        }
        fd.set("audioPath", tk.ticket.path);
        fd.set("audioSizeBytes", String(audioFile.size));
      }
      setPhase("submitting");
      const result = await createEnrollmentConsultation(undefined, fd);
      if (result?.error) {
        setCreateError(result.error);
        setPhase("idle");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/NEXT_REDIRECT/.test(msg)) {
        clearDraft();
        return;
      }
      setCreateError(msg);
      setPhase("idle");
    }
  }

  const errorMsg = isCreate ? createError : editState?.error;

  return (
    <form
      ref={formRef}
      {...(isCreate ? { onSubmit: handleCreateSubmit } : { action: editFormAction })}
      className="space-y-3"
    >
      {mode === "edit" && v.id ? <input type="hidden" name="id" value={v.id} /> : null}
      <input type="hidden" name="subjectDetails" value={JSON.stringify(details)} />

      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      {editScope ? <EditingBanner scope={editScope} /> : null}

      {/* 녹음 바 — 상단(생성 모드). 저장 시 자동 전사·13섹션 AI 분석(입력값 보존). */}
      {isCreate ? (
        <div className="border-primary/25 bg-primary/5 space-y-2 rounded-lg border p-3">
          <AudioRecorderField
            file={audioFile}
            onChange={setAudioFile}
            onRecordingChange={setRecordingActive}
            disabled={busy}
          />
          <p className="text-text-dim text-[11px]">
            녹음하거나 음성 파일을 올리면 저장 시 자동으로 한국어 전사 + 13섹션 AI 분석을 실행합니다(입력하신 내용은 보존).
          </p>
        </div>
      ) : null}

      {/* 상단 탭바 */}
      <div className="border-border scrollbar-thin flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-1.5 text-sm whitespace-nowrap ${
              activeTab === t.key
                ? "border-primary text-primary font-semibold"
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
                name="parentRequest"
                defaultValue={v.parentRequest ?? ""}
                placeholder="상담 내용 / 학부모 요구사항 / 관찰"
                className={`${input} min-h-40 flex-1 resize-none`}
              />
            </label>
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

      {errorMsg ? (
        <p className="text-danger bg-danger/5 border-danger/20 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {errorMsg}
        </p>
      ) : null}

      <div className="flex justify-end">
        {isCreate ? (
          <Button type="submit" disabled={busy || recordingActive}>
            {recordingActive
              ? "녹음 중 — 정지 후 저장"
              : phase === "uploading"
                ? "음성 업로드 중…"
                : phase === "submitting"
                  ? "저장 중…"
                  : "저장하고 상세로"}
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <SubmitBtn />
        )}
      </div>
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "저장 중…" : "저장"}
      <Save className="size-4" />
    </Button>
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
      {group.title ? <p className="text-text-dim text-xs font-semibold">{group.title}</p> : null}
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
    <div className={`bg-card border-border overflow-hidden rounded-lg border ${fill ? "flex flex-col" : ""}`}>
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
    <div className={`overflow-hidden rounded-lg border ${tones[tone]}`}>
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
