const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createWorkerLog,kstStamp,summarize}=require('../lib/worker-log.cjs');
test('local logs split at KST midnight and redact credentials while web summaries contain fixed codes only',()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/worker-log-')),events=[];let now=Date.parse('2026-10-08T14:59:59Z');
 const logs=createWorkerLog(root,{now:()=>now,secrets:['fixture-private-secret'],onSafeLog:e=>events.push(e),maxBytes:200});
 logs.append('makeedu','[2026-10-08T14:59:59Z] heartbeat 실패: fixture-private-secret 학생이름');
 now+=2000;const sink=logs.sink('makeedu'),utf=Buffer.from('──── students: import-students-list.cjs --apply\n상담 본문 이름 fixture-private-secret\n');sink.write(utf.subarray(0,7));sink.write(utf.subarray(7));sink.end();
 const yesterday=fs.readFileSync(path.join(root,'2026-10-08','makeedu.log'),'utf8'),today=fs.readFileSync(path.join(root,'2026-10-09','makeedu.log'),'utf8');
 assert.ok(yesterday.includes('23:59:59.000 +09:00'));assert.ok(today.includes('00:00:01.000 +09:00'));assert.ok(today.includes('──── students'));assert.ok(!today.includes('fixture-private-secret'));assert.ok(!yesterday.includes('T14:59'));
 assert.deepEqual(events,[{logCode:'status_failed',level:'error'},{logCode:'makeedu_students',level:'info'}]);assert.ok(!JSON.stringify(events).includes('학생이름'));
 logs.append('makeedu','──── students: import-students-list.cjs --apply');assert.equal(events.length,2);
 logs.append('makeedu','x'.repeat(300));logs.append('makeedu','next');assert.ok(fs.existsSync(path.join(root,'2026-10-09','makeedu-001.log')));
 assert.throws(()=>logs.append('../invalid','text'));
 assert.equal(kstStamp(Date.parse('2026-10-08T15:00:00Z')),'2026-10-09 00:00:00.000 +09:00');
});
test('unrecognized student content and arbitrary error bodies never become web logs',()=>{
 for(const line of ['학생 상담 내용 010-1111-2222','Bearer fixture-token','로그인 비밀번호: private','임의 제목 / SQL SELECT students'])assert.equal(summarize('makeedu',line),null);
 assert.deepEqual(summarize('makeedu','(실행 로그 기록 실패 — 동기화 결과와 무관) fetch failed'),{logCode:'result_failed',level:'error'});
});
