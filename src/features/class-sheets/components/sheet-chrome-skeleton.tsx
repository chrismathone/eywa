import { MARKER_TRIGGER, MARKER_WIDTH } from "@/components/ui/marker-trigger";
import {
  SHEET_FACES,
  SHEET_PILL_GLYPH_ICON,
  SHEET_PILL_GLYPH_LABEL,
  SHEET_SEG_BOX,
  sheetFaceLabel,
  sheetPill,
  sheetSegItem,
  type SheetFace,
} from "../chrome";

/**
 * 시트 상단 바 조각의 **스켈레톤** — 실물 [sheet-chrome.tsx](./sheet-chrome.tsx)(`"use client"`) 옆에 두되 이 파일은 순수다:
 * 서버 컴포넌트인 `loading.tsx`(ECS 주간·월간 · MCS 월간)가 읽는다. 🔴 이 파일에 `"use client"`를 붙이지 말 것.
 * 치수는 실물과 **같은 상수**(`sheetPill` · `MARKER_TRIGGER`·`MARKER_WIDTH` · `SHEET_SEG_BOX`·`sheetSegItem` · PillGlyph 클래스)만 쓴다 —
 * 2026-11-05 2차 검수: 스켈레톤들이 반 고르기를 `w-44` 막대 하나로 그려(실물 = 칩 + 380px·h-10 노란 칸 + 칩) 상단 바가 짧고 낮았다.
 * 글자는 실물 문구를 투명 글자로 깔아 폭이 실물과 같다(loading.tsx는 화면 언어를 못 읽어 한국어 문구).
 */

/** '목록'·'반 정보 보기' 알약 — 실물 `sheetPill` 상자 + PillGlyph 자리(좁은 폭 = 14px 아이콘, 넓으면 글자). */
function PillSkeleton({ label }: { label: string }) {
  return (
    <span aria-hidden className={`${sheetPill(false)} inline-flex animate-pulse items-center`}>
      <span className={`${SHEET_PILL_GLYPH_ICON} w-3.5`} />
      <span className={`${SHEET_PILL_GLYPH_LABEL} text-transparent`}>{label}</span>
    </span>
  );
}

/**
 * 실물 `SheetClassPicker` 자리 — '목록' 알약 · 노란 반 선택(`MARKER_TRIGGER` h-10 × `MARKER_WIDTH`) · '반 정보 보기' 알약 세 조각.
 * 실물처럼 툴바 줄의 직계 항목으로 펼친다(Fragment) — 같은 flex-wrap에서 같은 자리에서 감긴다.
 */
export function SheetClassPickerSkeleton() {
  return (
    <>
      <PillSkeleton label="목록" />
      <span aria-hidden className={`${MARKER_WIDTH} shrink-0`}>
        <span className={`${MARKER_TRIGGER} flex w-full animate-pulse`} />
      </span>
      <PillSkeleton label="반 정보 보기" />
    </>
  );
}

/**
 * 실물 `SheetFaceSwitch`(주간 | 달력 | 진도표 …) 자리 — 같은 묶음 상자·같은 칸 상자, 칸 글자는 투명.
 * - `faces` — 실물 호출부와 같은 값(`sheetFacesFor(isEie)`). 기본 = 실물 기본(계획 없는 세 칸).
 */
export function SheetFaceSwitchSkeleton({ faces = SHEET_FACES }: { faces?: readonly SheetFace[] }) {
  return (
    <span aria-hidden className={`${SHEET_SEG_BOX} shrink-0 animate-pulse`}>
      {faces.map((face) => (
        <span key={face} className={sheetSegItem(false)}>
          <span className="text-transparent">{sheetFaceLabel(face, "ko")}</span>
        </span>
      ))}
    </span>
  );
}
