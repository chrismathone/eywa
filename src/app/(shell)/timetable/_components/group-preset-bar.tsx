"use client";

import { useState } from "react";
import { BookMarked, Check, ChevronUp, Download, Loader2, Save, Trash2, X } from "@/components/icons/aywa-icon-compat";
import {
  MAX_GROUP_PRESETS,
  loadPreset,
  removePreset,
  upsertPreset,
  type GroupPreset,
  type PresetBody,
} from "@/features/timetable/lib/group-presets";

/**
 * 통합뷰 그룹 배치 **보관함** — 여러 벌을 이름 붙여 저장해 두고 골라 불러온다
 * (원장 2026-08-06 "여러가지 그룹화로 저장/불러오기" → "그냥 단순하게 저장 / 불러오기 있으면 좋겠는데,
 * 불러오기에서는 누가 저장했는지 어떤 이름으로 저장했는지 언제 저장했는지 알 수 있게").
 *
 * 모양: 버튼 **두 개**(저장 / 불러오기)만 노출하고, 목록은 '불러오기'를 눌렀을 때만 편다 —
 * 칩을 늘 깔아 두면 배치가 늘수록 편집 바가 표를 밀어낸다.
 *
 * 규약(순수 로직은 [group-presets.ts](src/features/timetable/lib/group-presets.ts)):
 * · 불러오기 = 내용을 **지금 화면에 복사**(링크 아님) → 불러온 뒤 마음껏 고쳐도 보관본은 안 변한다.
 *   불러온 것도 하단 **'시간표 적용'을 눌러야** 통합뷰에 적용된다(그 전엔 되돌릴 수 있다).
 * · 같은 이름으로 저장 = **덮어쓰기**(목록에서 고르는 키가 이름이라 중복이 곧 고장).
 * · 🔴 보관함 추가·삭제는 **그 자리에서 바로 저장된다**(`onChange`가 서버에 쓴다). 버튼이 "저장"이라고
 *   말해 놓고 하단 버튼을 또 눌러야 남는 구조였더니, 이름만 짓고 나간 사용자에겐 **저장했다고
 *   말해 놓고 안 남는** 거짓말이 됐다(원장 제보).
 * · '누가·언제'는 **서버가 찍는다**(saveIntegrationGroups) — 클라 값은 위조 가능해 믿지 않는다.
 */
