"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BookMarked, BookOpen, Eraser, Eye, Save, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { kstToday } from "@/lib/date-kst";
import type { AccountSetting } from "@/features/owner/settings-types";
import { requestTextbook, type TextbookState } from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import {
  TextbookRequestCardBody,
  type TextbookCardData,
} from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import { downloadCardPng } from "@/app/(print)/textbook/[id]/print/download-card";
import { RequestHistory } from "./request-history";

// 교재 요청 — ijw TextbookRequestView 구조 그대로 이식(선생님들이 익숙한 화면):
// 좌측 폼(기본 정보 → 교재 내용) + 우측 실시간 종이 서식 미리보기 + '이미지 저장 및 기록' 단일 버튼
// (PNG 자동 다운로드 + DB 기록) + 아래 요청 내역(미완료/완료 탭·검색·페이지네이션 — request-history.tsx).
// eywa 유지분: 학생=FK 선택(강사 스코프)·계좌=학원설정 자동(카드에 표시) — 데이터 모델은 불변.

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-line text-foreground flex items-center gap-1.5 border-b pb-1.5 text-[12px] font-bold">
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
}: {
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  isTeacher: boolean;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  requesterName: string;
}) {
  // 성공 시 목록은 서버 액션 revalidatePath로 자동 갱신. 폼 값은 유지(같은 학생 다른 교재 연속 요청에 편함).
  const [state, formAction, pending] = useActionState(requestTextbook, undefined);

  // 전 필드 controlled — 우측 실시간 미리보기의 데이터 소스이자, '교재 검색'(단가표) 자동입력 대상.
  const [studentId, setStudentId] = useState("");
  const [teacherName, setTeacherName] = useState(requesterName);
  const [requestDate, setRequestDate] = useState(kstToday());
  const [bookName, setBookName] = useState("");
  const [bookDetail, setBookDetail] = useState("");
  const [price, setPrice] = useState<number | string>("");
  const [notes, setNotes] = useState("");
  const [handledId, setHandledId] = useState<string | null>(null); // 자동 다운로드 1회 가드(#67)
  // '초기화'는 폼만 비우고 useActionState 결과는 못 지우므로, 직전 결과 메시지를 함께 숨긴다(잔존 방지).
  const [msgHiddenFor, setMsgHiddenFor] = useState<TextbookState>(undefined);

  // 바로 다운로드 — 카드 데이터를 화면 밖에 렌더 → html2canvas → PNG 저장(새 탭·창 없음).
  // k는 dl 상태에서만 파생(updater) — remount 키 충돌 없이 단조 증가.
  const [dl, setDl] = useState<{ data: TextbookCardData; k: number } | null>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dl) return;
    let cancelled = false;
    // 로고 이미지 로드 후 canvas가 정확하도록 짧게 지연. setState 없음(다운로드만) → effect 규칙 안전.
    const t = setTimeout(() => {
      if (cancelled || !hiddenRef.current) return;
      void downloadCardPng(hiddenRef.current, dl.data.requestDate, dl.data.studentName, dl.data.bookName);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dl]);
  const download = (row: TextbookOrderRow) =>
    setDl((prev) => ({
      data: {
        studentName: row.studentName,
        teacherName: row.teacherName,
        requestDate: row.requestDate,
        bookName: row.bookName,
        bookDetail: row.bookDetail,
        price: row.price,
      },
      k: (prev?.k ?? 0) + 1,
    }));

  const options = students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }));
  // 교재 검색 옵션 — 타이핑하면 SearchableSelect가 즉시 필터. hint에 가격(+상세)을 보여 고르기 쉽게.
  const catalogOptions = catalog.map((c) => ({
    value: c.id,
    label: c.title,
    hint: `${c.price.toLocaleString()}원${c.bookDetail ? ` · ${c.bookDetail}` : ""}`,
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
    setStudentId("");
    setTeacherName(requesterName);
    setRequestDate(kstToday());
    setBookName("");
    setBookDetail("");
    setPrice("");
    setNotes("");
    setMsgHiddenFor(state); // 직전 성공/에러 문구도 함께 치움
  };

  const studentName = options.find((o) => o.value === studentId)?.label ?? "";

  // 저장 성공 → 요청서 PNG 자동 다운로드(ijw '이미지 저장 및 기록' 패리티). rows(사무실은 최근 100건
  // 절단)에 의존하지 않고 **제출한 폼 스냅샷**으로 즉시 발화 — 백데이트·절단과 무관하게 항상 다운로드.
  // 렌더 중 상태조정(#25 회피) + createdId 키 가드(#67). 서버 저장값과 동일 규칙(빈 날짜=오늘).
  const createdId = state?.ok ? state.createdId : undefined;
  if (createdId && createdId !== handledId) {
    setHandledId(createdId);
    setDl((prev) => ({
      data: {
        studentName: studentName || null,
        teacherName: teacherName.trim() || requesterName,
        requestDate: requestDate || kstToday(),
        bookName,
        bookDetail: bookDetail.trim() || null,
        price: Math.max(0, Number(price) || 0),
      },
      k: (prev?.k ?? 0) + 1,
    }));
  }

  const showMsg = state !== undefined && state !== msgHiddenFor;
  // 필수(학생·교재명)가 다 채워져야 저장 가능 — 서버 검증(fieldErrors)과 이중, 미충족이면 버튼 비활성화.
  const canSubmit = studentId !== "" && bookName.trim() !== "";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-2">
        <BookMarked className="text-primary size-5" />
        <div>
          <h1 className="text-foreground text-[19px] font-bold">교재 요청</h1>
          <p className="text-text-dim text-[13px]">
            {isTeacher
              ? "담당 학생의 교재를 요청하면 사무실에서 등록·납부·주문을 처리합니다."
              : "교재 요청 목록 — 사무실은 수납관리 › 교재에서 등록·납부·주문을 처리합니다."}
          </p>
        </div>
      </header>

      {students.length === 0 ? (
        <p className="text-text-dim border-line rounded-md border p-4 text-[13px]">
          담당 학생이 없어 교재를 요청할 수 없습니다.
        </p>
      ) : (
        <form action={formAction} className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_minmax(0,3fr)] lg:items-start">
          {/* 좌: 작성 폼 (ijw 기본 정보 → 교재 내용 섹션 구조) */}
          <section className="border-line bg-card space-y-5 rounded-md border p-4">
            <div className="space-y-3">
              <SectionLabel icon={<User className="size-3.5" />}>기본 정보</SectionLabel>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">
                  학생 이름 <span className="text-danger">*</span>
                </span>
                <SearchableSelect
                  name="studentId"
                  value={studentId}
                  onValueChange={setStudentId}
                  options={options}
                  placeholder="학생 이름을 입력하세요"
                  searchPlaceholder="학생 이름 검색..."
                  ariaLabel="교재 요청 학생 선택"
                />
                {state?.fieldErrors?.studentId ? (
                  <span className="text-danger text-[11px]">{state.fieldErrors.studentId}</span>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">담임 선생님</span>
                <Input
                  name="teacherName"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  placeholder="선생님 성함"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">요청 일자</span>
                <Input
                  name="requestDate"
                  type="date"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                />
              </label>
            </div>

            <div className="space-y-3">
              <div className="border-line flex items-center justify-between border-b pb-1.5">
                <span className="text-foreground flex items-center gap-1.5 text-[12px] font-bold">
                  <BookOpen className="size-3.5" />
                  교재 내용
                </span>
                {/* ijw '교재 검색' 버튼 자리 — eywa는 인라인 검색 셀렉트가 그 역할 */}
              </div>
              {catalogOptions.length > 0 ? (
                <label className="block space-y-1">
                  <span className="text-text-dim text-[12px] font-medium">교재 검색 (단가표에서 불러오기)</span>
                  {/* value=""(controlled) — 선택 후 placeholder로 복귀하는 '불러오기' 동작(아래 교재명을 손으로 고쳐도 표시 불일치 없음) */}
                  <SearchableSelect
                    value=""
                    options={catalogOptions}
                    placeholder="교재명을 입력해 검색..."
                    searchPlaceholder="교재명 검색..."
                    ariaLabel="교재 단가표 검색"
                    onValueChange={pickCatalog}
                  />
                  <span className="text-text-faint text-[11px]">
                    선택하면 교재명·상세·금액이 자동으로 채워집니다 (직접 수정 가능)
                  </span>
                </label>
              ) : null}
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">
                  교재명 (과목/난이도) <span className="text-danger">*</span>
                </span>
                <Input
                  name="bookName"
                  value={bookName}
                  onChange={(e) => setBookName(e.target.value)}
                  placeholder="교재명을 입력하세요"
                />
                {state?.fieldErrors?.bookName ? (
                  <span className="text-danger text-[11px]">{state.fieldErrors.bookName}</span>
                ) : null}
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">상세 내용 (단원)</span>
                <Input
                  name="bookDetail"
                  value={bookDetail}
                  onChange={(e) => setBookDetail(e.target.value)}
                  placeholder="상세 내용을 입력하세요 (선택)"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">금액 (원)</span>
                <Input
                  name="price"
                  type="number"
                  min={0}
                  step={500}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="교재 검색 시 자동 입력"
                  className="num text-right"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-text-dim text-[12px] font-medium">메모 (사무실 전달, 선택)</span>
                <Input name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="예: 급해요 — 이번 주 수업에 필요" />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={reset}>
                <Eraser className="size-4" />
                초기화
              </Button>
              <Button type="submit" disabled={pending || !canSubmit}>
                <Save className="size-4" />
                {pending ? "저장 중…" : "이미지 저장 및 기록"}
              </Button>
              {!canSubmit ? (
                <span className="text-text-faint text-[11px]">학생과 교재명을 입력하면 저장할 수 있어요</span>
              ) : null}
            </div>
            {showMsg && state?.error ? <p className="text-danger text-[12px]">{state.error}</p> : null}
            {showMsg && state?.ok ? (
              <p className="text-primary text-[12px]">
                기록되었습니다 — 요청서 이미지가 자동 저장됩니다. (아래 내역의 &lsquo;요청서&rsquo;로 다시 받을 수 있어요)
              </p>
            ) : null}
          </section>

          {/* 우: 실시간 미리보기 (ijw 우측 패널 — 타이핑 즉시 종이 서식에 반영) */}
          <section className="space-y-2">
            <h2 className="text-text-dim flex items-center gap-1.5 text-[12px] font-bold">
              <Eye className="size-3.5" />
              미리보기
            </h2>
            <div className="bg-bg-soft/60 border-line overflow-x-auto rounded-md border p-3 sm:p-6">
              <TextbookRequestCardBody
                data={{
                  studentName: studentName || null,
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
            <p className="text-text-faint text-[11px]">
              * 입력한 내용은 자동으로 미리보기에 반영됩니다. &lsquo;이미지 저장 및 기록&rsquo;을 누르면 이 요청서가
              PNG로 저장되고 아래 내역에 기록됩니다.
            </p>
          </section>
        </form>
      )}

      {/* 요청 내역 — 미완료/완료 탭 + 검색 + 페이지네이션 (ijw history 구조).
          사무실 rows는 최근 100건 절단이라 카운트가 전체 통계로 읽히지 않게 명시(강사=담당 전건이라 정확). */}
      <RequestHistory rows={rows} onDownload={download} capNote={isTeacher ? undefined : "최근 100건 기준 — 전체는 수납관리 › 교재"} />

      {/* 바로 다운로드용 숨김 카드 — 화면 밖에서 html2canvas 대상. 클릭 시에만 렌더(key로 remount). */}
      {dl ? (
        <div aria-hidden style={{ position: "fixed", left: -99999, top: 0, width: 720, pointerEvents: "none" }}>
          <TextbookRequestCardBody
            key={dl.k}
            cardRef={hiddenRef}
            data={dl.data}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </div>
      ) : null}
    </div>
  );
}
