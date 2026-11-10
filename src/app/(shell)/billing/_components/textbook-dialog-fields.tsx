"use client";

// 교재신청 등록/수정 다이얼로그의 **입력 칸들** — 다이얼로그 본체(상태·저장·발송)에서 분리.
// 값은 draft 한 덩이로 주고받는다(칸마다 setter를 넘기면 props가 10개를 넘는다).

import { SearchableSelect } from "@/components/ui/searchable-select";
import { TEXTAREA_AUTOSIZE } from "@/lib/ui/textarea";
import { TextbookMentField } from "@/features/billing/textbook-ment";
import type { StudentOption } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import { Field } from "@/components/form-field";

export type TextbookDraft = {
  studentId: string;
  teacherName: string;
  requestDate: string;
  bookName: string;
  bookDetail: string;
  price: number | string;
  notes: string;
};

export const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function TextbookFields({
  draft,
  onChange,
  students,
  catalog,
  fieldErrors,
  ment,
  onMentChange,
}: {
  draft: TextbookDraft;
  onChange: (patch: Partial<TextbookDraft>) => void;
  students: StudentOption[];
  catalog: CatalogOption[];
  fieldErrors?: Record<string, string>;
  ment: string;
  onMentChange: (v: string) => void;
}) {
  return (
    <>
      {catalog.length > 0 ? (
        <Field label="교재 검색 (단가표에서 불러오기)">
          {/* value=""(controlled) — 선택 후 placeholder로 복귀하는 '불러오기' 버튼 동작(강사뷰와 동일). */}
          <SearchableSelect
            value=""
            options={catalog.map((c) => ({
              value: c.id,
              label: c.title,
              // 금액·상세는 열로(신청 화면과 같은 규약 — searchable-select `meta`).
              hint: `${c.price.toLocaleString()}원`,
              meta: c.bookDetail ?? "",
            }))}
            placeholder="단가표에서 선택..."
            searchPlaceholder="교재명 검색..."
            onValueChange={(id) => {
              const c = catalog.find((x) => x.id === id);
              if (c) onChange({ bookName: c.title, bookDetail: c.bookDetail ?? "", price: c.price });
            }}
          />
        </Field>
      ) : null}

      <Field label="교재명" error={fieldErrors?.bookName}>
        <input
          name="bookName"
          value={draft.bookName}
          onChange={(e) => onChange({ bookName: e.target.value })}
          className={inputCls}
          placeholder="예: 가우스 중2-1 1권"
        />
      </Field>
      <Field label="상세 (단원 등)">
        <input
          name="bookDetail"
          value={draft.bookDetail}
          onChange={(e) => onChange({ bookDetail: e.target.value })}
          className={inputCls}
          placeholder="선택"
        />
      </Field>

      <Field label="학생" error={fieldErrors?.studentId}>
        <SearchableSelect
          name="studentId"
          value={draft.studentId}
          onValueChange={(v) => onChange({ studentId: v })}
          options={students.map((s) => ({ value: s.id, label: s.name, hint: s.grade ?? undefined }))}
          placeholder="학생 선택..."
          searchPlaceholder="학생 이름 검색..."
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="강사">
          <input
            name="teacherName"
            value={draft.teacherName}
            onChange={(e) => onChange({ teacherName: e.target.value })}
            className={inputCls}
            placeholder="선택"
          />
        </Field>
        <Field label="신청일">
          <input
            name="requestDate"
            type="date"
            value={draft.requestDate}
            onChange={(e) => onChange({ requestDate: e.target.value })}
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
          value={draft.price}
          onChange={(e) => onChange({ price: e.target.value })}
          className={`${inputCls} num text-right`}
        />
      </Field>

      <Field label="메모 (사무실 내부용)">
        {/* 손잡이로 잡아끄는 대신 작성량에 따라 자동 확장(rows=기본 줄 수 겸 미지원 브라우저 폴백). */}
        <textarea
          name="notes"
          rows={3}
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          className={`${inputCls} min-h-[76px] ${TEXTAREA_AUTOSIZE}`}
          placeholder="선택 — 학부모에게 나가지 않습니다"
        />
      </Field>

      {/* 메모 바로 아래 = 학부모에게 실제로 나가는 문구(발송 시 그대로 쓰인다). */}
      <TextbookMentField value={ment} onChange={onMentChange} />
    </>
  );
}

