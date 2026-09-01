"use client";

import { EyIcon, type EywaIconName } from "@/components/icons/eywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import { MARKER_TRIGGER, MARKER_WIDTH } from "@/components/ui/marker-trigger";
import {
  SHEET_FACES,
  SHEET_FACE_LABEL,
  SHEET_FACE_TITLE,
  SHEET_SEG_BOX,
  sheetPill,
  sheetSegItem,
  type SheetFace,
} from "../chrome";

/**
 * ECS 상단 바의 **공용 조각** — 표기는 [`chrome.ts`](../chrome.ts), 여기는 그리는 쪽.
 * 주간 시트([sheet-toolbar](./sheet-toolbar.tsx))와 월간 뷰([month-client](./month-client.tsx))가
 * 이 둘을 그대로 쓴다(원장 2026-09-01 *"일관성있게 디자인 통일"*).
 */

/** 덩어리 사이 세로 실선 — 두 화면이 같은 자리에서 끊어 읽히게. */
export function SheetBarDivider() {
  return <span className="bg-line h-4 w-px" aria-hidden />;
}

/**
 * 알약 **속살** — 좁은 폭에선 글자를 접고 아이콘만, `md`(768px)부터 원래 라벨
 * (원장 2026-09-01 *"좁은 폭에서 목록/반 정보 보기 접어줘"*). 768px은 ECS 반 목록이 좌우로
 * 갈리는 축과 **같은 값**이다(landing-list `md:grid-cols-2`) — ECS 안에서 좁고 넓음의 경계는 하나다.
 *
 * 🔴 **접는 것이지 없애는 것이 아니다** — 아이콘 알약은 그대로 눌린다. 좁은 폭에서 통째로 숨기면
 *    '반 정보 보기'는 이 화면에서 그 반으로 가는 **유일한 문**이라 갈 길이 사라진다(하부탭에만 있던
 *    셔틀 '오늘 등하원'이 폰에서 끊겼던 것과 같은 함정 — features/shuttle/faces.ts).
 * 🔴 두 상태 다 한쪽이 `display:none`이라 **접근성 이름이 비어 버린다** → 호출부가 `aria-label`을
 *    반드시 준다(이 조각 혼자로는 못 읽힌다). 넘기는 `hint`는 그 이름과 같은 말이어야 한다 —
 *    보이는 글자와 읽히는 이름이 갈리면 음성으로 조작하는 사람이 못 부른다.
 * ⚠️ 아이콘 자리는 `h-[18px]` — 12px 글자의 줄상자(preflight `line-height: 1.5`)와 **같은 높이**다.
 *    안 맞추면 접힌 알약만 4px 낮아져 바로 옆 요일 알약과 밑줄이 어긋난다.
 */
function PillGlyph({
  icon,
  hint,
  children,
}: {
  icon: EywaIconName;
  /** 접혔을 때의 툴팁 — `WindowLink`의 `title`은 **창 제목**이라 툴팁으로 안 쓰인다. */
  hint: string;
  children: string;
}) {
  return (
    <>
      <span className="flex h-[18px] items-center md:hidden" title={hint}>
        <EyIcon name={icon} size={14} />
      </span>
      <span className="hidden md:inline">{children}</span>
    </>
  );
}

/**
 * 왼쪽 덩어리 — **목록 · 반 선택 · 반 정보 보기**.
 *
 * ⚠️ 반 선택은 [marker-trigger](@/components/ui/marker-trigger)의 노란 표기다 — "반을 골라 그 반의
 *    내용이 아래에 채워지는" 드롭다운이라는 조건에 월간도 똑같이 해당한다(그 파일의 🔑 조건).
 *    월간이 평범한 셀렉트였던 것이 두 화면이 가장 크게 갈려 보이던 지점이다.
 * 🔴 이동은 **호출부가 책임진다**(`onNavigate`) — 주간은 저장 큐, 월간은 목표 편집 큐를 먼저 비워야
 *    해서 순서가 화면마다 다르다. 여기서 `router.push`를 부르면 그 순서를 건너뛴다.
 */
