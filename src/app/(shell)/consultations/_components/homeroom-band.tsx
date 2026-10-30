"use client";

import { useEffect, useState } from "react";
import { EmbedLink } from "@/components/embed-link";
import { loadHomeroomBand, type HomeroomBandData } from "@/features/consultations/server/homeroom-band-action";
import { homeroomRate } from "@/features/consultations/stats-recent";
import { DetailPopup } from "../../dashboard/_overview/detail-popup";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const mon = (ym: string) => `${Number(ym.slice(5))}월`;
const pctOf = (c: number, t: number) => (t > 0 ? Math.round((c / t) * 100) : null);

/**
 * 잠깐 기억 — 목록이 다시 그려질 때마다(필터·쪽·창 크기) 무거운 담임 현황을 다시 부르지 않는다(리뷰 2026-10-30).
 * 키 = 보는 사람(계정 + 보는 강사) — 다른 탭에서 계정이 바뀐 뒤 소프트 이동해도 남의 값을 안 보인다. 실패(null)는 기억하지 않는다.
 */
const TTL_MS = 2 * 60_000;
let cache: { key: string; at: number; data: HomeroomBandData } | null = null;
let inflight: { key: string; p: Promise<HomeroomBandData | null> } | null = null;
const fresh = (key: string) => (cache && cache.key === key && Date.now() - cache.at < TTL_MS ? cache.data : null);
function load(key: string): Promise<HomeroomBandData | null> {
  const hit = fresh(key);
  if (hit) return Promise.resolve(hit);
  if (inflight?.key !== key) {
    const p = loadHomeroomBand()
      .catch(() => null)
      .then((data) => {
        if (data) cache = { key, at: Date.now(), data };
        if (inflight?.p === p) inflight = null;
        return data;
      });
    inflight = { key, p };
  }
  return inflight.p;
}

/**
 * 요약 띠의 **담임 상담** 칸 — 이번 달(진행 중) 담임 본인이 상담한 학생 ÷ 상담 대상 학생 + [담임별].
 * 원장 2026-10-30 *"전체 건수는 숨기고 담임별 상담 건수 등 최근 추세에 대해서"* · 이름은 눌러야(2026-10-29 *"첫 화면에 이름 직접 뜨지 않게"*).
 * 띠에선 덜 찬 이번 달을 다 끝난 지난달과 나란히 견주지 않는다(월초에 급락으로 읽힌다 — 리뷰) — 지난달은 팝업 열로.
 * 불러오기 전·실패·담임 없음이면 칸이 없다(띠 높이는 그대로).
 */
export function HomeroomBand({ className, viewerKey }: { className: string; viewerKey: string }) {
  const [data, setData] = useState<HomeroomBandData | null>(null);
  useEffect(() => {
    let live = true;
    void load(viewerKey).then((d) => {
      if (live) setData(d);
    });
    return () => {
      live = false;
    };
  }, [viewerKey]);
  if (!data || data.rows.length === 0) return null;
  const { months, rows, teacherScoped } = data;
  const last = months.length - 1;
  const rate = homeroomRate(rows);
  const nowPct = (r: (typeof rows)[number]) => pctOf(r.months[last]!.counseled, r.months[last]!.target) ?? 101;
  // 이번 달 상담률 낮은 담임부터 — 챙길 사람이 위로.
  const sorted = [...rows].sort((a, b) => nowPct(a) - nowPct(b) || a.name.localeCompare(b.name, "ko"));
  const scopeText = teacherScoped ? "내 담임 반 합계" : "학원 합계";
  return (
    <li className={`${className} items-baseline gap-1 text-sm whitespace-nowrap`}>
      <span
        className="font-medium"
        title={`${mon(months[last]!)}(진행 중) 담임 본인이 상담한 학생 ÷ 담임 상담 대상 학생 · ${scopeText} · 목록 필터와 무관${rate.prev !== null ? ` · ${mon(months[0]!)} ${rate.prev}%(지금 명단 기준)` : ""}`}
      >
        {teacherScoped ? "내 담임 상담" : "담임 상담"} 이번 달
      </span>
      <span className="num text-foreground font-bold">{rate.now === null ? "—" : `${rate.now}%`}</span>
      <DetailPopup
        title={teacherScoped ? "내 담임 상담" : "담임별 상담"}
        label={teacherScoped ? "자세히" : `담임별 (${fmt(rows.length)}명)`}
        ariaLabel={teacherScoped ? "내 담임 상담 자세히 보기" : `담임별 상담 보기 (${fmt(rows.length)}명)`}
        trigger={<button type="button" className="text-primary ml-1 text-xs font-medium hover:underline" />}
      >
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs break-keep">
            칸 = 담임 본인이 상담한 학생 / 상담 대상 학생 · 상담률 · 담임 본인 상담 건수(같은 학생 여러 번 포함). 이번 달 상담률 낮은 담임부터. 지난달도
            지금 담임 명단 기준입니다. 이름을 누르면 그 담임의 학생별 상담 현황(통계 화면)으로 갑니다.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-line border-b text-xs">
                <th className="py-1.5 text-left font-medium">담임</th>
                {months.map((m, i) => (
                  <th key={m} className="py-1.5 text-right font-medium">
                    {mon(m)}
                    {i === last ? "(진행 중)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-line border-b last:border-0">
                  <td className="py-1.5">
                    {/* 담임 이름 → 통계 화면을 그 담임으로(지표·추이·담임별 표가 함께 걸린다 · 학생별 표는 줄을 눌러 펼친다). */}
                    <EmbedLink href={`/consultations/stats?who=${encodeURIComponent(r.id)}#homeroom`} className="text-primary hover:underline">
                      {r.name}
                    </EmbedLink>
                    {r.subjectText ? <span className="text-muted-foreground ml-1 text-xs">{r.subjectText}</span> : null}
                  </td>
                  {r.months.map((m) => {
                    const p = pctOf(m.counseled, m.target);
                    return (
                      <td key={m.ym} className="num py-1.5 text-right whitespace-nowrap">
                        <span className="font-semibold">
                          {fmt(m.counseled)}/{fmt(m.target)}
                        </span>
                        <span className="text-muted-foreground ml-1 text-xs">
                          {p === null ? "—" : `${p}%`} · {fmt(m.count)}건
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <EmbedLink href="/consultations/stats#homeroom" className="text-primary text-xs font-medium hover:underline">
            담임별 상담 현황 전체 보기(열 머리로 정렬 · 줄을 누르면 학생별) →
          </EmbedLink>
        </div>
      </DetailPopup>
    </li>
  );
}
