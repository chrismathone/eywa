"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BookOpen, Eye, User, X } from "@/components/icons/aywa-icon-compat";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { kstToday } from "@/lib/date-kst";
import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import type { AccountSetting } from "@/features/owner/settings-types";
import { requestTextbook, type TextbookState } from "@/features/billing/server/textbook-actions";
import { TextbookMentField, useMentDraft } from "@/features/billing/textbook-ment";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import {
  TextbookRequestCardBody,
  type TextbookCardData,
} from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import { downloadCardPng } from "@/app/(print)/textbook/[id]/print/download-card";
import { RequestHistory } from "./request-history";
import { TextbookFormFooter } from "./_form-footer";
import { TextbookSendDialog } from "./_send-dialog";
import { requestFingerprint, sameSavedRequest, type SavedRequest } from "./_saved-request";

// 교재 요청 — ijw TextbookRequestView 구조 그대로 이식(선생님들이 익숙한 화면):
// 좌측 폼(기본 정보 → 교재 내용) + 우측 실시간 종이 서식 미리보기 + '이미지 저장 및 기록' 단일 버튼
// (PNG 자동 다운로드 + DB 기록) + 아래 요청 내역(미완료/완료 탭·검색·페이지네이션 — request-history.tsx).
// aywa 유지분: 학생=FK 선택(강사 스코프)·계좌=학원설정 자동(카드에 표시) — 데이터 모델은 불변.

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-line text-foreground flex items-center gap-1.5 border-b pb-1.5 text-xs font-bold">
      {icon}
      {children}
    </div>
  );
}

