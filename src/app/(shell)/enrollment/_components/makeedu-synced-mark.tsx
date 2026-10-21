"use client";

import { useModuleOn } from "@/features/owner/operations-context";
import { cn } from "@/lib/utils";
import type { MakeeduSync } from "@/features/enrollment/makeedu-link";

/**
 * 마우스 오버 문구 — 상담·원생 **두 사실을 각각** 적는다(원장 2026-10-20 *"마우스 오버일때도 해당 상태에 대해
 * 정확하게"*). 한 줄 요약만 적으면 "원생 전환 완료"가 상담도 넘어갔다는 뜻인지 알 수 없다.
 */
export function makeeduSyncTitle({ url, converted }: MakeeduSync): string {
  return [
    `메이크에듀 상담: ${url ? "동기화 완료" : "없음"}`,
    `메이크에듀 원생: ${converted ? "전환 완료" : "전환 전"}`,
    url ? "누르면 메이크에듀 상담 화면을 엽니다" : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/**
 * '메이크에듀 동기화' 표식(원장 2026-10-20) — 이름 **왼쪽**에 선다(오른쪽은 '반 배정 완료'가 자리를 먹는다).
 * 상담만 넘어갔으면 그림 하나, 학생이 makeedu 원생으로 전환까지 됐으면 **이중 테두리**(판정 = `makeeduSyncOf`).
 * 그림은 codex 이미지 생성물(`public/marks/` — 탭 아이콘 세트 `public/icons/`와 따로 둔다: 그쪽 가드는
 * 메뉴가 안 쓰는 그림을 고아로 본다).
 *
 * ⚠️ 카드 전체가 링크(WindowLink)라 `<a>`를 겹칠 수 없다 → span + `window.open`. 누르는 것이 카드 창 열기·
 *    드래그로 새지 않게 클릭·포인터다운을 여기서 멈춘다. 갈 곳(url)이 없으면 표시만 한다.
 */
export function MakeeduSyncedMark({ url, converted, size = 22 }: MakeeduSync & { size?: number }) {
  // makeedu 기능이 꺼진 학원엔 흔적 없이(MakeeduOriginTag와 같은 스위치).
  const makeeduOn = useModuleOn("makeedu");
  if (!makeeduOn) return null;
  const title = makeeduSyncTitle({ url, converted });
  return (
    <span
      role={url ? "link" : "img"}
      tabIndex={url ? 0 : undefined}
      title={title}
      aria-label={title}
      data-converted={converted ? "true" : undefined}
      onPointerDown={url ? (e) => e.stopPropagation() : undefined}
      onClick={(e) => {
        // 링크 없는 표식도 카드 창 열기로 새지 않게 막는다 — 표식을 눌렀는데 창이 열리면 "눌렀더니 엉뚱한 데"다.
        e.preventDefault();
        e.stopPropagation();
        if (url) open(url);
      }}
      onKeyDown={
        url
          ? (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              open(url);
            }
          : undefined
      }
      className={cn(
        "box-content inline-flex shrink-0 items-center justify-center rounded-full",
        url && "cursor-pointer transition hover:brightness-95",
        converted && "border-green border-[3px] border-double",
      )}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 128px 정적 PNG, 메뉴 글리프와 같은 방식 */}
      <img src="/marks/makeedu-synced.png" alt="" width={size} height={size} draggable={false} />
    </span>
  );
}
