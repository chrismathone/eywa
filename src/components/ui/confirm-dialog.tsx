"use client";

import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

// 디자인 톤 확인 다이얼로그 — 네이티브 confirm()의 OS 박스(폭/줄바꿈 제어 불가, "다." 외톨이 줄)를 대체.
// 컨트롤드: 호출부가 open 상태 + onConfirm/onCancel를 소유. 메시지는 어절 단위(keep-all 전역)로 깔끔히 접힘.
//
// 🔴 **반드시 `document.body`로 포털한다**(2026-09-07, 원장 제보 *"이력 삭제시에 이상하게 나오는 버그"*).
//    이 창은 표 안 버튼에서 열리는 일이 많은데, 그러면 DOM상 `<td>` 자손이 되어 표가 건 스타일을
//    **그대로 물려받는다** — 학생 상세 수업 탭 표가 `[&_td]:whitespace-nowrap`이라 안내 문구가 줄바꿈을
//    못 하고 `max-w-sm` 상자 밖으로 흘러 뒤 내용 위를 지나갔다. 호출부가 16곳이고 그중 어디가 표 안인지는
//    **소스만 봐선 모른다**(버튼이 별도 컴포넌트면 그 파일엔 `<td>`가 없다) — 그래서 창 쪽에서 끊는다.
// ⚠️ 덤으로 `transform`·`filter`가 걸린 조상 밑에서 `position:fixed`의 기준이 뒤바뀌는 함정([[#98]]·[[#128]])도
//    같이 사라진다. 새 오버레이를 만들 땐 이 파일을 선례로 쓸 것.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // 서버 렌더에는 body가 없다 — 이 창은 사람이 눌러야 열리므로 SSR에서 open=true인 경우가 없다.
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      // whitespace-normal = 물려받은 nowrap을 끊는 이중 방어(포털이 이미 끊지만, 나중에 누가
      // 이 창을 다시 안쪽으로 옮겨도 문구가 넘치지 않게).
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 whitespace-normal sm:items-center"
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-background border-line w-full max-w-sm rounded-lg border p-5 shadow-lg"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {title ? <h2 className="text-foreground mb-1.5 text-sm font-bold">{title}</h2> : null}
        <p className="text-text-dim text-sm leading-relaxed">{message}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
