"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SHUTTLE_ACTION, SHUTTLE_INPUT, SHUTTLE_ROW } from "@/features/shuttle/control-size";

/**
 * 정류장 위치 **검색** — 지도 위에 얹는 입력 한 칸 + 결과 목록.
 *
 * 원장(2026-09-04): *"이거 카카오맵 따면 검색해서 지정할수있지?"* — 실제 정류장 이름이
 * `(달성초 입구) 유진식당 앞` · `힐스테이트 대구역 오페라 동상 앞`처럼 **검색되는 장소명**이라,
 * 23곳을 지도에서 눈으로 찾아 클릭하는 것보다 이름을 치는 편이 훨씬 빠르다.
 *
 * 🔑 **이 파일은 SDK를 모른다** — 검색 실행(`onSearch`)은 지도 구현부가 넘겨준다. 여기는 입력·상태·
 *    결과 그리기만 한다(카카오 타입이 두 파일로 새지 않게).
 * 🔴 **`<form>`을 쓰지 않는다** — 상위(`stop-location-editor`)가 이미 폼이라 중첩 제출이 되면 위치가
 *    엉뚱하게 저장된다(HTML상 폼 중첩도 불가). Enter는 입력의 `onKeyDown`에서 직접 잡는다.
 * 🔴 모든 버튼에 **`type="button"`** — 공용 `<Button>`은 네이티브 기본값(폼 안에서 submit)을 따르므로,
 *    빠뜨리면 검색 버튼이 상위 폼을 제출한다(같은 파일의 '위치 지우기'가 이미 그래서 명시하고 있다).
 * ⚠️ 검색은 지도를 **대체하지 않는다** — 지도 클릭도 그대로 살아 있다(둘 다 같은 `onPick`으로 모인다).
 */

export type StopSearchHit = {
  id: string;
  /** 장소명("유진식당") — 주소로 찾았으면 그 주소. */
  name: string;
  /** 보조로 보여줄 주소. 이름과 같으면 빈 문자열(같은 말을 두 번 쓰지 않는다). */
  address: string;
  lat: number;
  lng: number;
};

type Phase =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "done"; hits: StopSearchHit[] }
  | { kind: "failed" };

export function StopMapSearch({
  onSearch,
  onSelect,
}: {
  /** 검색 실행 — 구현부가 카카오 SDK로 채운다. 실패하면 throw(여기서 한글 사유로 바꾼다). */
  onSearch: (query: string) => Promise<StopSearchHit[]>;
  /** 결과를 고르면 지도 클릭과 **같은 경로**로 좌표·주소를 위로 올린다. */
  onSelect: (hit: StopSearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function run() {
    const q = query.trim();
    if (!q) return;
    setPhase({ kind: "searching" });
    try {
      setPhase({ kind: "done", hits: await onSearch(q) });
    } catch {
      // 원문(영문 상태코드)을 화면에 내보내지 않는다 — 사람 말로만.
      setPhase({ kind: "failed" });
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 🔴 Enter가 상위 폼을 제출하지 않게 여기서 막고 직접 검색한다.
            if (e.key !== "Enter") return;
            e.preventDefault();
            void run();
          }}
          placeholder="정류장 이름·주소로 검색 (예: 유진식당)"
          aria-label="정류장 위치 검색"
          className={cn(SHUTTLE_INPUT, "min-w-0 flex-1")}
        />
        <Button
          type="button"
          variant="outline"
          className={SHUTTLE_ACTION}
          disabled={phase.kind === "searching" || !query.trim()}
          onClick={() => void run()}
        >
          검색
        </Button>
      </div>

      {/* 🔴 상태를 빈 상자로 두지 않는다 — 무엇이 일어나는지 늘 한 줄로 말한다. */}
      {phase.kind === "searching" && (
        <p className="text-text-faint text-xs">검색 중입니다…</p>
      )}
      {phase.kind === "failed" && (
        <p className="text-danger text-xs">
          검색하지 못했습니다 — 지도를 직접 누르거나 위도·경도를 아래 칸에 넣으세요.
        </p>
      )}
      {phase.kind === "done" && phase.hits.length === 0 && (
        <p className="text-text-faint text-xs">
          검색 결과가 없습니다 — 지도를 직접 눌러도 됩니다.
        </p>
      )}

      {phase.kind === "done" && phase.hits.length > 0 && (
        <ul className="border-line flex flex-col rounded-lg border">
          {phase.hits.map((hit) => (
            <li key={hit.id} className="border-line-faint border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onSelect(hit)}
                className={cn(
                  SHUTTLE_ROW,
                  "hover:bg-muted flex w-full cursor-pointer flex-col items-start justify-center gap-0.5 px-2.5 py-1.5 text-left",
                )}
              >
                <span className="text-foreground text-xs font-bold">{hit.name}</span>
                {hit.address && (
                  <span className="text-text-faint text-xs">{hit.address}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
