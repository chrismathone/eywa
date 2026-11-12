"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckSquare,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Save,
  Square,
  X,
} from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { EditingBanner } from "@/features/presence/editing-badge";
import { useEditPresence } from "@/features/presence/edit-presence";
import type { SystemRole } from "@/lib/permissions";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { useJobTitleResolver, useSubjectMaps } from "@/features/owner/operations-context";
import { sheetT, type SheetDictKey } from "@/features/teacher-view/i18n";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { subjectsFromDepartment } from "@/features/staff/department/department-subjects";
import { autoJobTitle } from "@/features/staff/department/department-job-titles";
import {
  CAREER_ROWS,
  DYNAMIC_ROWS_MAX,
  EDU_ROWS,
  EMPLOYMENT_TYPE_EN,
  EMPLOYMENT_TYPES,
  emptyCareer,
  emptyCert,
  emptyEducation,
  emptyLanguage,
  INITIAL_STAFF_PASSWORD,
  RESUME_CHECKS,
  RESUME_COMPANIES,
  RESUME_DEPARTMENTS,
  RESUME_DRAFT_EXCLUDE,
  RESUME_PHOTO_SLOTS,
  WORKDAYS,
  type ResumeCareer,
  type ResumeCert,
  type ResumeCheckKey,
  type ResumeEducation,
  type ResumeLanguage,
  type StaffResumeData,
} from "@/features/staff/resume/resume";
import {
  issueResumePhotoTicket,
  saveStaffResume,
  type ResumeActionState,
} from "@/features/staff/resume/server/resume-actions";
import { DeleteResumeButton, PrintResumeButton } from "./resume-buttons";
import { phoneLabel } from "@/lib/format/phone";

// 종이 서식("인재원 이력서") 레이아웃을 재현한 시트 — 읽기(뷰) ↔ 인라인 편집(칸에 바로 타이핑) 한 컴포넌트.
// 화면·A4 인쇄 공용. "수정"을 누르면 별도 폼으로 넘어가지 않고 이 종이 칸들이 그대로 입력칸이 된다(WYSIWYG).

// 인쇄(print:)는 A4 1장에 들어가게 압축 — 화면은 여유 있게.
const T = "w-full border-collapse text-[12px] leading-relaxed print:text-[11px] print:leading-snug";
const cell = "border-foreground/35 border px-2 py-1.5 align-middle print:py-1";
// 화면(모바일)에선 헤더가 keep-all로 어절 단위 접혀 표가 카드폭에 수용됨. 인쇄만 nowrap(A4는 폭 여유).
const head = `${cell} bg-bg-soft/70 text-center font-bold print:whitespace-nowrap`;
const inputBase =
  "w-full min-w-0 rounded-sm bg-bg-soft/40 px-1.5 py-0.5 text-[12px] outline-none placeholder:text-text-faint/60 focus:bg-primary-soft/25 focus:ring-1 focus:ring-primary/50";

const V = (s: string) => s || " ";

/**
 * 종이 칸 글자 — **화면만** 뷰어 언어를 따르고 **인쇄물은 언제나 한국어**다
 * (원장 2026-09-04 *"화면만 갈라서"* — 인쇄물은 학원이 보관하는 한국어 인사 서류다).
 *
 * 🔑 인쇄는 `window.print()`로 **같은 DOM**을 찍는다 → 언어를 가를 자리가 CSS뿐이라 두 낱말을
 *    함께 싣고 미디어로 가른다. 한국어면 조각을 하나만 그려서 DOM이 두 배가 되지 않는다.
 * 🔴 영어만 남기지 말 것 — 그러면 **인쇄된 인사 서류가 영어**가 된다.
 */
function PaperText({ ko, en }: { ko: string; en: string }) {
  if (ko === en) return <>{ko}</>;
  return (
    <>
      <span className="print:hidden">{en}</span>
      <span className="hidden print:inline">{ko}</span>
    </>
  );
}

/** 사전 키로 적는 종이 칸 글자 — 위 규약 그대로. */
function P({ k }: { k: SheetDictKey }) {
  const lang = useSheetLang();
  if (lang === "ko") return <>{sheetT("ko", k)}</>;
  return <PaperText ko={sheetT("ko", k)} en={sheetT("en", k)} />;
}

/**
 * **저장값**의 표기(근무요일·근무형태·서류 확인) — 값은 한 글자도 안 바뀌고 그리는 글자만 바뀐다.
 * ⚠️ 회사 구분·근무부서·직급은 여기 안 태운다 — 조직·직급 이름이라 한국어 그대로가 정본이다
 *    (학원설정 직급을 안 옮기는 것과 같은 축).
 */
function PV({ ko, en }: { ko: string; en: string }) {
  const lang = useSheetLang();
  if (lang === "ko") return <>{ko}</>;
  return <PaperText ko={ko} en={en} />;
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground mt-5 mb-1.5 text-[13px] font-bold print:mt-3 print:text-[12px]">{children}</h2>;
}

