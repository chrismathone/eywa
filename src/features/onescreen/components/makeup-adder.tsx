"use client";

/**
 * 보강(수업외) 학생 추가 — edutrix "+ 학생 추가". 같은 학원 학생을 이름으로 검색해 원스크린에 수동 추가.
 * 담당 반이 아니어도 보강으로 참여한 학생의 보고서를 쓸 수 있게(원장 승인 정책 = 학원 전체).
 * 추가된 학생은 isMakeup 표식 + outOfClass 저장 경로(세션 자동저장은 스킵 — 반이 없음).
 */
import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { searchTenantStudents } from "../server/actions";

export function MakeupAdder({ onAdd }: { onAdd: (studentId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0); // 응답 순서 역전 방지(늦게 온 옛 검색이 최신 결과 덮지 않게)

  // 입력마다 디바운스 검색(effect 아님 — 이벤트 핸들러라 set-state-in-effect 규칙 회피).
  const runSearch = (term: string) => {
    setQ(term);
    if (timer.current) clearTimeout(timer.current);
    const t = term.trim();
    if (t.length < 1) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const mine = ++seq.current;
    timer.current = setTimeout(() => {
      void searchTenantStudents(t).then((r) => {
        if (mine !== seq.current) return; // 최신 검색만 반영
        setResults(r);
        setLoading(false);
      });
    }, 250);
  };

  // 언마운트 시 타이머 정리(cleanup만 — setState 없음).
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-[12px] font-bold">
        + 보강 학생 추가
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[280px] rounded-lg border p-2 text-[12px] outline-none">
            <input
              autoFocus
              value={q}
              onChange={(e) => runSearch(e.target.value)}
              placeholder="학생 이름 검색"
              aria-label="보강 학생 이름 검색"
              className="border-line bg-bg-soft focus:border-primary h-8 w-full rounded-lg border px-2 outline-none"
            />
            <div className="scrollbar-thin mt-1.5 max-h-64 overflow-y-auto">
              {loading ? (
                <p className="text-text-faint px-2 py-3 text-center">검색 중…</p>
              ) : results.length === 0 ? (
                <p className="text-text-faint px-2 py-3 text-center">
                  {q.trim() ? "결과 없음" : "이름을 입력하세요"}
                </p>
              ) : (
                results.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onAdd(s.id);
                      setOpen(false);
                      setQ("");
                    }}
                    className="hover:bg-bg-soft flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left"
                  >
                    <span className="text-foreground font-bold">{s.name}</span>
                    <span className="text-text-faint text-[11px]">{s.label}</span>
                  </button>
                ))
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
