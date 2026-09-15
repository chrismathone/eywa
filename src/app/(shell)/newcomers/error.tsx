"use client";

export default function NewcomersError({ reset }: { reset: () => void }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700" role="alert">
    <h2 className="text-base font-semibold text-slate-900">신규생 관리 기록을 불러오지 못했습니다</h2>
    <p className="mt-2 text-sm">연결 상태를 확인한 뒤 다시 불러와 주세요.</p>
    <button type="button" onClick={reset} className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">다시 불러오기</button>
  </section>;
}