export function TextbookRequestClient({
  rows,
  students,
  catalog,
  isTeacher,
  academyName,
  logoUrl,
  account,
  requesterName,
  viewerUserId,
  initialStudentIds,
  classnoteOn = true,
  canWrite,
}: {
  /**
   * 교재 요청 쓰기 권한 — 서버 게이트(`canWriteTenant("textbook_requests")`, 같은 행위자)와 같은 판정을 page.tsx가 내린다.
   * false(읽기 권한)면 양식 칸은 잠그고 권한 안내를 띄우며, 저장·발송·수정·삭제 단추는 그리지 않는다
   * (원장 2026-11-05 — 양식을 다 쓴 뒤에야 "교재 요청 권한이 없습니다"가 떴다, write-lock.ts).
   */
  canWrite: boolean;
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  isTeacher: boolean;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  requesterName: string;
  /** 보는 사람 계정 id — 소유 판정 합집합(0174a). 이름이 달라도 본인이 만든 요청은 본인 것. */
  viewerUserId: string;
  /** `?studentId=`로 실려 온 학생(등록상담에서 수학 반 배정 직후 넘어온 링크). 없으면 빈 폼 그대로. */
  initialStudentIds?: string[];
  /** ClassNote 기능(모듈) 켜짐 — 꺼진 학원엔 학부모 발송(클래스노트)·발송 문구 칸이 없다(2026-09-30 "꺼지면 흔적 없이"). */
  classnoteOn?: boolean;
}) {
  // 성공 시 목록은 서버 액션 revalidatePath로 자동 갱신. 폼 값은 유지(같은 학생 다른 교재 연속 요청에 편함).
  const [state, formAction, pending] = useActionState(requestTextbook, undefined);

  // 전 필드 controlled — 우측 실시간 미리보기의 데이터 소스이자, '교재 검색'(단가표) 자동입력 대상.
  // 🔴 **내 목록에 있는 학생만** 초기값으로 받는다 — 스코프 밖 id를 그대로 담으면 칩에 이름 대신
  //    raw UUID가 뜨고(UI에 raw 코드 금지) 저장은 서버에서 거절돼 이유 없는 실패가 된다.
  // 읽기 권한이면 링크로 온 학생도 담지 않는다 — 잠긴 양식에 칩만 차 있으면 쓸 수 있는 것처럼 보인다.
  const [studentIds, setStudentIds] = useState<string[]>(() =>
    canWrite ? (initialStudentIds ?? []).filter((id) => students.some((s) => s.id === id)) : [],
  );
  // 링크로 왔는데 그 학생이 내 목록에 없으면(담당 스코프 밖·퇴원) **말해 준다** — 그냥 비우면
  // "링크를 눌렀는데 아무것도 안 채워졌다"가 되어 원인을 아무도 모른다.
  const prefillDropped = canWrite && (initialStudentIds ?? []).some((id) => !students.some((s) => s.id === id));
  // 읽기 권한이면 담임 칸을 비워 둔다 — 값이 차 있으면 권한 안내(placeholder)가 안 보인다.
  const [teacherName, setTeacherName] = useState(canWrite ? requesterName : "");
  const lockedHint = canWrite ? undefined : writeLockedPlaceholder("textbook_requests");
  const [requestDate, setRequestDate] = useState(kstToday());
  const [bookName, setBookName] = useState("");
  const [bookDetail, setBookDetail] = useState("");
  const [price, setPrice] = useState<number | string>("");
  const [notes, setNotes] = useState("");
  const [handledId, setHandledId] = useState<string | null>(null); // 자동 다운로드 1회 가드(#67)
  // 학부모 발송 다이얼로그 대상(교재요청 id들). null이면 미마운트 — 항상 마운트된 다이얼로그의 재오픈 함정(#67) 회피.
  const [sendIds, setSendIds] = useState<string[] | null>(null);
  // '초기화'는 폼만 비우고 useActionState 결과는 못 지우므로, 직전 결과 메시지를 함께 숨긴다(잔존 방지).
  const [msgHiddenFor, setMsgHiddenFor] = useState<TextbookState>(undefined);
  // 학부모용 문구 — 저장된 내 멘트를 불러오고(autoLoad) 입력이 멈추면 자동 저장. 발송창으로 그대로 이어진다.
  const { ment, edit: editMent } = useMentDraft({ autoLoad: true });
  const formRef = useRef<HTMLFormElement>(null);
  const fp = requestFingerprint({ studentIds, teacherName, requestDate, bookName, bookDetail, price, notes });
  const [sending, setSending] = useState(false); // '클래스노트 발송' 경로의 저장 진행 표시
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // 마지막으로 기록한 요청 — 같은 내용으로 다른 버튼을 눌러도 새 요청을 만들지 않는다(_saved-request.ts).
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const [submitFp, setSubmitFp] = useState<string | null>(null); // '이미지 저장 및 기록'을 누른 순간의 폼 지문

  // 바로 다운로드 — 카드 데이터를 화면 밖에 렌더 → html2canvas → PNG 저장(새 탭·창 없음).
  // 여러 명 일괄 발행을 위해 **큐**: head를 렌더 → 다운로드 완료 후 slice → 다음. k는 updater에서 파생(단조).
  const [dlQueue, setDlQueue] = useState<{ data: TextbookCardData; k: number }[]>([]);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const dlHead = dlQueue[0] ?? null;
  useEffect(() => {
    if (!dlHead) return;
    let cancelled = false;
    // 로고 이미지 로드 후 canvas가 정확하도록 짧게 지연. 다운로드 완료 후 다음 카드로 진행(순차 발행 — 레이스 방지).
    const t = setTimeout(() => {
      if (cancelled) return;
      const el = hiddenRef.current;
      const advance = () => {
        if (!cancelled) setDlQueue((q) => q.slice(1));
      };
      if (!el) {
        advance();
        return;
      }
      void downloadCardPng(el, dlHead.data.requestDate, dlHead.data.studentName, dlHead.data.bookName)
        .catch(() => {})
        .finally(advance);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dlHead?.k]);
  // 카드 데이터 배열을 큐에 추가(k는 마지막 항목에서 이어 단조 증가 — 드레인 후 재사용도 remount라 안전).
  const enqueueCards = (items: TextbookCardData[]) =>
    setDlQueue((q) => {
      const base = (q[q.length - 1]?.k ?? 0) + 1;
      return [...q, ...items.map((data, i) => ({ data, k: base + i }))];
    });
  const download = (row: TextbookOrderRow) =>
    enqueueCards([
      {
        studentName: row.studentName,
        teacherName: row.teacherName,
        requestDate: row.requestDate,
        bookName: row.bookName,
        bookDetail: row.bookDetail,
        price: row.price,
      },
    ]);

  const options = students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }));
  // 교재 검색 옵션 — 타이핑하면 SearchableSelect가 즉시 필터. hint에 가격(+상세)을 보여 고르기 쉽게.
  const catalogOptions = catalog.map((c) => ({
    value: c.id,
    label: c.title,
    // 금액·상세를 **열로** 가른다(원장 2026-09-09 "목록 열맞춤") — 한 문자열로 붙이면 이름 길이에 밀려 들쭉날쭉.
    hint: `${c.price.toLocaleString()}원`,
    meta: c.bookDetail ?? "",
  }));
  const pickCatalog = (id: string) => {
    const c = catalog.find((x) => x.id === id);
    if (!c) return;
    setBookName(c.title);
    setBookDetail(c.bookDetail ?? "");
    setPrice(c.price);
  };

  // ijw '초기화' — confirm 후 오늘 날짜·본인 담임만 남기고 리셋(계좌는 학원설정이라 폼에 없음).
  const reset = () => {
    if (!window.confirm("입력한 내용을 모두 초기화하시겠습니까?")) return;
    setStudentIds([]);
    setTeacherName(requesterName);
    setRequestDate(kstToday());
    setBookName("");
    setBookDetail("");
    setPrice("");
    setNotes("");
    setMsgHiddenFor(state); // 직전 성공/에러 문구도 함께 치움
    setNotice(null);
    setSaved(null); // 지우고 새로 쓰면 새 요청이다
  };

  /**
   * '클래스노트 발송' — 기록을 먼저 남기고(요청 생성) 발송창을 연다. **저장이 실패하면 열지 않는다.**
   * ⚠️ submit을 가로채지 않는다(type="button" + 액션 직접 호출) — '이미지 저장 및 기록'의 PNG 자동 저장
   *    흐름(useActionState → enqueueCards)은 그대로 둔다. 이 경로는 PNG 없이 기록만 남긴다(두 동작 분리).
   */
  async function saveAndSend() {
    const form = formRef.current;
    if (!form || sending) return;
    const same = sameSavedRequest(saved, fp);
    if (same) {
      // 방금 기록한 요청 그대로 — 새로 만들면 같은 줄이 둘 생긴다(지우다 발송한 쪽을 지운 9건).
      setMsgHiddenFor(state);
      setNotice({ kind: "ok", text: "방금 기록한 요청을 발송합니다 — 새로 기록하지 않았어요" });
      setSendIds(same.created.map((c) => c.id));
      return;
    }
    const sentFp = fp;
    setSending(true);
    setNotice(null);
    const res = await requestTextbook(undefined, new FormData(form));
    setSending(false);
    const ids = res?.ok ? (res.created ?? []).map((c) => c.id) : [];
    if (!res?.ok || ids.length === 0) {
      setNotice({
        kind: "error",
        text:
          res?.error ??
          Object.values(res?.fieldErrors ?? {})[0] ??
          "저장하지 못해 발송을 시작할 수 없습니다",
      });
      return;
    }
    setSaved({ fp: sentFp, created: res.created ?? [] });
    setMsgHiddenFor(state); // 직전 저장 안내와 겹치지 않게
    setNotice({ kind: "ok", text: `${ids.length}건을 기록했습니다 — 발송창에서 학부모에게 보낼 수 있어요` });
    setSendIds(ids);
  }

  // 선택된 학생들(칩·미리보기용) + 추가 셀렉트에서 이미 선택된 건 제외.
  const selectedStudents = studentIds.map((id) => ({
    id,
    name: options.find((o) => o.value === id)?.label ?? id,
  }));
  const availableOptions = options.filter((o) => !studentIds.includes(o.value));
  const firstStudentName = selectedStudents[0]?.name ?? "";

  // 저장 성공 → 요청서 PNG 자동 다운로드(ijw '이미지 저장 및 기록' 패리티). rows(사무실은 최근 100건
  // 절단)에 의존하지 않고 **제출한 폼 스냅샷**으로 즉시 발화 — 백데이트·절단과 무관하게 항상 다운로드.
  // 렌더 중 상태조정(#25 회피) + createdId 키 가드(#67). 서버 저장값과 동일 규칙(빈 날짜=오늘).
  const created = state?.ok ? state.created : undefined;
  const createdKey = created && created.length > 0 ? created[0].id : undefined;
  if (createdKey && createdKey !== handledId) {
    setHandledId(createdKey);
    setSaved({ fp: submitFp ?? fp, created: created! });
    // 학생별 요청서 1장씩 — 서버가 반환한 각 학생 이름으로(교재·금액·담임·날짜는 공통).
    enqueueCards(
      created!.map((c) => ({
        studentName: c.studentName,
        teacherName: teacherName.trim() || requesterName,
        requestDate: requestDate || kstToday(),
        bookName,
        bookDetail: bookDetail.trim() || null,
        price: Math.max(0, Number(price) || 0),
      })),
    );
  }

  // '이미지 저장 및 기록' — 방금 기록한 요청과 같으면 기록하지 않고 요청서 이미지만 다시 받는다.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // 읽기 권한 — 저장 단추가 없지만 Enter 제출 등 어떤 경로로도 기록을 시도하지 않는다(서버도 거절한다).
    if (!canWrite) {
      e.preventDefault();
      return;
    }
    const same = sameSavedRequest(saved, fp);
    if (!same) {
      setSubmitFp(fp);
      return; // 평소대로 서버 액션이 기록한다
    }
    e.preventDefault(); // React는 onSubmit이 막으면 form action을 부르지 않는다
    enqueueCards(
      same.created.map((c) => ({
        studentName: c.studentName,
        teacherName: teacherName.trim() || requesterName,
        requestDate: requestDate || kstToday(),
        bookName,
        bookDetail: bookDetail.trim() || null,
        price: Math.max(0, Number(price) || 0),
      })),
    );
    setMsgHiddenFor(state);
    setNotice({ kind: "ok", text: "이미 기록한 요청이라 요청서 이미지만 다시 저장합니다 — 새로 기록하지 않았어요" });
  };

  const showMsg = state !== undefined && state !== msgHiddenFor;
  // 필수(학생·교재명)가 다 채워져야 저장 가능 — 서버 검증(fieldErrors)과 이중, 미충족이면 버튼 비활성화.
  const canSubmit = studentIds.length > 0 && bookName.trim() !== "";

  return (
    <div className="w-full min-w-0 space-y-6 p-4 md:p-6">
      {/* ⚠️ 수제 헤더가 아니라 공용 PageHeader — 창(embed)·모바일 컴팩트 행과 구분선이 여기 한 곳에서 온다. */}
      <PageHeader
        eyebrow="운영"
        title="교재 요청"
        description={
          isTeacher
            ? "담당 학생의 교재를 요청하면 사무실에서 등록·납부·주문을 처리합니다."
            : "교재 요청 목록 — 사무실은 수납관리 › 교재에서 등록·납부·주문을 처리합니다."
        }
      />

      {students.length === 0 ? (
        <p className="text-text-dim border-line rounded-2xl border p-4 text-sm">
          담당 학생이 없어 교재를 요청할 수 없습니다.
        </p>
      ) : (
        <form
          ref={formRef}
          action={formAction}
          onSubmit={onSubmit}
          className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_minmax(0,3fr)] lg:items-start"
        >
          {/* 좌: 작성 폼 (ijw 기본 정보 → 교재 내용 섹션 구조) */}
          <section className="border-line bg-card space-y-5 rounded-2xl border p-4">
            {/* 요청 일자·교재 검색처럼 placeholder로 알릴 수 없는 칸이 있어 양식 머리에 한 줄로도 알린다. */}
            {!canWrite ? (
              <p className="text-text-dim bg-bg-soft rounded-lg px-3 py-2 text-xs">{writeLockedNote("textbook_requests")}</p>
            ) : null}
            <div className="space-y-3">
              <SectionLabel icon={<User className="size-3.5" />}>기본 정보</SectionLabel>
              <div className="space-y-1.5">
                <span className="text-text-dim block text-xs font-medium">
                  학생 이름 <span className="text-danger">*</span>
                  {studentIds.length > 0 ? (
                    <span className="text-primary ml-1 font-bold">· {studentIds.length}명</span>
                  ) : null}
                </span>
                {/* 여러 명 추가 가능 — 같은 교재를 선택한 학생 전원에게 요청서 1장씩 발행 */}
                <SearchableSelect
                  value=""
                  onValueChange={(id) =>
                    setStudentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
                  }
                  options={availableOptions}
                  placeholder={lockedHint ?? "학생을 검색해 추가 (여러 명 가능)"}
                  searchPlaceholder="학생 이름 검색..."
                  ariaLabel="교재 요청 학생 추가"
                  disabled={!canWrite}
                />
                {selectedStudents.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {selectedStudents.map((s) => (
                      <span
                        key={s.id}
                        className="border-line bg-bg-soft text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                      >
                        {s.name}
                        <button
                          type="button"
                          onClick={() => setStudentIds((prev) => prev.filter((x) => x !== s.id))}
                          aria-label={`${s.name} 제거`}
                          className="text-text-faint hover:text-danger"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                {/* FormData.getAll("studentId") 로 서버 액션이 복수 학생 수신 */}
                {studentIds.map((id) => (
                  <input key={id} type="hidden" name="studentId" value={id} />
                ))}
                {prefillDropped && studentIds.length === 0 ? (
                  <span className="text-gold block text-xs break-keep">
                    링크로 넘어온 학생을 담당 목록에서 찾지 못해 선택하지 못했습니다 — 직접 검색해 추가해
                    주세요.
                  </span>
                ) : null}
                {state?.fieldErrors?.studentId ? (
                  <span className="text-danger text-xs">{state.fieldErrors.studentId}</span>
                ) : null}
              </div>
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">담임 선생님</span>
                <Input
                  name="teacherName"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder={lockedHint ?? "선생님 성함"}
                  disabled={!canWrite}
                />
                {/* 🔴 이 칸이 곧 **소유자**다(ownsTextbookRequest) — 다른 이름으로 저장하면 수정·삭제·발송을
                    그 선생님만 할 수 있다. 안 알리면 '기록했습니다, 발송창에서 보낼 수 있어요' 토스트 직후
                    발송이 거절되는 거짓 약속이 된다(2026-07-29 적대검증). 강사 화면에서만 안내. */}
                {isTeacher && teacherName.trim() && teacherName.trim() !== requesterName ? (
                  <span className="text-gold block text-xs break-keep">
                    다른 선생님 이름으로 저장하면 이 요청의 수정·삭제·학부모 발송은{" "}
                    <strong>{teacherName.trim()}</strong> 선생님만 할 수 있습니다.
                  </span>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">요청 일자</span>
                <Input
                  name="requestDate"
                  type="date"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                  disabled={!canWrite}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="border-line flex items-center justify-between border-b pb-1.5">
                <span className="text-foreground flex items-center gap-1.5 text-xs font-bold">
                  <BookOpen className="size-3.5" />
                  교재 내용
                </span>
                {/* ijw '교재 검색' 버튼 자리 — aywa는 인라인 검색 셀렉트가 그 역할 */}
              </div>
              {catalogOptions.length > 0 ? (
                <label className="block space-y-1">
                  <span className="text-text-dim text-xs font-medium">교재 검색 (단가표에서 불러오기)</span>
                  {/* value=""(controlled) — 선택 후 placeholder로 복귀하는 '불러오기' 동작(아래 교재명을 손으로 고쳐도 표시 불일치 없음) */}
                  <SearchableSelect
                    value=""
                    options={catalogOptions}
                    placeholder={lockedHint ?? "교재명을 입력해 검색..."}
                    searchPlaceholder="교재명 검색..."
                    ariaLabel="교재 단가표 검색"
                    onValueChange={pickCatalog}
                    disabled={!canWrite}
                  />
                  <span className="text-text-faint text-xs">
                    선택하면 교재명·상세·금액이 자동으로 채워집니다 (직접 수정 가능)
                  </span>
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">
                  교재명 (과목/난이도) <span className="text-danger">*</span>
                </span>
                <Input
                  name="bookName"
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  placeholder={lockedHint ?? "교재명을 입력하세요"}
                  disabled={!canWrite}
                />
                {state?.fieldErrors?.bookName ? (
                  <span className="text-danger text-xs">{state.fieldErrors.bookName}</span>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">상세 내용 (단원)</span>
                <Input
                  name="bookDetail"
                  value={bookDetail}
                  onChange={(e) => setBookDetail(e.target.value)}
                  placeholder={lockedHint ?? "상세 내용을 입력하세요 (선택)"}
                  disabled={!canWrite}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">금액 (원)</span>
                <Input
                  name="price"
                  type="number"
                  min={0}
                  step={500}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={lockedHint ?? "교재 검색 시 자동 입력"}
                  disabled={!canWrite}
                  className="num text-right"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-xs font-medium">메모 (사무실 전달, 선택)</span>
                {/* 손잡이로 잡아끄는 대신 작성량에 따라 자동 확장(rows=기본 줄 수 겸 미지원 브라우저 폴백). */}
                <textarea
                  name="notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={lockedHint ?? "예: 급해요 — 이번 주 수업에 필요"}
                  disabled={!canWrite}
                  className={`border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-[68px] w-full rounded-lg border bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60 ${TEXTAREA_AUTOSIZE}`}
                />
              </label>
              {/* 메모 바로 아래 = 학부모에게 실제로 나가는 문구(발송 시 그대로 쓰인다). */}
              {classnoteOn ? <TextbookMentField value={ment} onChange={editMent} disabled={!canWrite} /> : null}
            </div>

            {/* 읽기 권한이면 '작성 지우기'·'클래스노트 발송'·'이미지 저장 및 기록'을 그리지 않는다(write-lock.ts 규칙 1). */}
            {canWrite ? (
              <TextbookFormFooter
                result={showMsg ? state : undefined}
                notice={notice}
                canSubmit={canSubmit}
                pending={pending}
                sending={sending}
                onReset={reset}
                onSaveAndSend={classnoteOn ? saveAndSend : undefined}
                onSendCreated={classnoteOn ? setSendIds : undefined}
              />
            ) : null}
          </section>

          {/* 우: 실시간 미리보기 (ijw 우측 패널 — 타이핑 즉시 종이 서식에 반영) */}
          <section className="space-y-2">
            <h2 className="text-text-dim flex items-center gap-1.5 text-xs font-bold">
              <Eye className="size-3.5" />
              미리보기
            </h2>
            {studentIds.length > 1 ? (
              <p className="text-primary text-xs font-medium">
                같은 교재를 {studentIds.length}명에게 발행합니다 — 미리보기는 {firstStudentName} 기준(요청서는 학생별 1장씩 저장)
              </p>
            ) : null}
            <div className="bg-bg-soft/60 border-line overflow-x-auto rounded-2xl border p-3 sm:p-6">
              <TextbookRequestCardBody
                data={{
                  studentName: firstStudentName || null,
                  teacherName: teacherName || null,
                  // 빈 날짜는 저장 시 오늘로 폴백(서버 규칙)이라 미리보기도 동일하게 — WYSIWYG 일치.
                  requestDate: requestDate || kstToday(),
                  bookName,
                  bookDetail: bookDetail || null,
                  price: Math.max(0, Number(price) || 0),
                }}
                academyName={academyName}
                logoUrl={logoUrl}
                account={account}
              />
            </div>
            {canWrite ? (
              <p className="text-text-faint text-xs">
                * 입력한 내용은 자동으로 미리보기에 반영됩니다. &lsquo;이미지 저장 및 기록&rsquo;을 누르면 이 요청서가
                PNG로 저장되고 아래 내역에 기록됩니다.
              </p>
            ) : null}
          </section>
        </form>
      )}

      {/* 요청 내역 — 미완료/완료 탭 + 검색 + 페이지네이션 (ijw history 구조).
          사무실 rows는 최근 100건 절단이라 카운트가 전체 통계로 읽히지 않게 명시(강사=담당 전건이라 정확). */}
      <RequestHistory
        rows={rows}
        onDownload={download}
        canWrite={canWrite}
        onSend={classnoteOn && canWrite ? (r) => setSendIds([r.id]) : undefined}
        capNote={isTeacher ? undefined : "최근 100건 기준 — 전체는 수납관리 › 교재"}
        // 강사일 때만 소유 판정 — 사무실(master/accountant)은 서버에서도 이 게이트를 안 탄다.
        ownerName={isTeacher ? requesterName : undefined}
        viewerUserId={viewerUserId}
      />

      {/* 학부모 발송 — 다이얼로그가 요청서 카드를 숨김 렌더해 PNG로 캡처하므로 카드 렌더 재료(학원명·로고·계좌)를 넘긴다. */}
      {classnoteOn && sendIds ? (
        <TextbookSendDialog
          orderIds={sendIds}
          onClose={() => setSendIds(null)}
          academyName={academyName}
          logoUrl={logoUrl}
          account={account}
          initialMent={ment}
        />
      ) : null}

      {/* 바로 다운로드용 숨김 카드 — 큐의 head를 렌더(다운로드 후 다음으로). 여러 명 일괄 발행 시 순차 렌더. */}
      {dlHead ? (
        <div aria-hidden style={{ position: "fixed", left: -99999, top: 0, width: 720, pointerEvents: "none" }}>
          <TextbookRequestCardBody
            key={dlHead.k}
            cardRef={hiddenRef}
            data={dlHead.data}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </div>
      ) : null}
    </div>
  );
}
