"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, Eye, Loader2, Save, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createTextbookOrder,
  updateTextbookOrder,
  type TextbookState,
} from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";
import { TextbookRequestCardBody } from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

// 요청서 카드는 720px 고정 인쇄 서식이라 좁은 칸에선 잘린다 → 칸 폭에 맞춰 전체를 비례 축소(잘림 없이 온전히 표시).
// 카드를 720px로 렌더 후 transform:scale로 줄이고, 축소된 만큼 래퍼 높이를 맞춘다(빈 공간 방지).
const PREVIEW_BASE_W = 720;
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const box = boxRef.current;
    const card = cardRef.current;
    if (!box || !card) return;
    // ResizeObserver 콜백은 렌더 밖(비동기)이라 setState 안전(#25 무관). 칸 폭·카드 높이 변화(타이핑 등)에 반응.
    const ro = new ResizeObserver(() => {
      const s = Math.min(1, box.clientWidth / PREVIEW_BASE_W);
      setScale(s);
      setHeight(card.offsetHeight * s);
    });
    ro.observe(box);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="overflow-hidden" style={{ height }}>
      <div ref={cardRef} style={{ width: PREVIEW_BASE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

// 교재신청 등록/수정 — 강사뷰(/textbook-requests)와 동일한 좌 폼 + 우 실시간 요청서 미리보기.
// 관리자 전용(강사 자유입력·전체 학생·기존 행 수정)은 유지. 미리보기 카드 = TextbookRequestCardBody 재사용.
export function TextbookDialog({
  order,
  students,
  catalog,
  academyName,
  logoUrl,
  account,
  onClose,
}: {
  order: TextbookOrderRow | null;
  students: StudentOption[];
  catalog: CatalogOption[];
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  onClose: (saved: boolean) => void;
}) {
  const editing = !!order;
  const [state, formAction] = useActionState<TextbookState, FormData>(
    editing ? updateTextbookOrder : createTextbookOrder,
    undefined,
  );
  // 전 필드 controlled — 우측 실시간 미리보기 데이터 소스이자 '교재 검색'(단가표) 자동입력 대상.
  const [studentId, setStudentId] = useState(order?.studentId ?? "");
  const [teacherName, setTeacherName] = useState(order?.teacherName ?? "");
  const [requestDate, setRequestDate] = useState(order?.requestDate ?? kstToday());
  const [bookName, setBookName] = useState(order?.bookName ?? "");
  const [bookDetail, setBookDetail] = useState(order?.bookDetail ?? "");
  const [price, setPrice] = useState<number | string>(order?.price ?? 0);
  const [notes, setNotes] = useState(order?.notes ?? "");

  // 성공 시 부모가 닫고 목록 갱신. 조건부 마운트(부모 {dialog ? …})라 언마운트 시 useActionState 리셋 = #67 안전.
  if (state?.ok) {
    queueMicrotask(() => onClose(true));
  }

  // 학생명 = 선택 학생(전체 학생 목록) → 미리보기 카드. 수정 시 목록에 없어도 저장된 이름 폴백.
  const studentName = students.find((s) => s.id === studentId)?.name ?? order?.studentName ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">{editing ? "교재신청 수정" : "교재신청 등록"}</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">
              {editing ? order.bookName : "새 교재신청"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-text-dim hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          {/* 좌: 작성 폼 */}
          <form action={formAction} className="space-y-4">
            {editing ? <input type="hidden" name="id" value={order.id} /> : null}

            {catalog.length > 0 ? (
              <Field label="교재 검색 (단가표에서 불러오기)">
                {/* value=""(controlled) — 선택 후 placeholder로 복귀하는 '불러오기' 버튼 동작(강사뷰와 동일). */}
                <SearchableSelect
                  value=""
                  options={catalog.map((c) => ({
                    value: c.id,
                    label: c.title,
                    hint: `${c.price.toLocaleString()}원${c.bookDetail ? ` · ${c.bookDetail}` : ""}`,
                  }))}
                  placeholder="단가표에서 선택..."
                  searchPlaceholder="교재명 검색..."
                  onValueChange={(id) => {
                    const c = catalog.find((x) => x.id === id);
                    if (c) {
                      setBookName(c.title);
                      setBookDetail(c.bookDetail ?? "");
                      setPrice(c.price);
                    }
                  }}
                />
              </Field>
            ) : null}

            <Field label="교재명" error={state?.fieldErrors?.bookName}>
              <input
                name="bookName"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                className={inputCls}
                placeholder="예: 가우스 중2-1 1권"
              />
            </Field>
            <Field label="상세 (단원 등)">
              <input
                name="bookDetail"
                value={bookDetail}
                onChange={(e) => setBookDetail(e.target.value)}
                className={inputCls}
                placeholder="선택"
              />
            </Field>

            <Field label="학생" error={state?.fieldErrors?.studentId}>
              <SearchableSelect
                name="studentId"
                value={studentId}
                onValueChange={setStudentId}
                options={students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }))}
                placeholder="학생 선택..."
                searchPlaceholder="학생 이름 검색..."
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="강사">
                <input
                  name="teacherName"
                  value={teacherName}
                  onChange={(e) => setTeacherName(e.target.value)}
                  className={inputCls}
                  placeholder="선택"
                />
              </Field>
              <Field label="신청일">
                <input
                  name="requestDate"
                  type="date"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>

            <Field label="금액">
              <input
                name="price"
                type="number"
                min="0"
                step="500"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`${inputCls} num text-right`}
              />
            </Field>

            <Field label="메모">
              <textarea
                name="notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputCls} resize-y`}
                placeholder="선택"
              />
            </Field>

            {state?.error ? (
              <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
                <AlertCircle className="size-4" />
                {state.error}
              </p>
            ) : null}

            <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onClose(false)}>
                취소
              </Button>
              <SubmitBtn />
            </div>
          </form>

          {/* 우: 실시간 미리보기 (강사뷰 우측 패널과 동일 — 타이핑 즉시 종이 서식에 반영) */}
          <section className="space-y-2">
            <h3 className="text-text-dim flex items-center gap-1.5 text-[12px] font-bold">
              <Eye className="size-3.5" />
              미리보기
            </h3>
            <div className="bg-bg-soft/60 border-line rounded-md border p-3 sm:p-4">
              <ScaledPreview>
                <TextbookRequestCardBody
                  data={{
                    studentName: studentName || null,
                    teacherName: teacherName || null,
                    // 빈 날짜는 저장 시 오늘로 폴백(서버 규칙)이라 미리보기도 동일 — WYSIWYG 일치.
                    requestDate: requestDate || kstToday(),
                    bookName,
                    bookDetail: bookDetail || null,
                    price: Math.max(0, Number(price) || 0),
                  }}
                  academyName={academyName}
                  logoUrl={logoUrl}
                  account={account}
                />
              </ScaledPreview>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">{label}</span>
      {children}
      {error ? <p className="text-danger text-xs">{error}</p> : null}
    </div>
  );
}
