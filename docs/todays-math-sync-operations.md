# 에이와 ↔ 오늘의수학 운영 적용 안내

2026-10-03. 사용자가 Vercel 환경변수를 직접 입력한다. 운영 주소는 **에이와 `https://www.aywa.co.kr` / 오늘의수학 `https://today.aywa.co.kr`**, 최초 사용 지점은 **침산**이다. `https://aywa.co.kr`은 www 주소로 이동하므로 서명 요청의 고정 주소에는 www를 사용한다. 사용자의 추가 요청에 따라 **토글 ON 시 지점 자동 생성**을 기본 경로로 한다. 기존 데모 지점에 침산을 임의 연결하지 않는다. 이 문서는 비밀 값이 없는 설정·배포 안내다. 실제 적용 상태는 [운영 적용 기록](todays-math-sync-production-2026-10-03.md)을 따른다.

## 이번에 제공하는 동작

- 에이와에서 오늘의수학이 활성화된 지점의 재직 수학 교사를 관리한다. 영어 전담·학생·보호 계정은 자동 교사 발급에서 제외한다.
- 공통 연결 설정을 한 번 넣으면 이후 지점은 에이와 토글만으로 생성된다. 원본 지점 UUID를 연결 ID와 대상 지점 UUID로 사용하며 이름으로 기존 지점을 합치지 않는다. OFF/ON은 같은 지점·원장·기록을 재사용한다. 이미 ON인 지점도 최초 cron에서 수집하므로 초기 적용 전에 활성 지점 목록을 확인한다.
- 신규 교사는 최소 권한으로 발급한다. 기존 이메일/이름 일치는 후보로만 등록한다. 본인 비밀번호 재확인 또는 권한 있는 운영자의 독립적인 소유권 확인 후 연결·지점 이동을 승인한다. 불일치·중복·정지 등은 기존 계정을 보존하고 보류한다.
- 기능 OFF·퇴사·자격 상실은 연결된 신규/기존 교사의 접근과 기존 세션을 정지한다. 사용자·학생·반·학습 기록을 삭제하지 않는다. 운영자가 별도로 정지한 계정은 ON/재입사로 자동 해제하지 않는다.
- 반 담당/교시 담당/대강과 기간, 반 이동, 학생 복수 수강·휴원·종료를 반영한다. 교사 이동으로 과거 자료의 지점이 바뀌지 않는다.
- 에이와 바로가기에서 일회용 코드와 PKCE로 오늘의수학 세션을 만든다. 이미 다른 계정에 로그인했으면 계정 전환을 확인한다.
- 에이와 **원생 → 학생 상세 → 오늘의수학** 탭에서 연결된 학생의 반·배정/완료 시험 수·최근 기록을 조회한다. 기능 OFF면 탭을 숨긴다. 오늘의수학 풀이 기록을 에이와 DB에 영속 저장하는 역방향 이벤트 연동은 추후 단계다.

## 입력할 환경변수

| 변수 | 에이와 | 오늘의수학 | 입력 원칙 |
| --- | --- | --- | --- |
| `EYWA_SYNC_AUTO_JSON` | 필수 | 필수 | **양쪽에 완전히 동일한 JSON 배열**. 서버 전용, 설치 전체의 자동 연결 신뢰 설정. |
| `EYWA_SYNC_BINDINGS_JSON` | 선택 | 선택 | 이미 운영 중인 명시적 매핑 예외용. 새 자동 연결에는 필요 없음. |
| `TODAYS_MATH_SYNC_WAKE_SECRET` | 필수 | 없음 | 즉시 전송을 깨우는 별도 키. DB wake 설정에도 같은 값. |
| `CRON_SECRET` | 기존 값 유지, 없으면 생성 | 이 기능 때문에 추가하지 않음 | 기존 에이와 cron도 사용하므로 임의 교체하지 않는다. |

기존 DB·Supabase·Auth 환경변수는 유지한다. 오늘의수학은 `trustHost`와 요청 주소를 사용하는 기존 운영 구성이므로, 없는 `AUTH_URL`/`NEXTAUTH_URL`을 새로 추가하지 않는다. 이미 설정된 경우에만 실제 운영 origin과의 일치를 확인한다. `AUTH_SECRET`을 변경하지 않는다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다. Production에만 넣고 Preview/Development에 운영 연결 설정을 복사하지 않는다.

`EYWA_SYNC_AUTO_JSON` 모양(아래는 **입력 예시이며 실제 비밀 값이 아님**):

