"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./presentation";
import { linkReviewedReferral, searchReviewedReferrers } from "../server/referral-actions";
export function ReferralLink({ consultationId, options }: { consultationId: string; options: { id: string; label: string }[] }) {
  const [id, setId] = useState(""), [reason, setReason] = useState(""), [message, setMessage] = useState(""), [done, setDone] = useState(false), [busy, start] = useTransition();
  const [search, setSearch] = useState(""), [found, setFound] = useState(options);
  const router = useRouter();
  return <div className="space-y-2">{!done && <><div className="flex flex-wrap gap-2">
    <input aria-label="소개자 이름 검색" placeholder="퇴원생 포함 이름 검색" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={40} className={fieldClass} />
    <Button size="sm" variant="outline" disabled={busy || search.trim().length < 2} onClick={() => start(async () => { const r = await searchReviewedReferrers(search); if (r.options) { setFound(r.options); setId(""); } setMessage(r.error ?? (r.options?.length ? "후보의 학교·학년을 확인해 주세요. 최대 30명을 표시합니다." : "일치하는 원생이 없습니다.")); })}>원생 찾기</Button>
  </div><div className="flex flex-wrap gap-2"><select aria-label="확인한 소개자" value={id} onChange={(e) => setId(e.target.value)} className={`${fieldClass} max-w-full`}><option value="">소개자 직접 선택</option>{found.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
    <input aria-label="소개 연결 확인 근거" placeholder="직접 확인한 근거" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={`${fieldClass} min-w-48 flex-1`} />
    <Button size="sm" disabled={busy || !id || reason.trim().length < 2} onClick={() => start(async () => { const r = await linkReviewedReferral({ consultationId, studentId: id, reason }); setMessage(r.error ?? r.message ?? ""); if (r.ok) { setDone(true); router.refresh(); } })}>{busy ? "연결 중…" : "확인한 소개자 연결"}</Button></div></>}<p role="status">{message}</p></div>;
}
