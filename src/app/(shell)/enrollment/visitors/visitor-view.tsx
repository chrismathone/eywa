"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/toolbar";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { loadVisitorMonth } from "@/features/visitor-history/server/actions";
import { reconcileMonths, type MonthHistory } from "@/features/visitor-history/model";
import { MonthTable } from "./month-table";
import { RecordTable } from "./record-table";

export function VisitorView({ today, sources }: { today: string; sources: string[] }) {
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [selected, setSelected] = useState(today.slice(0, 7));
  const [history, setHistory] = useState<Record<string, MonthHistory>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const generation = useRef(0);
  const reconciled = useMemo(() => reconcileMonths(history), [history]);
  useEffect(() => () => { generation.current++; }, []);
  async function load() {
    const run = ++generation.current;
    const refresh = Object.keys(history).length > 0 || Object.keys(errors).length > 0;
    const years = year > 2000 ? [year, year - 1] : [year];
    const months = years.flatMap(y => Array.from({ length: 12 }, (_, m) => `${y}-${String(m + 1).padStart(2, "0")}`));
    // Clear the previous run: old success must not mask a failed refresh.
    setHistory({}); setErrors({}); setProgress({ done: 0, total: months.length });
    for (let i = 0; i < months.length; i++) {
      if (run !== generation.current) return;
      const month = months[i];
      try {
        const result = await loadVisitorMonth(month, refresh);
        if (run !== generation.current) return;
        if ("data" in result) setHistory(prev => ({ ...prev, [month]: result.data }));
        else setErrors(prev => ({ ...prev, [month]: result.error }));
      } catch {
        if (run !== generation.current) return;
        setErrors(prev => ({ ...prev, [month]: "조회 실패 — 다시 조회해 주세요." }));
      }
      setProgress({ done: i + 1, total: months.length });
    }
    if (run === generation.current) setProgress(null);
  }
  function changeYear(value: number) {
    generation.current++; setProgress(null); setYear(value);
    setHistory({}); setErrors({}); setSelected(`${value}-01`);
  }
  const loaded = Object.values(history).length;
  return <div className="space-y-5">
    <Toolbar rail={false}>
      <label className="flex items-center gap-2 text-sm">조회 연도
        <select className={TOOLBAR_SELECT} value={year} onChange={e => changeYear(Number(e.target.value))}>
          {Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i).map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
      </label>
      <Button onClick={load} disabled={!!progress || !sources.length}>{loaded ? "다시 조회" : "구글 기록 조회"}</Button>
      {progress && <Button variant="ghost" onClick={() => { generation.current++; setProgress(null); }}>조회 중지</Button>}
      <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {progress ? `${progress.done}/${progress.total}개월 조회 중` : loaded ? `${loaded}개월 조회됨` : "조회하면 월별 기록이 차례로 나타납니다"}
      </span>
    </Toolbar>
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>조회 캘린더: {sources.length ? sources.join(" · ") : "연결된 조사 대상이 없습니다. 학원 캘린더 연결 설정을 확인해 주세요."}</p>
      <p>예약일 기준 · 한국 시간 · 조회 결과는 5분간 재사용하며 ‘다시 조회’는 원본을 갱신합니다. ‘상담·테스트·입테·입학테스트’와 ‘레테’를 제목에서 찾습니다.</p>
      <p>예약 기록은 실제 방문·신규 학생·최초 문의 수와 다릅니다. 반복 예약은 각각 남고, 같은 예약의 사본만 합칩니다.</p>
    </div>
    <MonthTable year={year} today={today} history={reconciled} errors={errors} selected={selected} onSelect={setSelected} />
    <RecordTable key={selected} month={selected} data={reconciled[selected]} error={errors[selected]} today={today} />
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer">집계 기준과 기록의 한계</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>상담과 테스트를 함께 적은 일정은 입학테스트 → 테스트 → 상담 순으로 한 번만 분류합니다.</li>
        <li>취소 표시와 확인 대기(전화·재원생 상담, 일정 변경 등)는 집계 예약에서 제외합니다. 원본을 고친 뒤 다시 조회하면 반영됩니다.</li>
        <li>일반 ‘테스트’도 예약 후보입니다. 제목만으로 입학 목적이나 실제 참석을 확정하지 않습니다.</li>
        <li>전년 대비는 양쪽 조회가 끝난 지난달까지만 계산합니다. 일부 조회·미조회는 0건으로 채우지 않습니다.</li>
        <li>‘조회 완료’는 선택한 캘린더를 끝까지 읽었다는 뜻입니다. 원래 누락된 예약이나 삭제되어 사라진 제목·날짜는 복원할 수 없습니다.</li>
        <li>과거 기록도 현재 구글 원본 기준입니다. 별도 장기 보관본이 아니며, 다른 ID로 다시 만든 변경 예약은 자동으로 같은 예약이라 판단하지 않습니다.</li>
      </ul>
    </details>
  </div>;
}
