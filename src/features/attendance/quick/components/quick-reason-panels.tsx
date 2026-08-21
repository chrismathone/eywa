"use client";
/**
 * '출결 모드' 시트의 **사유 패널 두 장** — 결석(사유는 나중·선택)·지각(시각 확인 후 저장).
 *
 * 원장 2026-08-20 정정(*"3번이 지각으로 하고, 2번이 결석으로 해"*): 실데이터가 그 말과 같다 —
 * 최근 1년 **결석 974건 vs 지각 29건(33배)**. 흔한 쪽이 빨라야 하므로 결석이 2터치, 지각이 3터치다.
 *
 * 🔑 두 패널의 계약이 정반대다.
 *   · **결석은 이미 저장된 뒤**에 열린다(칩 → 결석 = 2터치). 여기 사유 칩은 **메모만** 덧붙이는
 *     선택 단계라, 아무것도 안 누르고 닫아도 결석은 남아 있다.
 *     🔴 사유 선택을 저장 **앞**에 두지 말 것 — 그러면 사유를 안 고르면 결석이 안 찍힌다(3터치 고정).
 *   · **지각은 아직 저장 전**이다(칩 → 지각 → 저장 = 3터치). 메모에 **시각이 들어가기 때문**에 사람이
 *     한 번 보고 넘긴다 — 잘못된 등원 시각이 조용히 저장되면 나중에 아무도 되짚지 못한다.
 * ⚠️ 터치 타겟은 44px(`min-h-11`), 입력 글씨는 16px — iOS가 16px 미만 입력에서 화면을 확대한다.
 */
import { useState } from "react";
import { ATT_SOLID } from "@/features/attendance/status-color";
import { ABSENCE_REASON_PRESETS, LATE_REASON_PRESETS } from "../reason-presets";

/** 사유 칩 한 개 — 고른 것은 채움(캐논상 '현재 위치' = brand). 라벨·색을 화면마다 새로 만들지 않는다. */
function chip(on: boolean): string {
  return `min-h-11 rounded-xl px-3 text-[15px] font-bold transition ${
    on ? "bg-primary text-primary-foreground" : "border-line text-foreground hover:bg-bg-soft border"
  }`;
}

/** 자유 입력 — 프리셋에 없는 사유. 열려 있을 때만 칸이 생긴다(평소엔 버튼 한 개). */
function FreeText({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** 사용자가 '직접 입력'을 눌러 연 경우만 true — 저장된 사유를 되살려 여는 것만으로 폰 키보드가
   *  튀어오르면 시트 절반이 가려진다. */
  autoFocus: boolean;
}) {
  return (
    <div className="flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="border-line min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-[16px]"
      />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!value.trim()}
        className="bg-primary text-primary-foreground min-h-11 shrink-0 rounded-xl px-4 text-[15px] font-bold disabled:opacity-40"
      >
        저장
      </button>
    </div>
  );
}

/**
 * 지각 **확인 단계** — 자동으로 채워진 등원 시각을 크게 보여주고, 저장을 눌러야 기록된다.
 * `time`·`reason`은 시트가 들고 있다(저장 전 초안) — 패널은 고르기만 하고 액션을 부르지 않는다.
 */
export function LatePanel({
  time,
  reason,
  note,
  onShift,
  onTime,
  onReason,
  onSubmit,
}: {
  time: string;
  reason: string | null;
  /** 저장될 메모 미리보기(`17:05 등원 · 버스 놓침`) — 무엇이 남는지 보고 넘기는 단계다. */
  note: string;
  onShift: (deltaMin: number) => void;
  onTime: (hhmm: string) => void;
  onReason: (reason: string | null) => void;
  onSubmit: () => void;
}) {
  const preset = reason != null && (LATE_REASON_PRESETS as readonly string[]).includes(reason);
  const [free, setFree] = useState(reason && !preset ? reason : "");
  const [freeOpen, setFreeOpen] = useState<false | "restored" | "user">(
    reason && !preset ? "restored" : false,
  );
  return (
    <div className="space-y-3">
      <p className="text-text-dim text-center text-[13px]">
        메모로 남을 내용 — <span className="text-foreground font-bold">{note}</span>
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onShift(-5)} className={chip(false)} aria-label="등원 시각 5분 앞으로">
          −5분
        </button>
        <input
          type="time"
          value={time}
          onChange={(e) => e.target.value && onTime(e.target.value)}
          aria-label="등원 시각"
          className="border-line num min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-center text-[20px] font-bold"
        />
        <button type="button" onClick={() => onShift(5)} className={chip(false)} aria-label="등원 시각 5분 뒤로">
          +5분
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {LATE_REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => onReason(reason === r ? null : r)} className={chip(reason === r)}>
            {r}
          </button>
        ))}
      </div>
      {freeOpen ? (
        <FreeText
          value={free}
          onChange={setFree}
          onSubmit={() => onReason(free.trim() || null)}
          placeholder="사유 직접 입력"
          autoFocus={freeOpen === "user"}
        />
      ) : (
        <button type="button" onClick={() => setFreeOpen("user")} className={`${chip(false)} w-full`}>
          직접 입력
        </button>
      )}
      <button
        type="button"
        onClick={onSubmit}
        className={`min-h-14 w-full rounded-2xl text-[17px] font-bold ${ATT_SOLID.late}`}
      >
        지각 저장
      </button>
    </div>
  );
}

/**
 * 결석 **사유 덧붙이기**(선택) — 결석은 이 패널이 열리기 전에 이미 저장돼 있다.
 * 칩을 누르면 메모만 갱신하고 닫는다. 아무것도 안 눌러도 결석은 남아 있다.
 */
export function AbsentPanel({
  reason,
  onPick,
}: {
  reason: string | null;
  onPick: (reason: string) => void;
}) {
  const preset = reason != null && (ABSENCE_REASON_PRESETS as readonly string[]).includes(reason);
  const [free, setFree] = useState(reason && !preset ? reason : "");
  const [freeOpen, setFreeOpen] = useState<false | "restored" | "user">(
    reason && !preset ? "restored" : false,
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {ABSENCE_REASON_PRESETS.map((r) => (
          <button key={r} type="button" onClick={() => onPick(r)} className={chip(reason === r)}>
            {r}
          </button>
        ))}
      </div>
      {freeOpen ? (
        <FreeText
          value={free}
          onChange={setFree}
          onSubmit={() => free.trim() && onPick(free.trim())}
          placeholder="사유 직접 입력"
          autoFocus={freeOpen === "user"}
        />
      ) : (
        <button type="button" onClick={() => setFreeOpen("user")} className={`${chip(false)} w-full`}>
          직접 입력
        </button>
      )}
    </div>
  );
}
