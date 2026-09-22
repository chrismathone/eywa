"use client";

// 교재신청 등록/수정 — 강사뷰(/textbook-requests)와 동일한 좌 폼 + 우 실시간 요청서 미리보기.
// 관리자 전용(강사 자유입력·전체 학생·기존 행 수정)은 유지. 입력칸=textbook-dialog-fields, 미리보기=textbook-dialog-preview.
//
// 하단 버튼 3개(원장 요청): 취소 / 클래스노트 발송 / 저장.
// **발송을 저장에 묶지 않는다** — 이미지·기록만 남기고 싶은 경우가 있어서 '저장'은 그대로 두고,
// '클래스노트 발송'은 저장까지 끝낸 뒤 발송창을 연다(기록 없이 글만 나가는 일 없음).

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { kstToday } from "@/lib/date-kst";
import { AlertCircle, Loader2, Save, X } from "@/components/icons/aywa-icon-compat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import {
  createTextbookOrder,
  updateTextbookOrder,
  type TextbookState,
} from "@/features/billing/server/textbook-actions";
import { useMentDraft } from "@/features/billing/textbook-ment";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";
import { TextbookSendDialog } from "@/app/(shell)/textbook-requests/_send-dialog";
import { TextbookFields, type TextbookDraft } from "./textbook-dialog-fields";
import { TextbookPreview } from "./textbook-dialog-preview";

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

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
  const [draft, setDraft] = useState<TextbookDraft>({
    studentId: order?.studentId ?? "",
    teacherName: order?.teacherName ?? "",
    requestDate: order?.requestDate ?? kstToday(),
    bookName: order?.bookName ?? "",
    bookDetail: order?.bookDetail ?? "",
    price: order?.price ?? 0,
    notes: order?.notes ?? "",
  });
  const patch = (p: Partial<TextbookDraft>) => setDraft((d) => ({ ...d, ...p }));
  // 학부모용 문구 — 저장된 내 멘트를 불러오고(autoLoad), 입력이 멈추면 자동 저장.
  const { ment, edit: editMent } = useMentDraft({ autoLoad: true });

  const formRef = useRef<HTMLFormElement>(null);
  const [sendIds, setSendIds] = useState<string[] | null>(null); // 발송창 대상(null=미마운트, #67 회피)
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // 성공 시 부모가 닫고 목록 갱신. 조건부 마운트(부모 {dialog ? …})라 언마운트 시 useActionState 리셋 = #67 안전.
  // ⚠️ 발송창이 열려 있는 동안엔 닫지 않는다(발송 경로는 아래 saveThenSend가 별도로 저장한다).
  if (state?.ok && !sendIds) {
    queueMicrotask(() => onClose(true));
  }

  /**
   * '클래스노트 발송' — 저장(신규=생성, 수정=갱신)이 **성공했을 때만** 발송창을 연다.
   * ⚠️ form submit을 가로채지 않는다(type="button" + 액션 직접 호출) — 기존 '저장'(useActionState) 경로는 그대로.
   */
  async function saveThenSend() {
    const form = formRef.current;
    if (!form || sending) return;
    setSending(true);
    setSendError(null);
    const fd = new FormData(form);
    const res = order
      ? await updateTextbookOrder(undefined, fd)
      : await createTextbookOrder(undefined, fd);
    setSending(false);
    if (!res?.ok) {
      setSendError(
        res?.error ?? Object.values(res?.fieldErrors ?? {})[0] ?? "저장하지 못해 발송을 시작할 수 없습니다",
      );
      return;
    }
    const id = order ? order.id : res.createdId;
    if (!id) {
      setSendError("저장은 됐지만 발송 대상을 찾지 못했습니다 — 목록에서 다시 시도해주세요");
      return;
    }
    setSendIds([id]);
  }

  // 학생명 = 선택 학생(전체 학생 목록) → 미리보기 카드. 수정 시 목록에 없어도 저장된 이름 폴백.
  const studentName = students.find((s) => s.id === draft.studentId)?.name ?? order?.studentName ?? "";
  const errorMsg = sendError ?? state?.error;

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
          <form ref={formRef} action={formAction} className="space-y-4">
            {editing ? <input type="hidden" name="id" value={order.id} /> : null}

            <TextbookFields
              draft={draft}
              onChange={patch}
              students={students}
              catalog={catalog}
              fieldErrors={state?.fieldErrors}
              ment={ment}
              onMentChange={editMent}
            />

            {errorMsg ? (
              <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
                <AlertCircle className="size-4" />
                {errorMsg}
              </p>
            ) : null}

            <div className="border-line flex flex-wrap items-center justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onClose(false)} disabled={sending}>
                취소
              </Button>
              <Button type="button" variant="outline" onClick={saveThenSend} disabled={sending}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <EyIcon name="send" size={16} />}
                클래스노트 발송
              </Button>
              <SubmitBtn disabled={sending} />
            </div>
          </form>

          {/* 우: 실시간 미리보기 (강사뷰 우측 패널과 동일 — 타이핑 즉시 종이 서식에 반영) */}
          <TextbookPreview
            draft={draft}
            studentName={studentName}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </div>
      </div>

      {/* 발송창 — 이 시점엔 이미 저장이 끝났다. 닫으면 다이얼로그도 함께 닫아 같은 내용이 두 번 저장되는 걸 막는다. */}
      {sendIds ? (
        <TextbookSendDialog
          orderIds={sendIds}
          onClose={() => {
            setSendIds(null);
            onClose(true);
          }}
          academyName={academyName}
          logoUrl={logoUrl}
          account={account}
          initialMent={ment}
        />
      ) : null}
    </div>
  );
}