/** 동적 섹션의 행 +/− 버튼 — 마지막 행에 입력하면 자동으로도 늘어나고, 버튼으로도 조절(원장 요청). */
function RowButtons({ label, onAdd, onRemove }: { label: string; onAdd: () => void; onRemove: () => void }) {
  const tf = useSheetTf();
  return (
    <div className="print:hidden mt-1 flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onAdd}
        aria-label={tf("res.rows.add", { label })}
        className="border-line text-text-dim hover:text-foreground hover:border-primary/40 inline-flex size-6 items-center justify-center rounded-md border transition"
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={tf("res.rows.removeLast", { label })}
        className="border-line text-text-dim hover:text-foreground hover:border-primary/40 inline-flex size-6 items-center justify-center rounded-md border transition"
      >
        <Minus size={12} aria-hidden="true" />
      </button>
    </div>
  );
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

/**
 * 동적 행(학력·경력)의 입력칸 — **컨트롤드**다. 값이 상태에 있어야 ① 마지막 행에 입력하면 행이
 * 자동으로 늘고 ② 초안 복원이 행 수까지 되살릴 수 있다(비컨트롤드면 늘어난 행의 값이 갈 곳이 없다).
 */
function DynInput({
  name,
  value,
  onChange,
  placeholder,
  align = "left",
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  align?: "left" | "center" | "right";
}) {
  const a = align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  return (
    <input
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${inputBase} ${a}`}
    />
  );
}

/**
 * @param done 저장은 끝났고 새 이력서 뷰로 **이동 중**일 때 true — 계속 잠가 둔다.
 * `pending`은 액션 resolve 즉시 풀리는데 생성 경로는 router.push(RSC 네비)가 수백ms 더 걸려,
 * 그 사이 재클릭하면 id 없는 폼이 한 번 더 제출돼 **같은 사람 이력서가 2건** 생긴다.
 */
function SaveButton({ done = false }: { done?: boolean }) {
  const t = useSheetT();
  const { pending } = useFormStatus();
  const busy = pending || done;
  return (
    <Button type="submit" disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {t("res.save")}
    </Button>
  );
}

/** 학력 행 안내문 — 위에서부터 시간순(원장 지시 2026-07-29). 행이 더 있으면 일반 라벨로 폴백. */
const EDU_PLACEHOLDER_KEYS = ["res.edu.ph.hs", "res.edu.ph.uni", "res.edu.ph.grad"] as const;

/** photos 배열 → 고정 슬롯 배열(길이 RESUME_PHOTO_SLOTS, 빈 슬롯 null). */
const slotify = <T,>(arr: readonly T[] | undefined): (T | null)[] =>
  Array.from({ length: RESUME_PHOTO_SLOTS }, (_, i) => arr?.[i] ?? null);

/** 종이 서식 하한까지 빈 행 보충(학력 4·경력 3) — 그 아래로는 화면도 저장도 내려가지 않는다. */
function padTo<T>(arr: T[], min: number, make: () => T): T[] {
  return arr.length >= min ? arr : [...arr, ...Array.from({ length: min - arr.length }, make)];
}

/** 초안 vals에서 동적 행 배열 복원 — 인덱스가 존재하는 만큼(캡 DYNAMIC_ROWS_MAX). */
function rowsFromDraft<T>(
  vals: Record<string, string | undefined>,
  prefix: string,
  keys: string[],
  make: (get: (k: string) => string) => T,
): T[] {
  const out: T[] = [];
  for (let i = 0; i < DYNAMIC_ROWS_MAX; i++) {
    if (keys.every((k) => vals[`${prefix}_${i}_${k}`] === undefined)) break;
    out.push(make((k) => vals[`${prefix}_${i}_${k}`] ?? ""));
  }
  return out;
}

export function ResumeSheet({
  data,
  id,
  userId,
  canWrite = false,
  startEditing = false,
  photoUrls,
  assignableRoles,
  staffUserId,
  returnHref = "/staff",
  submitAction,
  publicToken,
  onSaved,
  syncsToAccount = false,
}: {
  data: StaffResumeData;
  id?: string;
  /** 초안 스코프 격리용 — 공용 PC에서 다른 사람의 초안이 복구 제안되지 않게 한다. */
  userId: string;
  canWrite?: boolean;
  startEditing?: boolean;
  /** data.photos와 같은 순서의 열람용 signed URL(서버에서 resolve — 게이트 통과 시에만 전달됨). */
  photoUrls?: (string | null)[];
  /** 원샷 직원 등록에서 부여 가능한 역할(작성자 권한 기준, 서버가 재검증). 생성 화면에서만 전달. */
  assignableRoles?: SystemRole[];
  /** 기존 직원과 연결해 작성하는 모드(?staff= 프리필) — 저장 시 staff_user_id로 연결(서버가 재검증). */
  staffUserId?: string;
  /** 취소·작성완료 후 돌아갈 곳. 본인 이력서(/me)는 /staff가 차단이라 여기로 되돌린다. */
  returnHref?: string;
  /**
   * 제출 액션 교체 — **QR 공개 등록**(비인증)이 같은 서식을 그대로 쓰기 위한 주입점(2026-08-07).
   * 서식을 복제하면 칸이 갈라져 한쪽만 늘어난다(직원 명부는 70칸이 넘는다) → 액션만 바꾼다.
   */
  submitAction?: (prev: ResumeActionState, fd: FormData) => Promise<ResumeActionState>;
  /** 공개 등록 모드 — 이 값이 있으면 사진 첨부·초안 저장·계정 옵션·이동을 끄고 토큰을 함께 제출한다. */
  publicToken?: string;
  /** 저장 성공 시 부모에게 알림(공개 모드의 완료 화면 전환) — 있으면 자체 이동을 하지 않는다. */
  onSaved?: (state: NonNullable<ResumeActionState>) => void;
  /**
   * 이 이력서의 **성명·E-mail이 계정에 그대로 반영되는가** — 계정에 연결된 이력서를 사무실이 고칠 때만 true
   * (2026-08-25 원장 지시: 겹치는 칸은 이력서가 단일 소스 → 성명=표시 이름, E-mail=로그인 아이디).
   * ⚠️ 본인 이력서(/me)·공개 등록은 false다 — 거기선 서버가 동기를 시도하지 않으므로, 띄우면 거짓말이 된다.
   */
  syncsToAccount?: boolean;
}) {
  const isPublic = !!publicToken;
  // 화면 언어 — provider는 **강사 미니셸**에만 걸려 있어 사무실 풀셸·QR 공개 폼은 한국어 그대로다.
  const t = useSheetT();
  const tf = useSheetTf();
  const [editing, setEditing] = useState(startEditing);
  const [state, formAction] = useActionState<ResumeActionState, FormData>(
    submitAction ?? saveStaffResume,
    undefined,
  );
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  // 근무형태(단일 선택)·근무요일(다중)은 컨트롤드 — 초안 복원 시 onRestore로 rehydrate.
  const [empType, setEmpType] = useState(data.contract.employmentType);
  const [workDays, setWorkDays] = useState<string[]>(data.contract.workDays);
  // 회사 구분·근무부서(SearchableSelect = hidden input 제출)도 컨트롤드 — 초안 복원 동일 경로.
  const [company, setCompany] = useState(data.contract.company);
  const [division, setDivision] = useState(data.contract.division);
  // 담당 과목은 **부서에서 자동 도출**(별도 입력 칸 없음, 원장 지시 2026-07-29) — 저장 시 서버가 직원(users)에 반영.
  // 라벨은 학원설정 단일 소스(클라는 useSubjectMaps 훅).
  const subjectMaps = useSubjectMaps();
  const autoSubjects = subjectsFromDepartment(division, subjectMaps.options);
  // 직급도 부서에 종속(원장 지시 2026-07-29) — 목록은 학원설정 단일 소스, 선택지가 하나면 자동 확정(아르바이트).
  const jobTitlesFor = useJobTitleResolver();
  const [jobTitle, setJobTitle] = useState(data.contract.jobTitle);
  const jobTitleOptions = jobTitlesFor(division);
  // 동적 행(학력·경력·자격증·외국어)·서류 체크·사진은 컨트롤드 — 행 추가/삭제·복원이 상태 기준으로 돌아야 안전.
  // 학력·경력도 동적(원장 요청 2026-08-04 "경력을 3개밖에 못 적는다") — 종이 서식 행 수는 이제 **하한**이다.
  const [edus, setEdus] = useState<ResumeEducation[]>(data.education);
  const [careers, setCareers] = useState<ResumeCareer[]>(data.career);
  const [certs, setCerts] = useState<ResumeCert[]>(data.certificates);
  const [langs, setLangs] = useState<ResumeLanguage[]>(data.languages);
  const [checks, setChecks] = useState<Record<ResumeCheckKey, boolean>>(data.checks);
  const [photos, setPhotos] = useState<(string | null)[]>(slotify(data.photos));
  // 미리보기 URL — 기존 저장분은 서버 signed URL, 방금 올린 파일은 로컬 objectURL.
  const [previews, setPreviews] = useState<(string | null)[]>(slotify(photoUrls));
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  // 사진 슬라이드(원장 지시 2026-07-28) — 2칸을 세로로 쌓지 않고 한 칸에서 ‹ › 로 넘긴다.
  const [photoSlide, setPhotoSlide] = useState(0);
  // 원샷 직원 등록(생성 화면 전용) — 서버가 권한·역할을 재검증한다.
  // '직원 등록' 진입이 이 서식으로 통합(2026-07-28)돼 기본 ON. 🔴 역할도 기본값(강사)을 채운다
  // (2026-08-07 원장 지시 "체크 안 해도 만들어지게" — 실사고는 체크는 켜져 있었는데 **역할이 비어**
  // '역할 미선택 → 이력서만 저장' 경고로 빠진 것. 기본값이 있으면 아무것도 안 만져도 저장=계정 생성).
  const defaultAcctRole = assignableRoles?.includes("teacher") ? "teacher" : (assignableRoles?.[0] ?? "");
  const [acctRegister, setAcctRegister] = useState(!id && (assignableRoles?.length ?? 0) > 0);
  const [acctRole, setAcctRole] = useState(defaultAcctRole);

  const draft = useFormDraft({
    // 스코프에 userId 포함 — 사무실 공용 PC에서 앞사람 초안이 뒷사람에게 복구 제안되면 안 된다.
    scope: `staff-resume:${userId}:${id ?? "new"}`,
    formRef,
    // 🔴 공개 등록(QR)은 초안을 남기지 않는다 — 지원자 개인정보가 **학원 공용 태블릿 IDB**에 남아
    //    다음 사람에게 복구 제안되면 그게 유출이다(#78의 같은 축).
    enabled: editing && !isPublic,
    // 주민번호·계좌·급여는 IDB에 아예 안 남긴다(재인증 잠금 우회 차단) — 복구 시 그 칸만 비어 있다.
    exclude: RESUME_DRAFT_EXCLUDE,
    onRestore: (vals) => {
      setEmpType(vals.c_employmentType ?? "");
      setWorkDays(WORKDAYS.filter((d) => vals[`c_workday_${d.key}`] === "true").map((d) => d.key));
      setCompany(vals.c_company ?? "");
      setDivision(vals.c_division ?? "");
      setJobTitle(vals.c_jobTitle ?? "");
      // 학력·경력 — 초안에 담긴 행 수만큼 복원(하한 미달이면 종이 서식 행 수까지 빈 행 보충).
      // ⚠️ 경력 급여(car_N_salary)는 초안에서 제외된 민감 칸이라 복원값이 항상 빈 칸이다(의도).
      const re = rowsFromDraft<ResumeEducation>(
        vals,
        "edu",
        ["period", "school", "major", "gpa", "location"],
        (get) => ({
          period: get("period"),
          school: get("school"),
          major: get("major"),
          gpa: get("gpa"),
          location: get("location"),
        }),
      );
      setEdus(padTo(re, EDU_ROWS, emptyEducation));
      const rr = rowsFromDraft<ResumeCareer>(
        vals,
        "car",
        ["company", "period", "duties", "salary", "leaveReason"],
        (get) => ({
          company: get("company"),
          period: get("period"),
          duties: get("duties"),
          salary: get("salary"),
          leaveReason: get("leaveReason"),
        }),
      );
      setCareers(padTo(rr, CAREER_ROWS, emptyCareer));
      const rc = rowsFromDraft<ResumeCert>(vals, "cert", ["name", "date", "issuer"], (get) => ({
        name: get("name"),
        date: get("date"),
        issuer: get("issuer"),
      }));
      setCerts(rc.length ? rc : [emptyCert()]);
      const rl = rowsFromDraft<ResumeLanguage>(vals, "lang", ["name", "testDate", "score"], (get) => ({
        name: get("name"),
        testDate: get("testDate"),
        score: get("score"),
      }));
      setLangs(rl.length ? rl : [emptyLanguage()]);
      setChecks(
        Object.fromEntries(RESUME_CHECKS.map((c) => [c.key, vals[`chk_${c.key}`] === "true"])) as Record<
          ResumeCheckKey,
          boolean
        >,
      );
      // 사진 경로 복원 — 미리보기 URL은 복원 불가(로컬 objectURL 소멸)라 자리표시로만 보인다.
      setPhotos(Array.from({ length: RESUME_PHOTO_SLOTS }, (_, i) => vals[`photo_${i}`] || null));
      setAcctRegister(vals.acct_register === "true");
      // 옛 초안엔 역할이 비어 있을 수 있다 — 빈 값 복원이 기본값(강사)을 지우면 같은 사고가 재발한다.
      setAcctRole(vals.acct_role || defaultAcctRole);
    },
  });
  const clearDraft = draft.clear;
  // 편집 중일 때만 미저장 가드 활성(뷰 모드는 dirty 없음) → 편집 중 창 X 시 확인.
  const { markSaved } = useUnsavedGuard({ formRef, enabled: editing });
  // "수정중" presence — 둘이 같은 이력서를 동시에 열면 나중 저장이 앞 저장을 조용히 덮는다(soft 경고).
  useEditPresence(id ? `staff-resume:${id}` : undefined, editing);
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
    // 공개 등록(QR): 부모가 완료 화면으로 바꾼다 — 로그인 화면으로 밀어내지 않는다.
    if (onSaved) {
      onSaved(state);
      return;
    }
    // 부가 효과(직원명부 시트 기입) 결과는 토스트로 — 생성 경로는 곧장 새 뷰로 떠나므로 인라인 표시 불가.
    if (state.notice) toast.success(state.notice);
    if (state.warning) toast.warning(state.warning, { duration: 10000 });
    if (id) router.refresh(); // 수정: 배경 서버 데이터 재조회 → 뷰에 반영.
    else if (state.redirectTo) router.push(state.redirectTo); // 생성: 새 이력서 뷰로 이동.
  }, [state, router, clearDraft, markSaved, id, onSaved]);


  function startEdit() {
    setEmpType(data.contract.employmentType);
    setWorkDays(data.contract.workDays);
    setCompany(data.contract.company);
    setDivision(data.contract.division);
    setJobTitle(data.contract.jobTitle);
    setEdus(data.education);
    setCareers(data.career);
    setCerts(data.certificates);
    setLangs(data.languages);
    setChecks(data.checks);
    setPhotos(slotify(data.photos));
    setPreviews(slotify(photoUrls));
    setEditing(true);
  }
  function cancel() {
    // 취소 = 명시적 폐기 → 초안도 함께 비운다. (창 X는 미저장 가드가 잡고, 그땐 초안이 남아 이어쓰기 가능)
    clearDraft();
    if (id) setEditing(false);
    else router.push(returnHref);
  }
  const toggleDay = (key: string) =>
    setWorkDays((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const toggleCheck = (key: ResumeCheckKey) => setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  /** 동적 행 수정 — 마지막 행에 내용이 생기면 자동으로 빈 행 1개 추가(반응형, 캡 DYNAMIC_ROWS_MAX). */
  function updateRow<T extends Record<string, string>>(
    set: React.Dispatch<React.SetStateAction<T[]>>,
    make: () => T,
    index: number,
    key: keyof T & string,
    value: string,
  ) {
    set((prev) => {
      const next = prev.map((row, i) => (i === index ? { ...row, [key]: value } : row));
      const last = next[next.length - 1];
      if (index === next.length - 1 && value.trim() && Object.values(last).some(Boolean) && next.length < DYNAMIC_ROWS_MAX) {
        next.push(make());
      }
      return next;
    });
  }
  const addRow = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, make: () => T) =>
    set((prev) => (prev.length < DYNAMIC_ROWS_MAX ? [...prev, make()] : prev));
  /** @param min 이 아래로는 줄지 않는다 — 학력·경력은 종이 서식 행 수(4·3)가 하한(normalizeResume 패딩과 일치). */
  const removeLastRow = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>, min = 1) =>
    set((prev) => (prev.length > min ? prev.slice(0, -1) : prev));

  /** 증명사진 선택 → 티켓 발급 → 스토리지 PUT → 슬롯에 경로/미리보기 반영. 저장 전에는 DB에 안 남는다. */
  async function pickPhoto(slot: number, file: File | undefined) {
    if (!file) return;
    setUploadingSlot(slot);
    try {
      const fd = new FormData();
      fd.set("contentType", file.type);
      fd.set("size", String(file.size));
      const res = await issueResumePhotoTicket(undefined, fd);
      const ticket = res?.ticket;
      if (!ticket) throw new Error(res?.error ?? t("res.photo.ticketFail"));
      await uploadToTicket(ticket, file);
      setPhotos((prev) => prev.map((p, i) => (i === slot ? ticket.path : p)));
      setPreviews((prev) => prev.map((p, i) => (i === slot ? URL.createObjectURL(file) : p)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("res.photo.uploadFail"));
    } finally {
      setUploadingSlot(null);
    }
  }
  const clearPhoto = (slot: number) => {
    setPhotos((prev) => prev.map((p, i) => (i === slot ? null : p)));
    setPreviews((prev) => prev.map((p, i) => (i === slot ? null : p)));
  };

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
  /** 학력·경력 칸 — 동적 행이라 컨트롤드(DynInput). 마지막 행에 입력하면 updateRow가 빈 행을 하나 붙인다. */
  const dynField = <T extends Record<string, string>>(
    set: React.Dispatch<React.SetStateAction<T[]>>,
    make: () => T,
    prefix: string,
    index: number,
    key: keyof T & string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right" } = {},
  ) =>
    editing ? (
      <DynInput
        name={`${prefix}_${index}_${key}`}
        value={value}
        onChange={(v) => updateRow(set, make, index, key, v)}
        placeholder={opts.ph}
        align={opts.align}
      />
    ) : (
      <>{V(value)}</>
    );
  const eduField = (
    i: number,
    key: keyof ResumeEducation & string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right" } = {},
  ) => dynField(setEdus, emptyEducation, "edu", i, key, value, opts);
  const carField = (
    i: number,
    key: keyof ResumeCareer & string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right" } = {},
  ) => dynField(setCareers, emptyCareer, "car", i, key, value, opts);
  const certField = (
    i: number,
    key: keyof ResumeCert & string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right" } = {},
  ) => dynField(setCerts, emptyCert, "cert", i, key, value, opts);
  const langField = (
    i: number,
    key: keyof ResumeLanguage & string,
    value: string,
    opts: { ph?: string; align?: "left" | "center" | "right" } = {},
  ) => dynField(setLangs, emptyLanguage, "lang", i, key, value, opts);

  // 서식 제목(원장 지시 2026-08-07) — **직원등록일 때만 "직원 명부"**, 저장된 이력서 열람·수정과
  // 기존 직원 연결 작성은 종전대로 "이력서".
  // ⚠️ 직원등록 = ① 사무실 '직원 등록'(계정 섹션이 있는 신규) ② **QR 공개 등록**(isPublic) 둘 다다 —
  //    공개 경로는 assignableRoles를 안 넘겨서(역할이 토큰에 박혀 있다) 조건에서 빠져 "이력서"가 떴다(실측).
  const sheetTitleKey: SheetDictKey =
    !id && !staffUserId && (isPublic || (assignableRoles?.length ?? 0) > 0)
      ? "res.title.roster"
      : "res.title.resume";
  const sheet = (
    <div className="resume-sheet paper-scale border-line bg-card text-foreground mx-auto w-full max-w-[780px] rounded-2xl border shadow-card p-6 sm:p-8 print:rounded-none print:border-2 print:border-foreground/60 print:shadow-none print:p-3">
      <h1 className="text-center text-[26px] font-bold tracking-[0.6em] print:text-[20px]"><P k={sheetTitleKey} /></h1>

      <SectionHead><P k="res.sec.personal" /></SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-28`}><P k="res.f.name" /></th>
            <td className={cell}>
              {field("p_name", p.name, { ph: t("res.f.name") })}
              {/* 개명은 라벨 교체가 아니다 — 옛 이름을 키로 쓰던 과거 기록(교재요청 소유·옛 보고서 귀속)까지
                  서버가 함께 옮긴다. 저장하고 나서 알면 늦으므로 칸 옆에 적는다. */}
              {editing && syncsToAccount ? (
                <p className="text-text-faint mt-1 text-[11px] leading-snug print:hidden">
                  {t("res.sync.name.a")}
                  <b className="text-text-dim">{t("res.sync.name.b")}</b>
                  {t("res.sync.name.c")}
                </p>
              ) : null}
            </td>
            <th className={`${head} w-28`}><P k="res.f.nameEn" /></th>
            <td className={cell}>{field("p_nameEn", p.nameEn, { ph: t("res.ph.nameEn") })}</td>
            {/* 증명사진 2장 — 직원 얼굴 구별용. 한 칸에서 ‹ › 슬라이드로 넘긴다(원장 지시 2026-07-28). */}
            <td className={`${cell} w-[104px] align-top print:w-[80px]`} rowSpan={4} data-label={t("res.f.photo")}>
              {(() => {
                const slot = Math.min(photoSlide, RESUME_PHOTO_SLOTS - 1);
                const url = editing ? previews[slot] : (photoUrls?.[slot] ?? null);
                const hasPath = editing ? Boolean(photos[slot]) : Boolean(data.photos[slot]);
                const step = (d: number) =>
                  setPhotoSlide((s) => (s + d + RESUME_PHOTO_SLOTS) % RESUME_PHOTO_SLOTS);
                // 모바일에선 표가 카드로 쌓여 이 칸이 화면 폭만큼 넓어진다 — 사진만 거대해지지 않게 폭을 캡.
                return (
                  <div className="relative mx-auto w-full max-w-[104px]">
                    <div className="border-foreground/25 bg-bg-soft/40 flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-sm border">
                      {url ? (
                        // 증명사진은 **전체가 보여야 한다**(원장 제보 2026-08-04: 모바일에서 얼굴이 잘려 확대돼 보임).
                        // object-cover는 3:4 틀에 맞춰 원본을 잘라내므로 세로로 긴 원본(폰 카메라)에서 얼굴이 통째로
                        // 날아간다 → contain으로 원본 비율을 유지해 잘림 0(남는 자리는 배경). PC·모바일 결과 동일.
                        // eslint-disable-next-line @next/next/no-img-element -- signed URL/objectURL 미리보기(최적화 불필요)
                        <img src={url} alt={tf("res.photo.alt", { n: slot + 1 })} className="size-full object-contain" />
                      ) : hasPath ? (
                        <span className="text-text-faint px-1 text-center text-[10px]">{t("res.photo.attached")}</span>
                      ) : (
                        <span className="text-text-faint px-1 text-center text-[10px]">{tf("res.photo.slot", { n: slot + 1 })}</span>
                      )}
                    </div>
                    {RESUME_PHOTO_SLOTS > 1 ? (
                      <div className="print:hidden mt-0.5 flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => step(-1)}
                          aria-label={t("res.photo.prev")}
                          className="text-text-dim hover:text-foreground px-0.5 text-[11px] leading-none"
                        >
                          ‹
                        </button>
                        {Array.from({ length: RESUME_PHOTO_SLOTS }, (_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setPhotoSlide(i)}
                            aria-label={tf("res.photo.show", { n: i + 1 })}
                            aria-current={i === slot}
                            className={`size-1.5 rounded-full transition ${i === slot ? "bg-primary" : "bg-line"}`}
                          />
                        ))}
                        <button
                          type="button"
                          onClick={() => step(1)}
                          aria-label={t("res.photo.next")}
                          className="text-text-dim hover:text-foreground px-0.5 text-[11px] leading-none"
                        >
                          ›
                        </button>
                      </div>
                    ) : null}
                    {/* 공개 등록(QR)은 사진 첨부를 받지 않는다 — 업로드 티켓 발급이 인증 경로다(입사 후 사무실에서). */}
                    {editing && !isPublic ? (
                      <div className="print:hidden mt-0.5 flex items-center justify-center gap-1.5">
                        <label className="text-primary relative cursor-pointer text-[10px] font-bold hover:underline">
                          {uploadingSlot === slot
                            ? t("res.photo.uploading")
                            : hasPath
                              ? t("res.photo.change")
                              : t("res.photo.attach")}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            disabled={uploadingSlot !== null}
                            onChange={(e) => {
                              void pickPhoto(slot, e.target.files?.[0]);
                              e.target.value = ""; // 같은 파일 재선택 허용
                            }}
                          />
                        </label>
                        {hasPath ? (
                          <button
                            type="button"
                            onClick={() => clearPhoto(slot)}
                            className="text-text-dim text-[10px] hover:underline"
                          >
                            {t("res.delete")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {/* 저장 제출용 경로 — 슬라이드와 무관하게 **모든 슬롯**을 항상 제출(안 하면 안 보이는 쪽이 유실). */}
                    {editing
                      ? photos.map((p, i) => <input key={i} type="hidden" name={`photo_${i}`} value={p ?? ""} />)
                      : null}
                  </div>
                );
              })()}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.rrn" /></th>
            <td className={`${cell} num`} colSpan={3}>
              {field("p_residentId", p.residentId, { ph: "000000-0000000" })}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.address" /></th>
            <td className={cell} colSpan={3}>
              {field("p_address", p.address, { ph: t("res.f.address") })}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.phone" /></th>
            <td className={`${cell} num`}>{field("p_phone", phoneLabel(p.phone) ?? "", { ph: "010-0000-0000" })}</td>
            <th className={head}>E-mail</th>
            <td className={cell}>
              {field("p_email", p.email, { ph: "email@example.com", type: "email" })}
              {/* 손대면 그 사람이 다음부터 **다른 아이디로** 로그인해야 한다 — 저장하고 나서 알면 늦다.
                  종이 서식엔 없는 화면 전용 안내라 인쇄에서 뺀다. */}
              {editing && syncsToAccount ? (
                <p className="text-text-faint mt-1 text-[11px] leading-snug print:hidden">
                  {t("res.sync.email.a")}
                  <b className="text-text-dim">{t("res.sync.email.b")}</b>
                  {t("res.sync.email.c")}
                </p>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>

      <SectionHead><P k="res.sec.education" /></SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={`${head} w-36`}><P k="res.f.eduPeriod" /></th>
            <th className={head}><P k="res.f.school" /></th>
            <th className={head}><P k="res.f.major" /></th>
            <th className={`${head} w-16`}><P k="res.f.gpa" /></th>
            <th className={head}><P k="res.f.location" /></th>
          </tr>
        </thead>
        <tbody>
          {(editing ? edus : data.education).map((r, i) => (
            <tr key={i}>
              <td className={`${cell} num text-center`} data-label={t("res.f.eduPeriod")}>
                {eduField(i, "period", r.period, { ph: "0000.00 ~ 0000.00", align: "center" })}
              </td>
              {/* 위에서부터 시간순 — 고등학교 → 대학교 → 대학원(원장 지시 2026-07-29, 종전 역순에서 뒤집음).
                  남는 행은 일반 라벨(대학원 위 학력을 강요하지 않는다). */}
              <td className={cell} data-label={t("res.f.school")}>
                {eduField(i, "school", r.school, {
                  ph: EDU_PLACEHOLDER_KEYS[i] ? t(EDU_PLACEHOLDER_KEYS[i]) : t("res.f.school"),
                })}
              </td>
              <td className={cell} data-label={t("res.f.major")}>
                {eduField(i, "major", r.major, { ph: t("res.f.major") })}
              </td>
              {/* 학점만 placeholder가 없어 빈 상자로 보이고 보조기술에도 이름이 없었다 — ph로 이름 부여. */}
              <td className={`${cell} text-center`} data-label={t("res.f.gpa")}>
                {eduField(i, "gpa", r.gpa, { ph: t("res.f.gpa"), align: "center" })}
              </td>
              <td className={cell} data-label={t("res.f.location")}>
                {eduField(i, "location", r.location, { ph: t("res.f.location") })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons
          label={t("res.rows.education")}
          onAdd={() => addRow(setEdus, emptyEducation)}
          onRemove={() => removeLastRow(setEdus, EDU_ROWS)}
        />
      ) : null}

      <SectionHead><P k="res.sec.career" /></SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}><P k="res.f.employer" /></th>
            <th className={`${head} w-36`}><P k="res.f.workPeriod" /></th>
            <th className={head}><P k="res.f.duties" /></th>
            <th className={`${head} w-24`}><P k="res.f.salary" /></th>
            <th className={head}><P k="res.f.leaveReason" /></th>
          </tr>
        </thead>
        <tbody>
          {(editing ? careers : data.career).map((r, i) => (
            <tr key={i}>
              <td className={cell} data-label={t("res.f.employer")}>
                {carField(i, "company", r.company, { ph: t("res.f.employer") })}
              </td>
              <td className={`${cell} num text-center`} data-label={t("res.f.workPeriod")}>
                {carField(i, "period", r.period, { ph: "0000.00 ~ 0000.00", align: "center" })}
              </td>
              <td className={cell} data-label={t("res.f.duties")}>
                {carField(i, "duties", r.duties, { ph: t("res.f.duties") })}
              </td>
              <td className={`${cell} num text-right`} data-label={t("res.f.salary")}>
                {carField(i, "salary", r.salary, { ph: t("res.f.salary"), align: "right" })}
              </td>
              <td className={cell} data-label={t("res.f.leaveReason")}>
                {carField(i, "leaveReason", r.leaveReason, { ph: t("res.f.leaveReason") })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons
          label={t("res.rows.career")}
          onAdd={() => addRow(setCareers, emptyCareer)}
          onRemove={() => removeLastRow(setCareers, CAREER_ROWS)}
        />
      ) : null}

      <SectionHead><P k="res.sec.cert" /></SectionHead>
      <table className={T}>
        <thead>
          <tr>
            <th className={head}><P k="res.f.cert" /></th>
            <th className={`${head} w-32`}><P k="res.f.certDate" /></th>
            <th className={head}><P k="res.f.issuer" /></th>
          </tr>
        </thead>
        <tbody>
          {(editing ? certs : data.certificates).map((r, i) => (
            <tr key={i}>
              <td className={cell} data-label={t("res.f.cert")}>
                {certField(i, "name", r.name, { ph: t("res.ph.certName") })}
              </td>
              <td className={`${cell} num text-center`} data-label={t("res.f.certDate")}>
                {certField(i, "date", r.date, { ph: t("res.f.certDate"), align: "center" })}
              </td>
              <td className={cell} data-label={t("res.f.issuer")}>
                {certField(i, "issuer", r.issuer, { ph: t("res.f.issuer") })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons label={t("res.rows.cert")} onAdd={() => addRow(setCerts, emptyCert)} onRemove={() => removeLastRow(setCerts)} />
      ) : null}
      <table className={`${T} mt-2`}>
        <thead>
          <tr>
            <th className={head}><P k="res.f.lang" /></th>
            <th className={`${head} w-32`}><P k="res.f.testDate" /></th>
            <th className={head}><P k="res.f.score" /></th>
          </tr>
        </thead>
        <tbody>
          {(editing ? langs : data.languages).map((r, i) => (
            <tr key={i}>
              <td className={cell} data-label={t("res.f.lang")}>
                {langField(i, "name", r.name, { ph: t("res.ph.lang") })}
              </td>
              <td className={`${cell} num text-center`} data-label={t("res.f.testDate")}>
                {langField(i, "testDate", r.testDate, { ph: t("res.f.testDate"), align: "center" })}
              </td>
              <td className={`${cell} text-center`} data-label={t("res.f.score")}>
                {langField(i, "score", r.score, { ph: t("res.f.score"), align: "center" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons label={t("res.rows.language")} onAdd={() => addRow(setLangs, emptyLanguage)} onRemove={() => removeLastRow(setLangs)} />
      ) : null}

      <SectionHead><P k="res.sec.contract" /></SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}><P k="res.f.company" /></th>
            <td className={cell}>
              {editing ? (
                // 드롭다운 규약: native select 금지 → SearchableSelect(name = hidden input 제출, 컨트롤드 = 초안 복원).
                <SearchableSelect
                  name="c_company"
                  value={company}
                  onValueChange={setCompany}
                  options={RESUME_COMPANIES.map((v) => ({ value: v, label: v }))}
                  placeholder={t("res.ph.select")}
                  ariaLabel={t("res.f.company")}
                  className="w-full"
                />
              ) : (
                V(c.company)
              )}
            </td>
            {/* 소속부서·근무부서 두 칸을 근무부서 한 칸으로 통합(원장 지시 2026-07-28). */}
            <th className={`${head} w-24`}><P k="res.f.division" /></th>
            <td className={cell}>
              {editing ? (
                <SearchableSelect
                  name="c_division"
                  value={division}
                  onValueChange={(v) => {
                    setDivision(v);
                    // 부서가 바뀌면 직급 선택지도 바뀐다 — 선택지가 하나면 바로 확정(아르바이트),
                    // 새 부서에 없는 직급이 남아 있으면 비운다(엉뚱한 직급이 붙은 채 저장되지 않게).
                    const opts = jobTitlesFor(v);
                    const auto = autoJobTitle(opts);
                    if (auto) setJobTitle(auto);
                    else if (jobTitle && opts.length > 0 && !opts.includes(jobTitle)) setJobTitle("");
                  }}
                  // 지정 6종 + (저장돼 있던 목록 밖 부서는 현재 값으로 유지 — 저장만으로 지워지지 않게).
                  options={[
                    ...RESUME_DEPARTMENTS.map((v) => ({ value: v, label: v })),
                    ...((RESUME_DEPARTMENTS as readonly string[]).includes(division) || !division
                      ? []
                      : [{ value: division, label: tf("res.opt.existing", { v: division }) }]),
                  ]}
                  placeholder={t("res.ph.select")}
                  ariaLabel={t("res.f.division")}
                  className="w-full"
                />
              ) : (
                V(c.division)
              )}
              {/* 담당 과목 = 부서에서 자동 — 두 번 입력하지 않는다(입력 칸 없음, 결과만 보여줌).
                  ⚠️ 부서를 고른 뒤에만 나타나게 하면 그 순간 줄 높이가 늘어 표 전체가 밀린다(원장 제보
                  2026-07-29) → **자리는 항상 잡아두고** 문구만 바뀌게 한다(레이아웃 시프트 0). */}
              {editing ? (
                <p className="text-text-faint mt-1 min-h-[15px] text-[11px] leading-[15px]">
                  {!division
                    ? t("res.subj.auto")
                    : autoSubjects.length > 0
                      ? tf("res.subj.list", {
                          list: autoSubjects.map((k) => subjectMaps.labelOf(k)).join(" · "),
                        })
                      : t("res.subj.none")}
                </p>
              ) : null}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.jobTitle" /></th>
            <td className={cell}>
              {editing ? (
                <SearchableSelect
                  name="c_jobTitle"
                  value={jobTitle}
                  onValueChange={setJobTitle}
                  // 부서 전용 직급 + (저장돼 있던 목록 밖 직급은 현재 값으로 유지).
                  options={[
                    ...jobTitleOptions.map((v) => ({ value: v, label: v })),
                    ...(!jobTitle || jobTitleOptions.includes(jobTitle)
                      ? []
                      : [{ value: jobTitle, label: tf("res.opt.existing", { v: jobTitle }) }]),
                  ]}
                  placeholder={division ? t("res.ph.select") : t("res.ph.divisionFirst")}
                  ariaLabel={t("res.f.jobTitle")}
                  className="w-full"
                />
              ) : (
                V(c.jobTitle)
              )}
            </td>
            <th className={head}><P k="res.f.manager" /></th>
            <td className={cell}>{field("c_manager", c.manager, { ph: t("res.f.manager") })}</td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.workDays" /></th>
            <td className={cell} colSpan={3}>
              {editing
                ? WORKDAYS.map((d) => (
                    // ⚠️ relative 필수 — 안의 `sr-only` input은 `position:absolute`라, 이 라벨이 static이면
                    // 컨테이닝 블록이 문서(ICB)가 되어 셸 main의 overflow 클리핑을 **빠져나간다**. 그러면
                    // 정적 위치(스크롤 안쪽 깊은 y)에 눌러앉아 문서 높이를 늘리고 → 창 안에 스크롤바가
                    // **2개**(main + 문서) 생긴다(원장 제보 2026-07-15, 실측 html 606→1255). [[#79]]
                    <label key={d.key} className="relative mr-3 inline-flex cursor-pointer items-center gap-1 select-none">
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
                        <PV ko={d.label} en={d.en} />
                      </span>
                    </label>
                  ))
                : WORKDAYS.map((d) => (
                    <span key={d.key} className="mr-3 inline-flex items-center gap-1 whitespace-nowrap">
                      {c.workDays.includes(d.key) ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                      <PV ko={d.label} en={d.en} />
                    </span>
                  ))}
            </td>
          </tr>
          {/* 근무시간 — 한 줄 자유 텍스트(원장 2026-10-06). 직원 목록 '근무시간' 열이 이 값을 그대로 보여 준다. */}
          <tr>
            <th className={head}><P k="res.f.workHours" /></th>
            <td className={cell} colSpan={3}>
              {editing ? (
                <EditInput
                  name="c_workHours"
                  defaultValue={c.workHours}
                  placeholder={t("res.ph.workHours")}
                />
              ) : (
                V(c.workHours)
              )}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.pay" /></th>
            <td className={cell} colSpan={3}>
              {editing ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="whitespace-nowrap"><P k="res.pay.monthly" /></span>
                  <span className="min-w-[8rem] flex-1">
                    <EditInput name="c_salaryMonthly" defaultValue={c.salaryMonthly} placeholder={t("res.ph.salaryMonthly")} />
                  </span>
                  <span className="whitespace-nowrap"><P k="res.pay.annual" /></span>
                  <span className="min-w-[8rem] flex-1">
                    {/* placeholder가 "연봉"이면 라벨을 값으로 오입력하기 쉽다(실사고: 시트에 "연봉 연봉") — 예시 금액으로. */}
                    <EditInput name="c_salaryAnnual" defaultValue={c.salaryAnnual} placeholder={t("res.ph.salaryAnnual")} />
                  </span>
                </span>
              ) : (
                <>
                  <P k="res.pay.monthly" /> {c.salaryMonthly || "      "} &nbsp;&nbsp;{" "}
                  <P k="res.pay.annual" /> {c.salaryAnnual || " "}
                </>
              )}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.empType" /></th>
            <td className={cell} colSpan={3}>
              <input type="hidden" name="c_employmentType" value={editing ? empType : ""} />
              {/* ■/□는 종이 서식을 재현한 **그림**이라 보조기술엔 상태가 안 전달된다 —
                  편집은 aria-pressed(토글 버튼), 뷰는 sr-only 텍스트로 선택 여부를 함께 알린다. */}
              {editing
                ? EMPLOYMENT_TYPES.map((emp) => (
                    <button
                      key={emp}
                      type="button"
                      aria-pressed={emp === empType}
                      onClick={() => setEmpType((prev) => (prev === emp ? "" : emp))}
                      className="mr-3 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap"
                    >
                      {emp === empType ? "■" : "□"} <PV ko={emp} en={EMPLOYMENT_TYPE_EN[emp] ?? emp} />
                    </button>
                  ))
                : EMPLOYMENT_TYPES.map((emp) => (
                    // relative — 안의 sr-only(absolute)가 main 클리핑을 빠져나가지 않게(위 라벨과 같은 이유).
                    <span key={emp} className="relative mr-3 whitespace-nowrap">
                      {emp === c.employmentType ? "■" : "□"} <PV ko={emp} en={EMPLOYMENT_TYPE_EN[emp] ?? emp} />
                      <span className="sr-only">
                        {emp === c.employmentType ? t("res.sr.selected") : t("res.sr.notSelected")}
                      </span>
                    </span>
                  ))}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.account" /></th>
            <td className={`${cell} num`} colSpan={3}>
              {editing ? (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-[10rem] flex-[2]">
                    <EditInput name="c_account" defaultValue={c.account} placeholder={t("res.f.account")} />
                  </span>
                  <span className="min-w-[6rem] flex-1">
                    <EditInput name="c_bank" defaultValue={c.bank} placeholder={t("res.ph.bank")} />
                  </span>
                </span>
              ) : (
                <>
                  {V(c.account)} {c.bank ? `(${c.bank})` : <P k="res.bankEmpty" />}
                </>
              )}
            </td>
          </tr>
          <tr>
            <th className={head}><P k="res.f.startDate" /></th>
            <td className={`${cell} num`} colSpan={3}>
              {field("c_startDate", c.startDate, { type: "date" })}
            </td>
          </tr>
        </tbody>
      </table>

      <SectionHead><P k="res.sec.docs" /></SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}><P k="res.f.docs" /></th>
            <td className={cell}>
              {RESUME_CHECKS.map((item) =>
                editing ? (
                  // relative — sr-only input의 absolute 탈출 방지([[#79]], 근무요일 체크박스와 동일).
                  <label key={item.key} className="relative mr-4 inline-flex cursor-pointer items-center gap-1 select-none">
                    <input
                      type="checkbox"
                      name={`chk_${item.key}`}
                      value="1"
                      checked={checks[item.key]}
                      onChange={() => toggleCheck(item.key)}
                      className="sr-only"
                    />
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      {checks[item.key] ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                      <PV ko={item.label} en={item.en} />
                    </span>
                  </label>
                ) : (
                  <span key={item.key} className="relative mr-4 inline-flex items-center gap-1 whitespace-nowrap">
                    {data.checks[item.key] ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                    <PV ko={item.label} en={item.en} />
                    <span className="sr-only">
                      {data.checks[item.key] ? t("res.sr.done") : t("res.sr.notDone")}
                    </span>
                  </span>
                ),
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  const toolbar = (
    <div className="print:hidden flex flex-wrap items-center justify-between gap-2">
      <p className="text-text-dim text-xs">
        {editing ? t("res.hint.editing") : t("res.hint.view")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {/* 편집 중 취소/저장은 하단 고정 FormActionBar로(다른 창 폼과 동일 위치). 뷰 모드 액션만 여기. */}
        {editing ? null : (
          <>
            {canWrite ? (
              <Button type="button" onClick={startEdit}>
                <Pencil className="size-4" />
                {t("res.edit")}
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
      {!id && staffUserId ? <input type="hidden" name="staff_user_id" value={staffUserId} /> : null}
      {/* 공개 등록(QR) — 이 토큰이 유일한 자격증명이다(서버가 활성·만료·상한을 재검증). */}
      {publicToken ? <input type="hidden" name="intake_token" value={publicToken} /> : null}
      {isPublic ? null : toolbar}
      {id ? <EditingBanner scope={`staff-resume:${id}`} /> : null}
      {isPublic ? null : (
        <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
      )}
      {state?.error ? (
        // 한글 요약만 노출 — 기술 원문(detail)은 title 툴팁으로만(UI에 raw 에러 금지).
        <p className="text-danger flex items-center gap-1.5 text-sm" title={state.detail}>
          <AlertCircle className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}
      {sheet}
      {/* 원샷 직원 등록(신규 작성 전용) — 저장하면서 인적사항 E-mail로 로그인 계정까지 생성(원장 지시 2026-07-28). */}
      {!id && assignableRoles && assignableRoles.length > 0 ? (
        <div className="print:hidden border-line bg-card mx-auto w-full max-w-[780px] rounded-2xl border p-4 shadow-card">
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              name="acct_register"
              value="1"
              checked={acctRegister}
              onChange={() => setAcctRegister((v) => !v)}
              className="sr-only"
            />
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold">
              {acctRegister ? <CheckSquare size={15} aria-hidden="true" /> : <Square size={15} aria-hidden="true" />}
              {t("res.acct.register")}
            </span>
          </label>
          {acctRegister ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-text-dim text-[12.5px]">{t("res.acct.role")}</span>
              <SearchableSelect
                name="acct_role"
                value={acctRole}
                onValueChange={setAcctRole}
                options={assignableRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                placeholder={t("res.acct.rolePh")}
                ariaLabel={t("res.acct.roleAria")}
                className="w-40"
              />
              <p className="text-text-dim w-full text-[12px]">
                {t("res.acct.note.a")}
                <span className="num font-bold">{INITIAL_STAFF_PASSWORD}</span>
                {t("res.acct.note.b")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      <FormActionBar>
        {/* 공개 등록엔 '취소'로 돌아갈 화면이 없다(로그인 없이 링크로 들어온 사람) — 제출만 남긴다. */}
        {isPublic ? null : (
          <Button type="button" variant="outline" onClick={cancel}>
            <X className="size-4" />
            {t("res.cancel")}
          </Button>
        )}
        {/* 생성 성공 후 새 뷰로 이동할 때까지 잠금 유지 → 중복 INSERT 방지 */}
        <SaveButton done={!id && !!state?.ok} />
      </FormActionBar>
    </form>
  );
}