export function GroupPresetBar({
  presets,
  onChange,
  current,
  onLoad,
  saving,
  error,
}: {
  presets: GroupPreset[];
  /** 보관함 변경 — 호출부가 **즉시 서버에 쓴다**(위 주석). */
  onChange: (next: GroupPreset[]) => void;
  /** 지금 편집 중인 배치 — '저장'이 얼려서 보관함에 넣는다. */
  current: PresetBody;
  onLoad: (body: PresetBody) => void;
  saving?: boolean;
  error?: string | null;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const overwriting = presets.some((p) => p.name.trim() === name.trim() && name.trim());

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // ⚠️ 화면에서 먼저 막는다 — 넘겨서 저장하면 zod가 거부하는데 그 에러는 영문 경로가 섞인 원문이라
    //    그대로 내보낼 수 없다(raw 코드 노출 금지). 같은 이름 덮어쓰기는 개수가 안 늘어 통과시킨다.
    if (!overwriting && presets.length >= MAX_GROUP_PRESETS) {
      setLimitMsg(`배치는 과목당 ${MAX_GROUP_PRESETS}개까지 저장할 수 있습니다 — 쓰지 않는 배치를 먼저 지워 주세요.`);
      return;
    }
    setLimitMsg(null);
    // id는 새로 만들지만, 같은 이름이 있으면 upsertPreset이 기존 id를 지켜 덮어쓴다.
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}`;
    onChange(upsertPreset(presets, { id, name: trimmed, ...current }));
    setName("");
    setNaming(false);
    setListOpen(true); // 방금 저장한 게 목록에 생긴 걸 보여 준다("어디 저장됐나" 재발 방지)
  }

  // ⚠️ **바깥 박스를 만들지 않는다** — 편집 바(부모의 `flex flex-wrap`) 안에 그대로 얹혀 한 줄이 된다
  //    (원장 2026-08-06 "2행으로 존재하는데 1개로 개편"). 목록은 `w-full`이라 flex-wrap이 알아서
  //    다음 줄로 내려 준다(열었을 때만).
  return (
    <>
      <span className="ml-auto inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-text-dim inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
          <BookMarked className="size-3" />
          저장된 배치
          <span className="text-text-faint num">{presets.length}</span>
          {saving ? <Loader2 className="text-primary size-3 animate-spin" /> : null}
        </span>
        {error ? <span className="text-danger text-xs">{error}</span> : null}
        {limitMsg ? <span className="text-danger text-xs">{limitMsg}</span> : null}

        {naming ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  setNaming(false);
                  setName("");
                }
              }}
              maxLength={30}
              placeholder="예: 학기 배치"
              className="border-line focus:border-primary bg-card w-36 rounded-lg border px-2 py-0.5 text-xs outline-none"
              aria-label="저장할 배치 이름"
            />
            <button
              type="button"
              onClick={commit}
              className="text-primary inline-flex items-center gap-0.5 text-xs font-medium hover:underline"
            >
              <Check className="size-3" />
              {overwriting ? "덮어쓰기" : "저장"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setName("");
              }}
              aria-label="취소"
              className="text-text-faint hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setNaming(true)}
              title="지금 화면의 배치를 이름 붙여 보관함에 저장합니다(바로 저장됩니다)"
              className="border-line bg-card text-text-dim hover:text-foreground inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-xs"
            >
              <Save className="size-3" />
              저장
            </button>
            {/* ⚠️ 열려 있을 땐 '닫기'로 바꾼다 — 안 그러면 목록 줄마다 있는 '불러오기'와 **같은 이름의
                버튼이 우측에 둘** 보인다(원장 2026-08-06 제보). 여는 버튼과 고르는 버튼은 다른 일이다. */}
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              disabled={presets.length === 0}
              title={presets.length ? "저장해 둔 배치를 골라 불러옵니다" : "아직 저장한 배치가 없습니다"}
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-xs transition disabled:opacity-40 ${
                listOpen
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line bg-card text-text-dim hover:text-foreground"
              }`}
            >
              {listOpen ? (
                <>
                  <ChevronUp className="size-3" />
                  닫기
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  불러오기
                </>
              )}
            </button>
          </span>
        )}
      </span>

      {listOpen && presets.length > 0 ? (
        <ul className="border-primary/25 mt-1.5 w-full space-y-1 border-t pt-1.5">
          {presets.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="text-foreground min-w-24 font-medium">{p.name}</span>
              <span className="text-text-faint num">{p.groups.length}줄</span>
              {/* 누가·언제 — "이거 누가 언제 만든 배치더라"를 알아야 고를 수 있다(원장 지시). */}
              <span className="text-text-dim">{p.savedBy ?? "저장자 미상"}</span>
              <span className="text-text-faint num">{savedAtLabel(p.savedAt)}</span>
              {confirmDel === p.id ? (
                <span className="text-danger ml-auto inline-flex items-center gap-1">
                  삭제할까요?
                  <button
                    type="button"
                    onClick={() => {
                      onChange(removePreset(presets, p.id));
                      setConfirmDel(null);
                    }}
                    className="font-bold hover:underline"
                  >
                    삭제
                  </button>
                  <button type="button" onClick={() => setConfirmDel(null)} className="text-text-dim hover:text-foreground">
                    취소
                  </button>
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onLoad(loadPreset(p));
                      setListOpen(false);
                    }}
                    title={`‘${p.name}’ 배치를 지금 화면에 불러옵니다(‘시간표 적용’ 전이라 되돌릴 수 있습니다)`}
                    className="border-primary text-primary hover:bg-primary hover:text-primary-foreground inline-flex items-center gap-0.5 rounded-full border px-2 py-px font-medium transition"
                  >
                    <Download className="size-2.5" />
                    불러오기
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(p.id)}
                    aria-label={`${p.name} 삭제`}
                    className="text-text-faint hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** 저장 시각 표시 — 저장은 ISO(UTC), 표시는 **Asia/Seoul**(서버가 UTC라 그냥 찍으면 9시간 어긋난다). */
function savedAtLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
