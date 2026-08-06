"use client";

import { useState } from "react";
import { BookMarked, Check, Trash2, X } from "@/components/icons/eywa-icon-compat";
import {
  loadPreset,
  removePreset,
  upsertPreset,
  type GroupPreset,
  type PresetBody,
} from "@/features/timetable/lib/group-presets";

/**
 * 통합뷰 그룹 배치 **보관함** 줄 — 여러 벌을 이름 붙여 저장해 두고 골라 불러온다
 * (원장 2026-08-06 "여러가지 그룹화로 저장/불러오기"). '그룹 설정' 창과 통합뷰 '배치 편집' 바가 **공유**한다.
 *
 * 규약(순수 로직은 [group-presets.ts](src/features/timetable/lib/group-presets.ts)):
 * · 불러오기 = 내용을 **지금 배치에 복사**(링크 아님) → 불러온 뒤 마음껏 고쳐도 보관본은 안 변한다.
 * · 같은 이름으로 저장 = **덮어쓰기**(목록에서 고르는 키가 이름이라 중복이 곧 고장).
 * · 여기서 바꾼 보관함은 **아직 저장 안 된 상태** — 부모의 '저장'이 현재 배치와 함께 한 번에 쓴다
 *   (프리셋만 따로 쓰는 액션을 만들면 같은 설정 한 곳을 두 경로가 다투게 된다).
 */
export function GroupPresetBar({
  presets,
  onChange,
  current,
  onLoad,
}: {
  presets: GroupPreset[];
  onChange: (next: GroupPreset[]) => void;
  /** 지금 편집 중인 배치 — '현재 배치 저장'이 얼려서 보관함에 넣는다. */
  current: PresetBody;
  onLoad: (body: PresetBody) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const overwriting = presets.some((p) => p.name.trim() === name.trim() && name.trim());

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // id는 새로 만들지만, 같은 이름이 있으면 upsertPreset이 기존 id를 지켜 덮어쓴다.
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}`;
    onChange(upsertPreset(presets, { id, name: trimmed, ...current }));
    setName("");
    setNaming(false);
  }

  return (
    <div className="border-line bg-bg-soft/60 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border px-2.5 py-1.5">
      <span className="text-text-dim inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold">
        <BookMarked className="size-3" />
        저장된 배치
      </span>

      {presets.length === 0 && !naming ? (
        <span className="text-text-faint text-[11px]">아직 없습니다 — 지금 배치를 이름 붙여 저장해 두면 언제든 되돌릴 수 있습니다.</span>
      ) : null}

      {presets.map((p) =>
        confirmDel === p.id ? (
          <span
            key={p.id}
            className="border-danger text-danger inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
          >
            ‘{p.name}’ 삭제?
            <button type="button" onClick={() => { onChange(removePreset(presets, p.id)); setConfirmDel(null); }} className="font-bold hover:underline">
              삭제
            </button>
            <button type="button" onClick={() => setConfirmDel(null)} className="text-text-dim hover:text-foreground">
              취소
            </button>
          </span>
        ) : (
          <span
            key={p.id}
            className="border-line bg-card inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-[11px]"
          >
            <button
              type="button"
              onClick={() => onLoad(loadPreset(p))}
              title={`‘${p.name}’ 배치를 지금 화면에 불러옵니다(저장 전이라 되돌릴 수 있습니다)`}
              className="text-foreground font-medium hover:underline"
            >
              {p.name}
            </button>
            <span className="text-text-faint num">{p.groups.length}줄</span>
            <button
              type="button"
              onClick={() => setConfirmDel(p.id)}
              aria-label={`${p.name} 삭제`}
              className="text-text-faint hover:text-danger"
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        ),
      )}

      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setNaming(false); setName(""); }
            }}
            maxLength={30}
            placeholder="예: 학기 배치"
            className="border-line focus:border-primary w-32 rounded-lg border px-2 py-0.5 text-[11px] outline-none"
            aria-label="저장할 배치 이름"
          />
          <button type="button" onClick={commit} className="text-primary inline-flex items-center gap-0.5 text-[11px] font-medium hover:underline">
            <Check className="size-3" />
            {overwriting ? "덮어쓰기" : "저장"}
          </button>
          <button type="button" onClick={() => { setNaming(false); setName(""); }} aria-label="취소" className="text-text-faint hover:text-foreground">
            <X className="size-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="border-line text-text-dim hover:text-foreground hover:bg-card ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px]"
        >
          현재 배치를 이름 붙여 저장
        </button>
      )}
    </div>
  );
}
