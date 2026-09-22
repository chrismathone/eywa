// 학원 수칙 및 환불 규정 — ijw `TuitionInvoicePreview`에서 verbatim 이식. 수강료 안내문 하단 고정.
// 인쇄 포함(print:break-inside-avoid). 텍스트는 법정 문구라 임의 수정 금지.

const RULES: { text: string; sub: string }[] = [
  {
    text: "규칙적인 학습을 위해 지각, 결석을 허용하지 않으며 별도의 보강이 없습니다.",
    sub: "(단, 건강상의 문제나 증명가능한 공식행사는 예외 보강이 1회 이루어집니다.)",
  },
  {
    text: "선생님의 지시나 규정을 따르지 않거나 선생님께 무례한행동을 한 경우, 수업 분위기를 해칠 경우, 숙제를 해오지 않을경우 경고장을 받게 됩니다.",
    sub: "(3회 경고시 퇴원조치 됩니다)",
  },
  {
    text: "학생들의 수업 관리를 위해 수업 최소단위를 준수 합니다.",
    sub: "(이를 위해 시험기간 중에는 학원 일정에 따라 선 수업으로 진행될 수 있습니다)",
  },
];

const TD = "border-line border px-2.5 py-2 align-top";
// 머리도 왼쪽 — 본문이 전부 왼쪽 문장이라 가운데 머리는 값과 다른 자리에 섰다(원장 2026-09-18 *"견적서랑 지출결의서도
// 맞춰줘"*, 실측 반환금액 124px 어긋남).
const TH = "border-line bg-bg-soft text-foreground border px-2.5 py-2 text-left font-bold";

/**
 * @param showHouseRules 첫 학원(침산)의 '학원 수칙' 세 줄을 싣는가. 새 학원(일반판)은 끈다 — 남의 학원 규칙이다(2026-09-22 빈 지점 점검).
 *   아래 **환불 규정 표는 학원법 시행령 제18조 법정 문구**라 어느 학원에나 맞아 늘 싣는다.
 */
export function RefundPolicy({ showHouseRules = true }: { showHouseRules?: boolean } = {}) {
  // ⚠️ 통짜 break-inside-avoid 금지: 이 섹션은 한 페이지보다 높아 통째로 다음 장으로 밀리면 1페이지
  // 하단 공백/잘림 유발. 표 행은 전역 tr/td/th page-break-inside:avoid가 보호 → 행 단위로 끊긴다. 제목만 고아 방지.
  return (
    <section className="mt-6 print:mt-2">
      <h3 className="text-foreground mb-3 text-center text-base font-bold break-after-avoid print:mb-1.5">
        {showHouseRules ? "학원 수칙 및 환불 규정" : "환불 규정"}
      </h3>

      <div className="border-line bg-card rounded-md border p-4 print:rounded-none print:border-0 print:p-0">
        {/* 학원 수칙 — 침산 규칙이라 새 학원엔 싣지 않는다 */}
        {showHouseRules ? (
          <>
            <h4 className="text-foreground mb-2 text-sm font-bold">학원 수칙</h4>
            <ol className="text-text-dim mb-4 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
              {RULES.map((r) => (
                <li key={r.text}>
                  {r.text}
                  <br />
                  <span className="text-text-faint">{r.sub}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {/* 환불 규정 */}
        <h4 className="text-foreground mb-2 text-sm font-bold">환불 규정</h4>
        <table className="w-full border-collapse text-xs leading-snug">
          <thead>
            <tr>
              <th className={TH}>구분</th>
              <th className={TH} colSpan={2}>
                반환사유 발생일
              </th>
              <th className={TH}>반환금액</th>
            </tr>
          </thead>
          <tbody>
            {/* 제1호·제2호 */}
            <tr>
              <td className={TD}>제18조 제2항 제1호 및 제2호의 반환사유에 해당하는 경우</td>
              <td className={TD} colSpan={2}>
                교습을 할 수 없거나 교습 장소를 제공할 수 없게 된 날
              </td>
              <td className={TD}>이미 납부한 교습비등을 일할(日割) 계산한 금액</td>
            </tr>

            {/* 제3호 — 1개월 이내 (4행) + 1개월 초과 (2행) */}
            <tr>
              <td className={TD} rowSpan={6}>
                제18조 제2항 제3호의 반환사유에 해당하는 경우
              </td>
              <td className={TD} rowSpan={4}>
                교습기간이 1개월 이내인 경우
              </td>
              <td className={TD}>교습 시작 전</td>
              <td className={TD}>이미 납부한 교습비등의 전액</td>
            </tr>
            <tr>
              <td className={TD}>총 교습시간의 1/3 경과 전</td>
              <td className={TD}>이미 납부한 교습비등의 2/3에 해당하는 금액</td>
            </tr>
            <tr>
              <td className={TD}>총 교습시간의 1/2 경과 전</td>
              <td className={TD}>이미 납부한 교습비 등의 1/2에 해당하는 금액</td>
            </tr>
            <tr>
              <td className={TD}>총 교습시간의 1/2 경과 후</td>
              <td className={TD}>반환하지 않음</td>
            </tr>
            <tr>
              <td className={TD} rowSpan={2}>
                교습기간이 1개월을 초과하는 경우
              </td>
              <td className={TD}>교습 시작 전</td>
              <td className={TD}>이미 납부한 교습비등의 전액</td>
            </tr>
            <tr>
              <td className={TD}>교습 시작 후</td>
              <td className={TD}>
                반환사유가 발생한 해당 월의 반환 대상 교습비등(교습기간이 1개월 이내인 경우의 기준에 따라
                산출한 금액을 말한다)과 나머지 월의 교습비 등의 전액을 합산한 금액
              </td>
            </tr>
          </tbody>
        </table>

        {/* 각주 */}
        <ol className="text-text-dim mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed">
          <li>
            총 교습시간은 교습기간 중의 총 교습기간을 말하며, 반환금액의 산정은 반환사유가 발생한 날까지
            경과된 교습시간을 기준으로 한다.
          </li>
          <li>
            원격교습의 경우 반환금액은 교습내용을 실제 수강한 부분(인터넷으로 수강하거나 학습기기로 저장한
            것을 말한다)에 해당하는 금액을 뺀 금액으로 한다.
          </li>
        </ol>

        <p className="text-text-faint mt-3 text-right text-xs">
          * 본 영수증은 소득공제용(현금영수증)으로 사용하실 수 없습니다. 별도 요청 부탁드립니다.
        </p>
      </div>
    </section>
  );
}
