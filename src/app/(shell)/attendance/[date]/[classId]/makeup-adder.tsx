"use client";

/**
 * 보강(수업외) 학생 추가 — 출석 입력 화면. 원스크린 '+ 보강 학생 추가'(수업보고서)의 출결판으로,
 * 그 반 수강생이 아니어도 그날 와서 수업을 들은 학생의 출결을 남길 수 있게 한다(원장 요청 2026-07-22).
 *
 * ⚠️ 검색은 반드시 [`searchMakeupStudents`](src/features/attendance/server/actions.ts) 경유 —
 * 그 액션이 출결 쓰기 권한 + 강사(scoped) 담당 반을 자기 자리에서 검사한다(#77). 화면 조건은 게이트가 아니다.
 */
import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { searchMakeupStudents } from "@/features/attendance/server/actions";
import { useSheetLang, useSheetT } from "@/features/teacher-view/lang-context";
import { studentDisplayName } from "@/features/teacher-view/student-name";
import { sheetSchoolGrade } from "@/features/teacher-view/school-grade";

export type MakeupPick = { id: string; name: string; label: string; englishName?: string | null; school?: string | null; grade?: string | null };

export function AttendanceMakeupAdder({
  classId,
  date,
  disabled,
  onAdd,
}: {
  classId: string;
  /** 보고 있는 수업일 — 그날 담당으로 검색을 연다. 없으면 오늘. */
  date?: string;
  disabled?: boolean;
  onAdd: (student: MakeupPick) => void;
}) {
  const t = useSheetT();
  const lang = useSheetLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MakeupPick[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0); // 응답 순서 역전 방지(늦게 온 옛 검색이 최신 결과를 덮지 않게)

  // 입력마다 디바운스 검색(effect 아님 — 이벤트 핸들러라 set-state-in-effect 규칙 회피, #25).
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
      void searchMakeupStudents(classId, t, date).then((r) => {
        if (mine !== seq.current) return; // 최신 검색만 반영
        setResults(r);
        setLoading(false);
      });
    }, 250);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className="border-line text-text-dim hover:bg-bg-soft rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
      >
        {t("os.makeup.add")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[280px] rounded-xl border p-2 text-xs outline-none">
            <input
              autoFocus
              value={q}
              onChange={(e) => runSearch(e.target.value)}
              placeholder={t("os.makeup.searchPh")}
              aria-label={t("os.makeup.searchAria")}
              className="border-line bg-bg-soft focus:border-primary h-8 w-full rounded-lg border px-2 outline-none"
            />
            <div className="scrollbar-thin mt-1.5 max-h-64 overflow-y-auto">
              {loading ? (
                <p className="text-text-faint px-2 py-3 text-center">{t("os.makeup.searching")}</p>
              ) : results.length === 0 ? (
                <p className="text-text-faint px-2 py-3 text-center">
                  {q.trim() ? t("os.makeup.noResult") : t("os.makeup.typeName")}
                </p>
              ) : (
                results.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      onAdd(s);
                      setOpen(false);
                      setQ("");
                      setResults([]);
                    }}
                    className="hover:bg-bg-soft flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left"
                  >
                    <span className="text-foreground font-medium">{studentDisplayName(s.name, s.englishName, lang)}</span>
                    <span className="text-text-faint text-xs">{s.school !== undefined || s.grade !== undefined ? sheetSchoolGrade(s.school, s.grade, lang) : s.label}</span>
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
