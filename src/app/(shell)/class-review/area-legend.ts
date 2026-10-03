/** 영역 제목 맨 앞의 동그라미 숫자 하나(①–⑳, ㉑–㉟)와 그 뒤 공백. 저장값은 바꾸지 않는다. */
const LEADING_CIRCLED = /^(?:[\u2460-\u2473\u3251-\u325F])\s*/;

export function stripLeadingCircledNumber(title: string): string {
  return title.replace(LEADING_CIRCLED, "").trim();
}

/** 범례 한 칸. 제목이 이미 같은 번호로 시작하면 번호를 한 번 더 붙이지 않는다. */
export function areaLegendLabel(short: string, title: string, max = 0): string {
  const body = stripLeadingCircledNumber(title);
  const head = !body ? short : body.startsWith(short) ? body : `${short} ${body}`;
  return max ? `${head}(${max}점)` : head;
}
