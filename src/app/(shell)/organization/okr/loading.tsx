/** 조직·OKR 첫 로드 뼈대 — 기록 조회를 기다리는 동안 빈 화면 대신(B7). */
export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="조직·OKR 불러오는 중">
      <div className="border-line bg-card h-20 animate-pulse rounded-2xl border" />
      <div className="border-line bg-card h-64 animate-pulse rounded-2xl border" />
      <div className="border-line bg-card h-48 animate-pulse rounded-2xl border" />
    </div>
  );
}