export function SheetClassPicker({
  classId,
  classLabel,
  classOptions,
  onNavigate,
  hrefForClass,
}: {
  classId: string;
  /** 지금 보고 있는 반 이름 — 툴팁·스크린리더 라벨에 쓴다. */
  classLabel: string;
  classOptions: { id: string; name: string }[];
  onNavigate: (href: string) => void | Promise<void>;
  /** 반을 바꿨을 때 갈 곳 — 주간은 보던 주를, 월간은 보던 달을 유지한다. */
  hrefForClass: (classId: string) => string;
}) {
  return (
    <>
      <button
        type="button"
        className={`${sheetPill(false)} inline-flex items-center`}
        onClick={() => void onNavigate("/ecs")}
        aria-label="반 목록"
      >
        <PillGlyph icon="list" hint="반 목록">
          목록
        </PillGlyph>
      </button>
      <span className={`${MARKER_WIDTH} shrink-0`}>
        <SearchableSelect
          options={classOptions.map((c) => ({ value: c.id, label: c.name }))}
          value={classId}
          onValueChange={(v) => {
            if (v && v !== classId) void onNavigate(hrefForClass(v));
          }}
          placeholder="반 선택"
          ariaLabel="반 전환"
          // ⚠️ `compact`를 안 쓴다 — 그건 쉐브론을 10px로 줄이는데(gap도 1) 21px 글자 옆에선
          //    흔적만 남는다.
          triggerClassName={MARKER_TRIGGER}
          // 반이 수십 개라 목록에서 **지금 보고 있는 반**을 눈으로 못 찾겠다는 지적(원장 2026-08-06).
          highlightSelected
        />
      </span>
      {/* 반 정보 보기 — 드롭다운 **바로 옆**이라 "지금 고른 그 반"이라는 게 자리로 읽힌다.
          WindowLink라 창 안에선 드릴인, 최상위에선 새 창. */}
      <WindowLink
        href={`/classes/${classId}`}
        title={classLabel}
        className={`${sheetPill(false)} inline-flex items-center`}
        ariaLabel={`${classLabel} 반 정보 보기`}
      >
        <PillGlyph icon="info" hint={`${classLabel} 반 정보 보기`}>
          반 정보 보기
        </PillGlyph>
      </WindowLink>
    </>
  );
}

/**
 * **주간 | 달력 | 진도표** — 같은 반을 보는 세 면의 전환.
 *
 * 기간 네비 **바로 옆**에 둔다: 여기가 "지금 이 반을 어느 기간·어느 모양으로 보고 있나"를 다루는 자리다.
 * 🔴 지금 보고 있는 면은 눌러도 아무 일도 안 한다 — 같은 화면을 다시 부르면 저장 flush만 도는 헛걸음이다.
 */
export function SheetFaceSwitch({
  current,
  faces = SHEET_FACES,
  onSelect,
}: {
  current: SheetFace;
  /**
   * 이 반이 열 수 있는 면 — 호출부가 [`sheetFacesFor(isEie)`](../chrome.ts)로 만든다.
   * 🔴 기본값은 **계획(MP) 없는 세 칸**이다 — 안 넘기면 EiE 아닌 반에 없는 문이 생긴다.
   */
  faces?: readonly SheetFace[];
  onSelect: (face: SheetFace) => void;
}) {
  return (
    <span className={`${SHEET_SEG_BOX} shrink-0`}>
      {faces.map((face) => {
        const active = face === current;
        return (
          <button
            key={face}
            type="button"
            aria-pressed={active}
            title={SHEET_FACE_TITLE[face]}
            onClick={() => {
              if (!active) onSelect(face);
            }}
            className={`${sheetSegItem(active)}`}
          >
            {SHEET_FACE_LABEL[face]}
          </button>
        );
      })}
    </span>
  );
}
