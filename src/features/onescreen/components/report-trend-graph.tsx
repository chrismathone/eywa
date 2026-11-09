import { Fragment } from "react";
import { hasTrend, type TrendPoint } from "../report-trend";

// 학부모 보고서 성적 추이 — **순수 SVG**(라이브러리 0). ClassNote 워커가 headless로 스크린샷하므로
// recharts(ResizeObserver) 불가 → edutrix ReportPaper의 PureSvgChart를 aywa 톤으로 이식(CLAUDE.md B5).
// 색은 인라인 hex(스크린샷 안정): 시험=primary #363c41, 과제=blue #2962ce. 격자/축은 회색.
// ⚠️ CSS 변수를 못 쓴다(워커 headless 렌더에 앱 스타일시트가 없다) — 그래서 여기만 hex를 적는다.
//    globals.css의 `--primary`/`--blue`를 바꾸면 **이 두 값도 함께** 고칠 것(v4에서 blue를 조였다).
// ⚠️ 이 그래프는 **학부모 문서**다(parent-report-card → 공유 링크 `/r/…`·인쇄·ClassNote 이미지) — 디자인 v5의
//    화면 글자 승격(14 바닥) 밖이라 눈금 11은 종이 서식 스케일이다. 강사뷰를 손볼 때 같이 키우지 말 것(18단계 리뷰).

const W = 660;
const H = 200;
const M = { top: 26, right: 16, bottom: 30, left: 40 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

/** 지표 한 개(시험 또는 과제) 미니 차트 — 면적+선+점, Y 0~100 고정. 유효점 <2면 호출부에서 안 그림. */
function TrendChart({
  points,
  metric,
  color,
}: {
  points: TrendPoint[];
  metric: "exam" | "homework";
  color: string;
}) {
  const n = points.length;
  const sx = (i: number) => M.left + (n > 1 ? (i / (n - 1)) * PW : PW / 2);
  const sy = (v: number) => M.top + PH - (v / 100) * PH;

  const pts = points.map((p, i) => ({ x: i, val: p[metric], date: p.date, isCurrent: p.isCurrent }));
  const valid = pts.filter((p): p is { x: number; val: number; date: string; isCurrent: boolean } => p.val !== null);
  if (valid.length === 0) return null;

  const line = valid.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.val).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(valid[valid.length - 1]!.x).toFixed(1)},${(M.top + PH).toFixed(1)} L${sx(
    valid[0]!.x,
  ).toFixed(1)},${(M.top + PH).toFixed(1)} Z`;
  const gradientId = `trend-${metric}`;

  // x축 라벨 솎아내기 — 점이 많으면 처음·끝·짝수 인덱스만(겹침 방지).
  const showLabel = (i: number) => n <= 6 || i === 0 || i === n - 1 || i % 2 === 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.28} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* 격자 (0/25/50/75/100) */}
      {[0, 25, 50, 75, 100].map((v) => (
        <line key={v} x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="#e5e7eb" strokeDasharray="3 3" />
      ))}
      {/* Y축 라벨 (0/50/100) */}
      {[0, 50, 100].map((v) => (
        <text key={v} x={M.left - 6} y={sy(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#94a3b8">
          {v}
        </text>
      ))}
      {/* X축 날짜 (MM-DD) */}
      {points.map((p, i) =>
        showLabel(i) ? (
          <text key={i} x={sx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="#94a3b8">
            {p.date?.slice(5)}
          </text>
        ) : null,
      )}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {valid.map((p, i) => (
        <Fragment key={i}>
          {p.isCurrent ? (
            <circle cx={sx(p.x)} cy={sy(p.val)} r={6} fill={color} stroke="#ffffff" strokeWidth={2} />
          ) : (
            <circle cx={sx(p.x)} cy={sy(p.val)} r={3} fill={color} />
          )}
          <text x={sx(p.x)} y={sy(p.val) - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill={color}>
            {p.val}
          </text>
        </Fragment>
      ))}
    </svg>
  );
}

/** 지표 한 개 카드(제목 + 차트). 유효점 <2면 null(섹션에서 자동 숨김). */
function MetricBlock({
  points,
  metric,
  color,
  title,
}: {
  points: TrendPoint[];
  metric: "exam" | "homework";
  color: string;
  title: string;
}) {
  if (!hasTrend(points, metric)) return null;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-bold" style={{ color }}>
        <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        {title}
      </h3>
      <TrendChart points={points} metric={metric} color={color} />
    </div>
  );
}

/**
 * 성적 추이 그래프 — 시험(초록)·과제(파랑) 각각 유효점 2개 이상일 때만 렌더. 둘 다 없으면 null(호출부에서 섹션째 숨김).
 * ParentReportCard 캡처 영역 안에서 렌더되어 /r·/print·ClassNote 이미지 공통으로 나온다.
 */
export function ReportTrendGraph({ points }: { points: TrendPoint[] }) {
  const showExam = hasTrend(points, "exam");
  const showHomework = hasTrend(points, "homework");
  if (!showExam && !showHomework) return null;
  return (
    <div className="flex flex-col gap-5">
      <MetricBlock points={points} metric="exam" color="#363c41" title="시험 점수 추이" />
      {/* 🔴 "과제 점수"가 아니라 "수행률" — 학부모가 50을 **점수**로 읽고 학생을 혼낸 사고(2026-08-03).
          축은 그대로 0~100이고 값의 뜻만 또렷해진다(= 지난 과제를 몇 % 해왔는가). */}
      <MetricBlock points={points} metric="homework" color="#2962ce" title="과제 수행률 추이" />
    </div>
  );
}
