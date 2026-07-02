// 수강료 안내문 — ijw `TuitionInvoicePreview` 문서부 이식. 계산기 우측 라이브 미리보기 + 인쇄.
// 순수 표시 컴포넌트(훅 없음 → 클라이언트 트리에서 사용 가능). 계산은 quote-calc 순수함수.
import { splitCoursesByMonth, quoteTotal } from "@/features/billing/quote-calc";
import type { QuoteStudent, QuoteCourse, QuoteExtra, QuoteDiscount } from "@/features/billing/quote-calc";
import { RefundPolicy } from "./refund-policy";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(Math.round(n))}원`;

const CELL = "border-line border px-2 py-1.5 text-[12px]";
const HEAD = "border-line bg-gold/15 text-foreground border px-2 py-1.5 text-[12px] font-bold text-center";

export function QuoteDocument({
  academyName,
  logoSrc,
  showLogo = true,
  showName = true,
  student,
  courses,
  extras,
  discounts,
  holidays,
  createdLabel,
}: {
  academyName: string;
  logoSrc?: string | null;
  /** 헤더에 로고 이미지 표시 여부(로고에 학원명 워드마크가 들어간 경우 중복 방지용 토글). */
  showLogo?: boolean;
  /** 헤더에 학원명 텍스트 표시 여부. */
  showName?: boolean;
  student: QuoteStudent;
  courses: QuoteCourse[];
  extras: QuoteExtra[];
  discounts: QuoteDiscount[];
  holidays: string[];
  createdLabel: string;
}) {
  const lines = splitCoursesByMonth(courses, student.startDate, student.endDate, holidays);
  const totals = quoteTotal(courses, extras, discounts);
  const hasExtras = extras.length > 0 || discounts.length > 0;

  return (
    <div className="quote-doc print-portrait bg-card text-foreground mx-auto w-full max-w-[760px] space-y-5 p-6 print:max-w-none print:space-y-2 print:p-0">
      {/* 헤더 — 로고/학원명은 토글(로고 워드마크에 학원명이 있으면 하나만 켜서 중복 방지). */}
      <header className="flex flex-col items-center gap-2">
        {showLogo || showName ? (
          <div className="text-primary inline-flex items-center gap-2 text-xl font-extrabold tracking-tight">
            {showLogo ? (
              logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element -- 학원 로고(GCS/외부 이미지), 인쇄 문서라 next/image 최적화 불필요
                <img src={logoSrc} alt={academyName} className="h-8 w-auto object-contain" />
              ) : (
                <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-sm text-sm">
                  {academyName.slice(0, 1)}
                </span>
              )
            ) : null}
            {showName ? academyName : null}
          </div>
        ) : null}
        <h2 className="text-foreground text-2xl font-black tracking-[0.3em]">수강료 안내문</h2>
      </header>

      {/* 학생 정보 */}
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <th className={`${HEAD} w-[16%]`}>학생 이름</th>
            <td className={`${CELL} w-[18%]`}>{student.name || "-"}</td>
            <th className={`${HEAD} w-[16%]`}>학교/학년</th>
            <td className={`${CELL} w-[18%]`}>{[student.school, student.grade].filter(Boolean).join(" ") || "-"}</td>
            <th className={`${HEAD} w-[16%]`}>작성일</th>
            <td className={`${CELL} w-[16%]`}>{createdLabel}</td>
          </tr>
          <tr>
            <th className={HEAD}>수강 기간</th>
            <td className={CELL} colSpan={3}>
              {student.startDate || "____.__.__"} ~ {student.endDate || "____.__.__"}
            </td>
            <th className={HEAD}>상담자</th>
            <td className={CELL}>{student.consultant || "-"}</td>
          </tr>
        </tbody>
      </table>

      {/* 과목 표 */}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${HEAD} w-[14%]`}>과목</th>
            <th className={`${HEAD} w-[30%]`}>반</th>
            <th className={`${HEAD} w-[14%]`}>요일</th>
            <th className={`${HEAD} w-[10%]`}>시수</th>
            <th className={`${HEAD} w-[16%]`}>금액</th>
            <th className={`${HEAD} w-[16%]`}>기타</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td className={`${CELL} text-text-faint text-center`} colSpan={6}>
                수강 과목을 추가하세요
              </td>
            </tr>
          ) : (
            lines.map((l, i) =>
              l.isSubtotal ? (
                <tr key={i} className="bg-bg-soft font-bold">
                  <td className={CELL} />
                  <td className={CELL}>{l.name} 소계</td>
                  <td className={CELL} />
                  <td className={`${CELL} text-center`}>{l.sessions}회</td>
                  <td className={`${CELL} num text-right`}>{won(l.price)}</td>
                  <td className={CELL} />
                </tr>
              ) : (
                <tr key={i}>
                  <td className={CELL}>{[l.month, l.category].filter(Boolean).join(" ")}</td>
                  <td className={CELL}>{l.name}</td>
                  <td className={`${CELL} text-center`}>{l.days}</td>
                  <td className={`${CELL} text-center`}>{l.sessions}회</td>
                  <td className={`${CELL} num text-right`}>{won(l.price)}</td>
                  <td className={`${CELL} text-text-dim text-[11px]`}>{l.note}</td>
                </tr>
              ),
            )
          )}
        </tbody>
      </table>

      {/* 교재/기타 + 할인 */}
      {hasExtras ? (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${HEAD} w-[18%]`}>구분</th>
              <th className={`${HEAD} w-[50%]`}>상세내용</th>
              <th className={`${HEAD} w-[16%]`}>금액</th>
              <th className={`${HEAD} w-[16%]`}>기타</th>
            </tr>
          </thead>
          <tbody>
            {extras.map((e) => (
              <tr key={e.uid}>
                <td className={`${CELL} text-center`}>교재/기타</td>
                <td className={CELL}>{e.name}</td>
                <td className={`${CELL} num text-right`}>{won(e.price)}</td>
                <td className={`${CELL} text-text-dim text-[11px]`}>{e.note}</td>
              </tr>
            ))}
            {discounts.map((d) => (
              <tr key={d.uid}>
                <td className={`${CELL} text-primary text-center font-bold`}>할인</td>
                <td className={CELL}>{d.name}</td>
                <td className={`${CELL} text-primary num text-right font-bold`}>-{won(d.amount)}</td>
                <td className={CELL} />
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {/* 최종 납부 금액 */}
      <div className="flex justify-end">
        <div className="border-line flex items-stretch overflow-hidden rounded-md border">
          <span className="bg-foreground/5 text-foreground flex items-center px-4 py-2 text-sm font-bold">
            최종 납부 금액
          </span>
          <span className="bg-gold text-ink num flex items-center px-5 py-2 text-lg font-black">
            {won(totals.total)}
          </span>
        </div>
      </div>

      <RefundPolicy />
    </div>
  );
}
