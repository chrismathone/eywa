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
} from "@/components/icons/eywa-icon-compat";
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
import {
  DYNAMIC_ROWS_MAX,
  EMPLOYMENT_TYPES,
  emptyCert,
  emptyLanguage,
  INITIAL_STAFF_PASSWORD,
  RESUME_CHECKS,
  RESUME_COMPANIES,
  RESUME_DEPARTMENTS,
  RESUME_DRAFT_EXCLUDE,
  RESUME_PHOTO_SLOTS,
  WORKDAYS,
  type ResumeCert,
  type ResumeCheckKey,
  type ResumeLanguage,
  type StaffResumeData,
} from "@/features/staff/resume";
import {
  issueResumePhotoTicket,
  saveStaffResume,
  type ResumeActionState,
} from "@/features/staff/server/resume-actions";
import { DeleteResumeButton, PrintResumeButton } from "./resume-buttons";

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

function SectionHead({ children }: { children: React.ReactNode }) {
  return <h2 className="text-foreground mt-5 mb-1.5 text-[13px] font-bold print:mt-3 print:text-[12px]">{children}</h2>;
}

/** 동적 섹션의 행 +/− 버튼 — 마지막 행에 입력하면 자동으로도 늘어나고, 버튼으로도 조절(원장 요청). */
function RowButtons({ label, onAdd, onRemove }: { label: string; onAdd: () => void; onRemove: () => void }) {
  return (
    <div className="print:hidden mt-1 flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={onAdd}
        aria-label={`${label} 행 추가`}
        className="border-line text-text-dim hover:text-foreground hover:border-primary/40 inline-flex size-6 items-center justify-center rounded-md border transition"
      >
        <Plus size={12} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label} 마지막 행 삭제`}
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
 * @param done 저장은 끝났고 새 이력서 뷰로 **이동 중**일 때 true — 계속 잠가 둔다.
 * `pending`은 액션 resolve 즉시 풀리는데 생성 경로는 router.push(RSC 네비)가 수백ms 더 걸려,
 * 그 사이 재클릭하면 id 없는 폼이 한 번 더 제출돼 **같은 사람 이력서가 2건** 생긴다.
 */
function SaveButton({ done = false }: { done?: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || done;
  return (
    <Button type="submit" disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

/** photos 배열 → 고정 슬롯 배열(길이 RESUME_PHOTO_SLOTS, 빈 슬롯 null). */
const slotify = <T,>(arr: readonly T[] | undefined): (T | null)[] =>
  Array.from({ length: RESUME_PHOTO_SLOTS }, (_, i) => arr?.[i] ?? null);

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
}) {
  const [editing, setEditing] = useState(startEditing);
  const [state, formAction] = useActionState<ResumeActionState, FormData>(saveStaffResume, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  // 근무형태(단일 선택)·근무요일(다중)은 컨트롤드 — 초안 복원 시 onRestore로 rehydrate.
  const [empType, setEmpType] = useState(data.contract.employmentType);
  const [workDays, setWorkDays] = useState<string[]>(data.contract.workDays);
  // 회사 구분·근무부서(SearchableSelect = hidden input 제출)도 컨트롤드 — 초안 복원 동일 경로.
  const [company, setCompany] = useState(data.contract.company);
  const [division, setDivision] = useState(data.contract.division);
  // 동적 행(자격증·외국어)·서류 체크·사진은 컨트롤드 — 행 추가/삭제·복원이 상태 기준으로 돌아야 안전.
  const [certs, setCerts] = useState<ResumeCert[]>(data.certificates);
  const [langs, setLangs] = useState<ResumeLanguage[]>(data.languages);
  const [checks, setChecks] = useState<Record<ResumeCheckKey, boolean>>(data.checks);
  const [photos, setPhotos] = useState<(string | null)[]>(slotify(data.photos));
  // 미리보기 URL — 기존 저장분은 서버 signed URL, 방금 올린 파일은 로컬 objectURL.
  const [previews, setPreviews] = useState<(string | null)[]>(slotify(photoUrls));
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  // 원샷 직원 등록(생성 화면 전용) — 서버가 권한·역할을 재검증한다.
  const [acctRegister, setAcctRegister] = useState(false);
  const [acctRole, setAcctRole] = useState("");

  const draft = useFormDraft({
    // 스코프에 userId 포함 — 사무실 공용 PC에서 앞사람 초안이 뒷사람에게 복구 제안되면 안 된다.
    scope: `staff-resume:${userId}:${id ?? "new"}`,
    formRef,
    enabled: editing,
    // 주민번호·계좌·급여는 IDB에 아예 안 남긴다(재인증 잠금 우회 차단) — 복구 시 그 칸만 비어 있다.
    exclude: RESUME_DRAFT_EXCLUDE,
    onRestore: (vals) => {
      setEmpType(vals.c_employmentType ?? "");
      setWorkDays(WORKDAYS.filter((d) => vals[`c_workday_${d.key}`] === "true").map((d) => d.key));
      setCompany(vals.c_company ?? "");
      setDivision(vals.c_division ?? "");
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
      setAcctRole(vals.acct_role ?? "");
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
    // 부가 효과(직원명부 시트 기입) 결과는 토스트로 — 생성 경로는 곧장 새 뷰로 떠나므로 인라인 표시 불가.
    if (state.notice) toast.success(state.notice);
    if (state.warning) toast.warning(state.warning, { duration: 10000 });
    if (id) router.refresh(); // 수정: 배경 서버 데이터 재조회 → 뷰에 반영.
    else if (state.redirectTo) router.push(state.redirectTo); // 생성: 새 이력서 뷰로 이동.
  }, [state, router, clearDraft, markSaved, id]);

  function startEdit() {
    setEmpType(data.contract.employmentType);
    setWorkDays(data.contract.workDays);
    setCompany(data.contract.company);
    setDivision(data.contract.division);
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
    else router.push("/staff?tab=resumes");
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
  const removeLastRow = <T,>(set: React.Dispatch<React.SetStateAction<T[]>>) =>
    set((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

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
      if (!ticket) throw new Error(res?.error ?? "업로드 티켓 발급 실패");
      await uploadToTicket(ticket, file);
      setPhotos((prev) => prev.map((p, i) => (i === slot ? ticket.path : p)));
      setPreviews((prev) => prev.map((p, i) => (i === slot ? URL.createObjectURL(file) : p)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진 업로드에 실패했습니다");
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

  const sheet = (
    <div className="resume-sheet border-line bg-card text-foreground mx-auto w-full max-w-[780px] rounded-2xl border shadow-card p-6 sm:p-8 print:rounded-none print:border-2 print:border-foreground/60 print:shadow-none print:p-3">
      <h1 className="text-center text-[26px] font-bold tracking-[0.6em] print:text-[20px]">이력서</h1>

      <SectionHead>1. 인적사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-28`}>성명</th>
            <td className={cell}>{field("p_name", p.name, { ph: "성명" })}</td>
            <th className={`${head} w-28`}>영문</th>
            <td className={cell}>{field("p_nameEn", p.nameEn, { ph: "영문 이름" })}</td>
            {/* 증명사진 2장 — 직원 얼굴 구별용(원장 지시 2026-07-28). rowSpan으로 종이 이력서 사진칸 재현. */}
            <td className={`${cell} w-[92px] align-top print:w-[80px]`} rowSpan={4}>
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: RESUME_PHOTO_SLOTS }, (_, slot) => {
                  const url = editing ? previews[slot] : (photoUrls?.[slot] ?? null);
                  const hasPath = editing ? Boolean(photos[slot]) : Boolean(data.photos[slot]);
                  return (
                    <div key={slot} className="relative">
                      <div className="border-foreground/25 bg-bg-soft/40 flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-sm border">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- signed URL/objectURL 미리보기(최적화 불필요)
                          <img src={url} alt={`증명사진 ${slot + 1}`} className="size-full object-cover" />
                        ) : hasPath ? (
                          <span className="text-text-faint px-1 text-center text-[10px]">사진 첨부됨</span>
                        ) : (
                          <span className="text-text-faint px-1 text-center text-[10px]">사진 {slot + 1}</span>
                        )}
                      </div>
                      {editing ? (
                        <div className="print:hidden mt-0.5 flex items-center justify-center gap-1">
                          <label className="text-primary relative cursor-pointer text-[10px] font-bold hover:underline">
                            {uploadingSlot === slot ? "올리는 중…" : hasPath ? "변경" : "첨부"}
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
                              삭제
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {/* 저장 제출용 경로 — 파일 자체는 티켓으로 이미 업로드됨. */}
                      {editing ? <input type="hidden" name={`photo_${slot}`} value={photos[slot] ?? ""} /> : null}
                    </div>
                  );
                })}
              </div>
            </td>
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
              {/* 맨 아래 행 = 고등학교, 그 위 = 대학교(최상위 학력을 맨 위에 쓰는 서식 관례). */}
              <td className={cell}>
                {field(`edu_${i}_school`, r.school, { ph: i === data.education.length - 1 ? "고등학교" : "대학교" })}
              </td>
              <td className={cell}>{field(`edu_${i}_major`, r.major, { ph: "전공" })}</td>
              {/* 학점만 placeholder가 없어 빈 상자로 보이고 보조기술에도 이름이 없었다 — ph로 이름 부여. */}
              <td className={`${cell} text-center`}>
                {field(`edu_${i}_gpa`, r.gpa, { ph: "학점", align: "center" })}
              </td>
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
          {(editing ? certs : data.certificates).map((r, i) => (
            <tr key={i}>
              <td className={cell}>
                {editing ? (
                  <input
                    name={`cert_${i}_name`}
                    value={r.name}
                    onChange={(e) => updateRow(setCerts, emptyCert, i, "name", e.target.value)}
                    placeholder="자격증명"
                    className={inputBase}
                  />
                ) : (
                  V(r.name)
                )}
              </td>
              <td className={`${cell} num text-center`}>
                {editing ? (
                  <input
                    name={`cert_${i}_date`}
                    value={r.date}
                    onChange={(e) => updateRow(setCerts, emptyCert, i, "date", e.target.value)}
                    placeholder="취득년월일"
                    className={`${inputBase} text-center`}
                  />
                ) : (
                  V(r.date)
                )}
              </td>
              <td className={cell}>
                {editing ? (
                  <input
                    name={`cert_${i}_issuer`}
                    value={r.issuer}
                    onChange={(e) => updateRow(setCerts, emptyCert, i, "issuer", e.target.value)}
                    placeholder="발행처"
                    className={inputBase}
                  />
                ) : (
                  V(r.issuer)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons label="자격증" onAdd={() => addRow(setCerts, emptyCert)} onRemove={() => removeLastRow(setCerts)} />
      ) : null}
      <table className={`${T} mt-2`}>
        <thead>
          <tr>
            <th className={head}>외국어 능력</th>
            <th className={`${head} w-32`}>시험일</th>
            <th className={head}>점수/등급</th>
          </tr>
        </thead>
        <tbody>
          {(editing ? langs : data.languages).map((r, i) => (
            <tr key={i}>
              <td className={cell}>
                {editing ? (
                  <input
                    name={`lang_${i}_name`}
                    value={r.name}
                    onChange={(e) => updateRow(setLangs, emptyLanguage, i, "name", e.target.value)}
                    placeholder="외국어 (시험명)"
                    className={inputBase}
                  />
                ) : (
                  V(r.name)
                )}
              </td>
              <td className={`${cell} num text-center`}>
                {editing ? (
                  <input
                    name={`lang_${i}_testDate`}
                    value={r.testDate}
                    onChange={(e) => updateRow(setLangs, emptyLanguage, i, "testDate", e.target.value)}
                    placeholder="시험일"
                    className={`${inputBase} text-center`}
                  />
                ) : (
                  V(r.testDate)
                )}
              </td>
              <td className={`${cell} text-center`}>
                {editing ? (
                  <input
                    name={`lang_${i}_score`}
                    value={r.score}
                    onChange={(e) => updateRow(setLangs, emptyLanguage, i, "score", e.target.value)}
                    placeholder="점수/등급"
                    className={`${inputBase} text-center`}
                  />
                ) : (
                  V(r.score)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing ? (
        <RowButtons label="외국어" onAdd={() => addRow(setLangs, emptyLanguage)} onRemove={() => removeLastRow(setLangs)} />
      ) : null}

      <SectionHead>5. 계약사항</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}>회사 구분</th>
            <td className={cell}>
              {editing ? (
                // 드롭다운 규약: native select 금지 → SearchableSelect(name = hidden input 제출, 컨트롤드 = 초안 복원).
                <SearchableSelect
                  name="c_company"
                  value={company}
                  onValueChange={setCompany}
                  options={RESUME_COMPANIES.map((v) => ({ value: v, label: v }))}
                  placeholder="선택"
                  ariaLabel="회사 구분"
                  className="w-full"
                />
              ) : (
                V(c.company)
              )}
            </td>
            {/* 소속부서·근무부서 두 칸을 근무부서 한 칸으로 통합(원장 지시 2026-07-28). */}
            <th className={`${head} w-24`}>근무부서</th>
            <td className={cell}>
              {editing ? (
                <SearchableSelect
                  name="c_division"
                  value={division}
                  onValueChange={setDivision}
                  options={RESUME_DEPARTMENTS.map((v) => ({ value: v, label: v }))}
                  placeholder="선택"
                  ariaLabel="근무부서"
                  className="w-full"
                />
              ) : (
                V(c.division)
              )}
            </td>
          </tr>
          <tr>
            <th className={head}>담당자</th>
            <td className={cell} colSpan={3}>
              {field("c_manager", c.manager, { ph: "담당자" })}
            </td>
          </tr>
          <tr>
            <th className={head}>근무요일</th>
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
                    {/* placeholder가 "연봉"이면 라벨을 값으로 오입력하기 쉽다(실사고: 시트에 "연봉 연봉") — 예시 금액으로. */}
                    <EditInput name="c_salaryAnnual" defaultValue={c.salaryAnnual} placeholder="예: 40,000,000원" />
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
              {/* ■/□는 종이 서식을 재현한 **그림**이라 보조기술엔 상태가 안 전달된다 —
                  편집은 aria-pressed(토글 버튼), 뷰는 sr-only 텍스트로 선택 여부를 함께 알린다. */}
              {editing
                ? EMPLOYMENT_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={t === empType}
                      onClick={() => setEmpType((prev) => (prev === t ? "" : t))}
                      className="mr-3 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap"
                    >
                      {t === empType ? "■" : "□"} {t}
                    </button>
                  ))
                : EMPLOYMENT_TYPES.map((t) => (
                    // relative — 안의 sr-only(absolute)가 main 클리핑을 빠져나가지 않게(위 라벨과 같은 이유).
                    <span key={t} className="relative mr-3 whitespace-nowrap">
                      {t === c.employmentType ? "■" : "□"} {t}
                      <span className="sr-only">{t === c.employmentType ? " 선택됨" : " 선택 안 함"}</span>
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

      <SectionHead>6. 제출서류 확인</SectionHead>
      <table className={T}>
        <tbody>
          <tr>
            <th className={`${head} w-32`}>서류 확인</th>
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
                      {item.label}
                    </span>
                  </label>
                ) : (
                  <span key={item.key} className="relative mr-4 inline-flex items-center gap-1 whitespace-nowrap">
                    {data.checks[item.key] ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
                    {item.label}
                    <span className="sr-only">{data.checks[item.key] ? " 완료" : " 미완료"}</span>
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
      {id ? <EditingBanner scope={`staff-resume:${id}`} /> : null}
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
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
              저장하면서 직원 계정도 함께 등록
            </span>
          </label>
          {acctRegister ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-text-dim text-[12.5px]">시스템 역할</span>
              <SearchableSelect
                name="acct_role"
                value={acctRole}
                onValueChange={setAcctRole}
                options={assignableRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                placeholder="역할 선택"
                ariaLabel="직원 계정 역할"
                className="w-40"
              />
              <p className="text-text-dim w-full text-[12px]">
                인적사항의 E-mail로 로그인 계정을 만들고, 초기 비밀번호는{" "}
                <span className="num font-bold">{INITIAL_STAFF_PASSWORD}</span> — 본인이 로그인 후 변경합니다. 같은
                이메일 직원이 이미 있으면 새로 만들지 않고 그 직원과 이력서를 연결합니다.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      <FormActionBar>
        <Button type="button" variant="outline" onClick={cancel}>
          <X className="size-4" />
          취소
        </Button>
        {/* 생성 성공 후 새 뷰로 이동할 때까지 잠금 유지 → 중복 INSERT 방지 */}
        <SaveButton done={!id && !!state?.ok} />
      </FormActionBar>
    </form>
  );
}
