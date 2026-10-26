// 개인정보 검사기 자체 확인(합성 문장만) — node scripts/_oneoff/ai-credit-mvp/smoke-pii.mjs
import assert from "node:assert/strict";
import { maskPhones, piiHits, scanRecord } from "./lib/pii.mjs";

assert.deepEqual(piiHits("주민번호 080101-3123456 입니다"), ["주민번호"]);
assert.deepEqual(piiHits("등록번호 080101-3******"), ["주민번호"]);
assert.deepEqual(piiHits("카드 1234-5678-9012-3456"), ["카드번호"]);
assert.deepEqual(piiHits("환불은 국민 123456-01-234567 로"), ["계좌번호"]);
assert.deepEqual(piiHits("환불 계좌: 3333012345678"), ["계좌번호"]);
assert.deepEqual(piiHits("강사 급여 문제로"), ["급여"]);
assert.deepEqual(piiHits("이사 가서 2025-08-31부로 퇴원"), []); // 날짜는 계좌가 아니다
assert.deepEqual(piiHits("010-1234-5678로 연락"), []); // 전화는 금지 목록이 아니다(가린다)
assert.equal(maskPhones("어머님 010-1234-5678 / 01098765432"), "어머님 [전화번호] / [전화번호]");
assert.deepEqual(scanRecord({ a: "ok", b: ["x", "카드 1234 5678 9012 3456"] }), [{ field: "b[1]", kinds: ["카드번호"] }]);
console.log("개인정보 검사기 확인 통과");