```json
[
  {
    "sourceBaseUrl": "https://www.aywa.co.kr",
    "targetBaseUrl": "https://today.aywa.co.kr",
    "keyId": "initial-2026-10-03",
    "controlSecret": "서로 다른 무작위 비밀키 1",
    "webhookSecret": "서로 다른 무작위 비밀키 2",
    "ssoSecret": "서로 다른 무작위 비밀키 3"
  }
]
```

origin은 경로 없이 `https://도메인`만 사용한다. 자동 연결에서는 지점 ID를 입력하지 않는다. 지점 이름은 서명된 요청을 검증한 뒤 원본 제어 API에서 조회한다. 키는 각 32자 이상이며 아래 생성기는 각각 32바이트 난수로 만든다. 기존 `EYWA_SSO_SECRET`과 v2의 `ssoSecret`은 다른 설정이다.

에이와 체크아웃에서 기존 Node 24와 설치된 의존성만 사용해 파일을 준비할 수 있다:

```powershell
node scripts/todays-math-sync-setup.mjs --automatic --source-origin=https://www.aywa.co.kr --target-origin=https://today.aywa.co.kr
```

`--new-cron`은 별도의 선택 파일 `.env.eywa-cron-if-missing.local`을 만든다. **Vercel Production에 `CRON_SECRET`이 없을 때만** 이 값을 추가한다. 로컬 파일에 값이 없다는 사실만으로 운영 값이 없다고 판단하지 않는다. **이미 운영 중인 키 회전에는 이 초기 생성기를 그대로 쓰지 않는다.** 실행할 때마다 새 키가 생긴다. 예외적으로 기존 대상 지점을 연결하는 수동 모드는 `--automatic` 대신 `--tenant=UUID --target-branch=UUID [--binding=UUID]`를 사용하고 별도의 검토 절차를 거친다.

결과는 Git에서 제외되는 `work/todays-math-sync-<UUID>/`의 `.env.eywa.local`, `.env.todays-math.local`에 저장된다. 기존 파일은 덮어쓰지 않고 비밀 값은 터미널에 출력하지 않는다. Vercel 입력란에는 각 줄의 `=` 오른쪽 값만 넣는다. JSON 바깥에 따옴표를 추가하지 않는다. 생성 파일을 채팅·Git·일반 문서로 공유하지 않는다.

