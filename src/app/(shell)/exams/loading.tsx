export default function Loading() {
  return <div className="space-y-5 pb-12" aria-busy="true" aria-label="성적관리 불러오는 중">
    <div className="bg-bg-soft h-20 animate-pulse rounded-xl" />
    <div className="bg-bg-soft h-12 animate-pulse rounded-xl" />
    <div className="bg-bg-soft h-52 animate-pulse rounded-xl" />
    <div className="bg-bg-soft h-96 animate-pulse rounded-xl" />
  </div>;
}
