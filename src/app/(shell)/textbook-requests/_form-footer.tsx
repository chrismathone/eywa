"use client";

// 강사 교재요청 폼 하단 — 버튼 3개(초기화 / 클래스노트 발송 / 이미지 저장 및 기록) + 저장 결과 안내.
// ⚠️ '이미지 저장 및 기록'(submit)만 요청서 PNG를 자동 저장한다. '클래스노트 발송'은 기록만 하고
//    발송창을 여는 별도 경로 — 원장 요청("발송을 저장에 묶지 말 것")대로 두 동작을 분리해 둔 것.

import { Eraser, Save } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import type { TextbookState } from "@/features/billing/server/textbook-actions";

export function TextbookFormFooter({
  result,
  notice,
  canSubmit,
  pending,
  sending,
  onReset,
  onSaveAndSend,
  onSendCreated,
}: {
  /** 표시할 저장 결과(숨김 처리된 직전 결과는 상위에서 걸러 undefined로 준다). */
  result: TextbookState;
  /** '클래스노트 발송' 경로의 자체 안내(저장 실패 사유 등). */
  notice: { kind: "ok" | "error"; text: string } | null;
  canSubmit: boolean;
  pending: boolean;
  sending: boolean;
  onReset: () => void;
  onSaveAndSend: () => void;
  onSendCreated: (ids: string[]) => void;
}) {
  const created = result?.ok ? result.created : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={onReset} disabled={sending}>
          <Eraser className="size-4" />
          초기화
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onSaveAndSend}
          disabled={pending || sending || !canSubmit}
        >
          <EyIcon name="send" size={16} />
          {sending ? "기록하는 중…" : "클래스노트 발송"}
        </Button>
        <Button type="submit" disabled={pending || sending || !canSubmit}>
          <Save className="size-4" />
          {pending ? "저장 중…" : "이미지 저장 및 기록"}
        </Button>
        {!canSubmit ? (
          <span className="text-text-faint text-[11px]">학생과 교재명을 입력하면 저장할 수 있어요</span>
        ) : null}
      </div>

      {notice ? (
        <p className={`${notice.kind === "error" ? "text-danger" : "text-primary"} text-[12px]`}>{notice.text}</p>
      ) : null}
      {result?.error ? <p className="text-danger text-[12px]">{result.error}</p> : null}
      {result?.ok ? (
        <div className="space-y-2">
          <p className="text-primary text-[12px]">
            {(created?.length ?? 0) > 1
              ? `${created!.length}명에게 교재 요청이 기록되었습니다 — 요청서 ${created!.length}장이 각각 저장됩니다.`
              : "기록되었습니다 — 요청서 이미지가 자동 저장됩니다. (아래 내역의 ‘요청서’로 다시 받을 수 있어요)"}
          </p>
          {/* 방금 만든 요청 그대로 학부모 알림장으로 — PNG 자동 저장 흐름은 그대로 두고 진입점만 추가. */}
          {created && created.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => onSendCreated(created.map((c) => c.id))}>
              <EyIcon name="send" size={16} />
              학부모에게 발송
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