Vercel Project → Settings → Environment Variables에서 입력한 후 새 배포에 적용한다. 환경변수 변경은 기존 배포에 소급되지 않는다. [Vercel 환경변수 문서](https://vercel.com/docs/environment-variables)

## 적용 순서

1. 양쪽 변경을 통합하고 **관리 계정 차단 기능이 포함된 복구용 버전**을 확보한다. 대상 운영 DB를 확인하고 에이와의 현재 ON 지점 목록을 검토한다. 오늘의수학에 지점을 미리 만들 필요는 없다. 기존 계정·자료의 지점 귀속은 자동으로 합치지 않는다.
2. 에이와 DB에 `supabase/migrations/0337a_todays_math_sync_v2.sql`을 적용한다. 파일 자체가 트랜잭션을 포함한다. 관련 없는 미적용 alpha까지 일괄 실행하지 않는다. 적용 후 `select public.tm_sync_schema_health();`의 `healthy`와 모든 check가 true인지 확인한다. 이 단계는 binding을 만들거나 사용자를 활성화하지 않는다.
3. 오늘의수학에서는 `prisma migrate status`로 미적용 목록을 확인한 뒤 프로젝트 기존 절차로 `prisma/migrations/20261003085222_eywa_managed_sync/migration.sql`, `prisma/migrations/20261003103000_eywa_auto_branch/migration.sql` 순서로 적용한다. 운영에 `db push`를 사용하지 않는다. 새 테이블을 조회하는 코드는 **DB 적용 후** 배포한다.
4. 두 프로젝트의 Production 환경변수를 입력한다. 오늘의수학 수신 코드를 먼저 배포하고 에이와 발신 코드를 배포한다. 자동 연결 신뢰가 설정된 지점은 이전 동기화/SSO 경로로 우회하지 않는다. 기존 독립 계정의 일반 로그인은 기존 정책을 유지한다.
5. 첫 cron이 이미 ON인 지점을 자동 등록하고 대상에 전송한다. 이후 ON은 토글 저장과 같은 트랜잭션에서 연결 원장과 발신 사건을 만든다. 최초 작업을 기다리지 않고 실행하거나 확인하려면 아래를 사용한다. `<기존-서버-env>`는 기존 Supabase 서버 설정이며 두 파일 모두 비공개로 유지한다.

   ```powershell
   node --env-file=<기존-서버-env> --env-file=<생성한-에이와-env> scripts/todays-math-sync-admin.mjs automatic
   node --env-file=<기존-서버-env> --env-file=<생성한-에이와-env> scripts/todays-math-sync-admin.mjs automatic --apply
   node --env-file=<기존-서버-env> --env-file=<생성한-에이와-env> scripts/todays-math-sync-admin.mjs status
   ```

6. 오늘의수학은 서명·고정 주소를 검증하고 원본의 현재 ON·정상 상태와 지점 이름을 확인한 후 **지점과 연결을 한 번만 자동 생성**한다. `/admin/eywa-sync`에서 신규/확인 후보/충돌을 확인한다. 매핑 가능한 담당 교사가 전혀 없는 반은 임의 사용자에게 귀속하지 않고 검토 대상으로 남는다. 기존 동일 이메일 계정 승인은 별도다.
7. 에이와의 즉시 wake를 설정한다:

   ```powershell
   node --env-file=<기존-서버-env> --env-file=<생성한-에이와-env> scripts/todays-math-sync-admin.mjs wake
   node --env-file=<기존-서버-env> --env-file=<생성한-에이와-env> scripts/todays-math-sync-admin.mjs wake --apply
   ```

   `transportInstalled=true`인지 확인한다. false면 기존 Supabase DB에서 제공하는 `pg_net` 확장을 활성화한 뒤 재확인한다. DB의 `net.http_post`가 에이와의 `POST /api/cron/todays-math-sync`를 호출한다. Vercel Deployment Protection/방화벽이 있다면 해당 서버 경로의 정상 호출이 허용되어야 한다. 별도 서버 설치는 필요 없다. 실제 wake HTTP 왕복은 운영에서 확인해야 한다. [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
8. 침산 지점의 오늘의수학 토글 ON → 지점/교사/반/학생 연결을 확인한다. 자동 연결에는 별도의 지점 등록·활성화 버튼 조작이 필요 없다. OFF → 같은 계정의 접근 정지와 기록 보존, ON → 같은 지점 재사용을 확인한다. 운영자가 별도로 연결을 shadow/종료한 경우 자동 ON으로 풀지 않는다.

9. 에이와 cron `/api/cron/todays-math-sync`가 매분 실행되는지 확인한다. 즉시 wake와 cron은 같은 durable outbox를 사용하고, 중복 실행은 lease로 조정한다. 오늘의수학의 운영자 승인·재처리도 에이와에 새 변경이 없어도 cron이 수신 큐를 깨운다. 설정 연결이 3개를 넘으면 보조 sweep은 분마다 최대 3개를 순환하지만 신규 source 이벤트는 발신 즉시 처리 요청한다.
10. 양쪽 상태 화면에서 `received`와 `applied`를 구분한다. 충돌은 해당 항목만 보류하고 운영자가 해결한다. 기존 계정은 `/account/eywa-managed`에서 본인이 재확인하거나 `/admin/eywa-sync`에서 적격 운영자가 확인 근거를 남겨 승인한다. 최초 연결·반 이동의 효과가 실제 조회와 로그인에서 확인되어야 운영 완료다.

## 운영 확인 항목

- 신규 교사 1명: 관리자 권한 없이 생성, 에이와 바로가기 자동 로그인, 지정 반만 접근.
- 기존 이메일/이름 일치 계정: 승인 전 원래 계정·자료·비밀번호 유지, 승인 후 지점 전환과 이전 지점 자료 보존.
- 불일치 계정: 연결 보류 표시, 원래 계정 우선권 유지.
- OFF: 관리 교사들의 로그인·기존 세션·반 접근 거절, 계정과 자료는 보존. ON: 업무 자격이 유효한 경우만 회복, 수동 정지 보존, 예전 세션은 무효.
- 담당 변경·대강 만료·학생 반 이동: 옛 권한 종료와 새 관계 반영. 휴원 학생 조회와 쓰기 자격 구분.
- 학생 상세 탭: admin이 보는 동일 학생 연결의 시험 현황 표시. 대상 장애는 미연결/0건으로 숨기지 않고 조회 실패로 안내.
- webhook 중복/지연, 재처리, source/target 장애: 받은 사건 보존, 재시도 후 적용, 권한 확인 실패 시 만료된 접근 거절.
- 상태 화면: schema health 정상, 기록 공백 없음, 오래된 pending/received 및 conflict 원인 해소.

## 반영 시간과 비용

즉시 wake가 정상 동작하면 저장 직후 처리를 요청한다. 실제 반영 시간은 DB/함수 기동·전송·부하에 따라 달라지므로 **몇 초 이내라는 운영 SLA를 아직 보장하지 않는다**. wake가 실패해도 매분 cron이 재시도하고, 오류는 점진적으로 재시도한다. Vercel은 Pro의 분 단위 cron을 지원하지만 정확한 호출 시각을 보장하지 않는다. 별도 cron 상품을 추가하지 않으며 함수 사용량은 기존 과금·한도에 포함된다. 따라서 추가 유료 인프라 도입은 없지만 무조건 추가 요금 0원이라고 보장하지 않는다. [Vercel cron 사용량·가격](https://vercel.com/docs/cron-jobs/usage-and-pricing)

계정 접근 허용 확인은 최대 60초 lease이며 예정된 권한 종료가 더 이르면 그 시각까지만 유효하다. 만료 후 원본 확인에 실패하면 접근을 거절한다. 이미 브라우저에 내려받은 화면·파일까지 회수하는 의미는 아니다. 운영 적용 후 OFF/퇴사부터 새 요청 거절까지 실제 시간을 측정한다.

## 장애·중지·복구

- 환경변수 검증 오류는 기존 wake 인증으로 `POST /api/cron/todays-math-sync?diagnostics=1`을 호출해 확인한다. GET은 기존 cron 인증을 사용한다. 설정 유무·문법/스키마 오류 항목만 응답하며 원본 값과 비밀키는 포함하지 않고, 동기화도 실행하지 않는다. `invalid_json`이면 해당 Vercel Value의 전체 JSON 문법을 수정하고 재배포한다. 비밀값을 로그나 대화에 붙여 넣지 않는다.
- 즉시 업무 중지: 에이와 오늘의수학 OFF. 원본 자체가 장애라면 오늘의수학 운영 화면에서 **새 연결·쓰기 중지** 또는 **연결 종료**. 대상의 로컬 중지는 원본 응답을 기다리지 않고 관리 세션을 무효화한다. 삭제 작업은 아니다.
- OFF 이유와 수동 정지는 분리되어 있으므로 DB에서 `suspendedAt`만 임의로 지우지 않는다.
- 충돌을 해결한 뒤 오늘의수학 **재처리 요청**. 에이와 outbox 재요청은 `todays-math-sync-admin.mjs retry --event=UUID --apply`. source/target의 상태가 모두 수렴했는지 확인한다.
- schema health/history gap: 먼저 누락·변형된 트리거/RPC를 복구한다. `tm_sync_recover_binding(binding_id, expected_epoch)`는 현재 epoch를 확인하고 취소 세대를 올리며 새 보안 사건을 만든다. 임의로 세대를 0으로 낮추지 않는다.
- DB 백업 복원으로 epoch/세대가 되돌아가면 자동 재활성화하지 않는다. 원본을 shadow로 두고 원본의 **새 epoch 발급**, 취소 세대 증가, 기록 점검을 명시적인 복구 작업으로 수행한 다음 대상 운영 API의 `rebaseline`(새 epoch와 독립적인 복구 근거 필요)으로 다시 기준을 맞춘다. 기존 세션은 폐기하고 양쪽 재검증 후 활성화한다. 정상 장애 복구에 epoch를 바꾸지는 않는다.
- 롤백도 관리 계정 접근 차단 기능을 유지하는 버전으로만 한다. 관리 원장·generation·nonce 표를 삭제하거나 이전 v1 writer를 다시 켜서 우회하지 않는다.
- 키 교체는 같은 binding/지점/origin에 새 keyId를 추가하고 양쪽 수신 가능 키를 먼저 맞춘 뒤 송신 우선 키(배열 첫 항목)를 바꾼다. 양쪽 배포와 유효 요청 소진을 확인한 뒤 이전 키를 제거한다.

관련 문서: [승인된 계획](todays-math-sync-plan-2026-10-03.md), [공통 계약](todays-math-sync-implementation-contract.md), [원본 SQL 검증](todays-math-sync-source-sql-report.md). 오늘의수학 저장소의 `docs/eywa-managed-sync-receiver.md`와 실제 통합 검증 보고서도 함께 확인한다.
