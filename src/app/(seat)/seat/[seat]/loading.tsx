export default function PublicSeatLoading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 px-3 py-4">
      <div className="bg-bg-soft h-4 w-24 animate-pulse rounded" />
      <div className="bg-bg-soft h-6 w-40 animate-pulse rounded" />
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-7 w-20 animate-pulse rounded-full" />
        ))}
      </div>
      <div className="bg-card shadow-card h-[46px] animate-pulse rounded-2xl" />
    </div>
  );
}
