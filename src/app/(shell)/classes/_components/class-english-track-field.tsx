"use client";

import { ENGLISH_TRACK_OPTIONS, type EnglishTrack } from "@/features/classes/english-track";

/**
 * 영어 프로그램 구분(EiE / 인재원 영어) — 반 생성·수정 폼의 한 섹션(0176a).
 *
 * 원장 2026-08-04: *"영어과목으로 수업생성할때 EiE/인재원 영어 토글 가능하도록 배선까지."*
 *
 * ⚠️ **과목이 영어일 때만 렌더**한다(호출부 조건). 다른 과목엔 트랙 개념이 없고, 안 그리면 필드가
 *    폼에 없으므로 서버가 "이 폼은 이 칸을 모른다"로 보고 기존 값을 건드리지 않는다.
 *    (영어 → 다른 과목으로 바꿔 저장하면 `normalizeEnglishTrack`이 null로 정리한다.)
 * ⚠️ 특강·미발송 토글과 달리 **hidden 마커가 필요 없다** — 라디오는 항상 하나가 체크돼 값이 오기 때문.
 *    대신 초안 복원 때 `applyFormValues`가 DOM만 건드리므로 컨트롤드 state를 호출부에서 함께 맞춘다.
 */
export function ClassEnglishTrackField({
  value,
  onChange,
}: {
  value: EnglishTrack;
  onChange: (next: EnglishTrack) => void;
}) {
  return (
    <section className="space-y-3 border-t pt-4">
      <header>
        <h3 className="text-foreground text-sm font-bold">영어 프로그램</h3>
        <p className="text-muted-foreground text-xs break-keep">
          이 반이 EiE 레벨 수업인지, 인재원 자체 영어 수업인지 고릅니다.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {ENGLISH_TRACK_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition ${
              value === opt.value ? "border-primary bg-primary/5" : "border-line bg-bg-soft/60 hover:bg-bg-soft"
            }`}
          >
            <input
              type="radio"
              name="englishTrack"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="size-4 shrink-0"
            />
            <span className="text-foreground text-sm font-medium">{opt.label}</span>
          </label>
        ))}
      </div>

      {/* 무엇이 바뀌고 무엇이 안 바뀌는지 정직하게(거짓 약속 금지) — 이건 보기 필터용 분류지 권한·집계가 아니다. */}
      <p className="text-muted-foreground text-xs break-keep">
        English Class Sheet 목록의 <span className="text-foreground">프로그램 필터</span>가 이 값을 씁니다.
        시간표·출석부·수업보고서·수강료에는 영향이 없습니다.
      </p>
    </section>
  );
}
