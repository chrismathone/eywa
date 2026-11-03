// 워커에 넘기는 허용 목록 — ClassNote 자동 해제·명부 퇴원처리 스위치가 빠지면 PC에서 켜고 끌 길이 없다(2026-11-03 리뷰 B1).
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CREDENTIAL_KEYS}=require('../lib/supervisor.cjs');
test('ClassNote 퇴원처리·넓힌 자동 해제 스위치가 워커 허용 목록에 있다',()=>{
  for(const key of ['CLASSNOTE_OFFBOARD','CLASSNOTE_OFFBOARD_DAILY_LIMIT','CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA','CLASSNOTE_BOARD_AUTO_RELEASE'])
    assert.ok(CREDENTIAL_KEYS.includes(key),`${key} 없음`);
  assert.equal(new Set(CREDENTIAL_KEYS).size,CREDENTIAL_KEYS.length,'중복 키');
});
