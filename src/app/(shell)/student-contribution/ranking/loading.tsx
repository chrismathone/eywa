export default function RankingLoading() {
  return <div className="space-y-5" role="status" aria-label="학생 로열티 기록을 불러오는 중">
    <h1 className="text-xl font-bold">학생 로열티 기록실</h1><p className="text-sm text-text-dim">학생별 기록과 비교 순위를 불러오고 있습니다.</p>
    <div className="h-44 rounded-2xl bg-secondary" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({length:6},(_,i)=><div key={i} className="h-36 rounded-xl bg-secondary" />)}</div>
    <div className="h-80 rounded-2xl bg-secondary" />
  </div>;
}
