/**
 * 전화번호 표기 = `000-0000-0000`처럼 **하이픈을 넣어** 보인다(원장 2026-11-12 *"연락처, 전화번호와 같은것들은
 * 000-0000-0000 식으로 하이픈 필수 포함해서 노출"*). 화면·인쇄·엑셀·저장 전 다듬기가 이 함수 하나를 쓴다.
 *
 * - 숫자와 구분 글자(공백·하이픈·점·괄호, 맨 앞 `+82`)만 있을 때만 고친다 — `01058782882`·`010.5878.2882`·`010 5878 2882` → `010-5878-2882`.
 * - 모양을 모르는 길이, 다른 글자가 섞인 값(이름·메모·번호 둘)은 **그대로**(양끝 공백만 뗀다) — 없는 번호를 만들지 않는다.
 * - 빈 값은 null — 호출부가 `?? "—"` 같은 자리 표시를 고른다.
 *
 * 순수 모듈(클라·서버 공용 — `server-only` 금지, [[#61]]).
 */
export function phoneLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!/^\+?[\d\s\-.()]+$/.test(s)) return s;
  let d = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    if (!d.startsWith("82")) return s; // 국외 번호는 손대지 않는다
    d = "0" + d.slice(2);
  }
  if (d.length === 10 && d.startsWith("10")) d = "0" + d; // 앞자리 0이 빠진 휴대폰(1058782882)
  return hyphenate(d) ?? s;
}

function hyphenate(d: string): string | null {
  if (/^02\d{7,8}$/.test(d)) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  if (/^050\d\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}`; // 0505-1234-5678 안심번호
  if (/^0[1-9]\d\d{7,8}$/.test(d)) return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 1588-1234 대표번호
  return null;
}
