# 승인된 동기화의 구현 계약

**후속 사용자 지시:** [운영 확인 후 확정 정책](todays-math-sync-policy-update-2026-10-03.md)을 우선 적용한다. 이메일이 유일하게 일치하는 기존 교사는 이름 비교나 소유권 승인 없이 자동 연결·지점 이전하며 ID·비밀번호·기록을 유지한다. 해당 교사 소유의 이전 가능한 반·학생도 함께 이전한다. 학생 로그인 계정은 동기화로 생성하지 않고 지점 관리자 이상만 명시적으로 발급한다. 계정명 옆 연결/미연결 고리와 지점/사유 안내를 제공한다. 다른 신원 점유·보호 계정·수동 정지는 계속 보호한다.

2026-10-03. `todays-math-sync-plan-2026-10-03.md` 승인 이후 구현자 공통 계약. 변경은 조정자에게 알린 뒤 양쪽에 동시에 반영한다. 이 문서와 TypeScript 계약은 제품 동작의 명세이며 비밀 값은 담지 않는다.

사용자의 후속 지시로 자동 지점 생성이 추가되었다. 기본 설치는 `EYWA_SYNC_AUTO_JSON: {sourceBaseUrl,targetBaseUrl,keyId,controlSecret,webhookSecret,ssoSecret}[]`를 양쪽에 동일하게 설정한다. 원본 지점 UUID를 binding/targetBranch UUID로 사용하며 명시적 기존 매핑은 우선한다. 최초 cron이 ON인 지점을 등록하고 이후 토글 ON은 같은 DB 트랜잭션에서 연결/outbox를 만든다. 원본의 새 연결만 shadow 생성 후 active로 승격하며 이미 존재하는 shadow/종료는 자동 해제하지 않는다. 대상은 HMAC·고정 origin을 검증한 뒤 최신 원본 control의 ON/active/healthy와 `tenantName`을 확인하여 새 지점/연결을 원자적으로 만든다. 같은 이름의 기존 지점은 병합하지 않는다. 동시 요청은 멱등 처리한다. `tenantName`은 삭제된 원본 지점에서는 null이며 OFF 처리가 우선한다. 구체적 운영 순서는 `todays-math-sync-operations.md`를 따른다.

## 작업 소유

- 조정자: 에이와 TypeScript 계약·서명·API·SSO·발신·운영 화면·통합 검증.
- 원본 DB 작업자: 에이와의 추가 SQL/격리 SQL 검증, outbox·제어·관계 export·SSO 코드 저장 RPC. 앱 파일 변경은 조정자에게 요청.
- 수신 인증 작업자: 오늘의수학 격리 작업 공간의 schema/migration·binding/inbox·계정 자격·자동 발급/매칭 승인·SSO·운영 화면. 모든 schema 변경의 단일 소유자.
- 수신 관계 작업자: 같은 수신 작업 공간에서 반/학생/시험 관계 접근·기존 writer 차단·자동 초안 범위 보호와 관련 API/테스트. schema 변경은 수신 인증 작업자에게 요청. 인증 파일은 수정하지 않음.

## 전송

프로토콜 `schemaVersion: 2`, issuer `aywa`, audience `todays-math`. UUID는 canonical 소문자 UUID. 모든 revision/generation은 10진수 문자열(0 포함)로 전송하고 BigInt 비교한다. timestamp는 ISO UTC, 수업 날짜는 YYYY-MM-DD(KST). 비밀키는 서버 전용이며 trim 후 32자 이상. mode는 `shadow|active`, 최초 binding은 shadow다.

서버 설정 `EYWA_SYNC_BINDINGS_JSON`: `{ bindingId, tenantId, targetBranchId, sourceBaseUrl, targetBaseUrl, keyId, controlSecret, webhookSecret, ssoSecret }[]`. 양쪽 같은 binding 목록; DB binding의 대상/소속과 일치해야 한다. sourceBaseUrl·targetBaseUrl은 고정 HTTPS origin(격리 시험의 localhost만 HTTP). URL을 요청 payload로 임의 지정하지 않는다. 키 회전은 배열의 같은 binding에 다른 keyId를 허용하되 활성 전송 키는 첫 항목, 수신은 명시된 키만 인정. preview와 production의 설정은 분리한다.

요청 헤더: `x-eywa-binding`, `x-eywa-key-id`, `x-eywa-timestamp`(Unix seconds), `x-eywa-nonce`(UUID), `x-eywa-signature`(hex HMAC-SHA256). 서명 원문은 줄바꿈으로 이은 `v2`, 대문자 HTTP method, pathname + 원래 query string, bindingId, keyId, timestamp, nonce, hex SHA256(raw body). 검증 창 60초; 고정 길이 비교; body 최대 2 MiB. 비밀 누락은 거부한다. 원본·대상 RPC의 변경 요청은 nonce를 DB에 저장해 재사용을 차단하고 webhook은 eventId/bodyHash로 멱등 처리한다. 조회의 nonce는 서명에 포함하되 조회 자체에 부수효과를 두지 않는다.

## HTTP 경로

- source `POST /api/integrations/todays-math/v2/control` body `{bindingId, userId?: UUID}` → Control. controlSecret 사용. 명시 OFF는 200/enabled=false, 오류는 5xx. OFF 때도 응답.
- source `POST /api/integrations/todays-math/v2/snapshots` body `{bindingId}` → Manifest. controlSecret. frozen snapshot 생성이므로 nonce 소비 필수.
- source `GET /api/integrations/todays-math/v2/snapshots/{snapshotId}?bindingId=...&kind=...&page=0` → Page. controlSecret. snapshot은 15분 유효하며 실제 삭제는 이후 청소.
- target `POST /api/integrations/eywa/v2/events` → durable inbox 후 `{eventId,status:received|applied|conflict|superseded}`. webhookSecret.
- target `POST /api/integrations/eywa/v2/process` body `{bindingId,limit?:number}` → 저장된 inbox 재개; webhookSecret. source cron이 수신자 작업도 깨움.
- target `GET /api/integrations/eywa/v2/events/{eventId}?bindingId=...` → 적용 상태. webhookSecret.
- target `GET /api/integrations/eywa/v2/students/{sourceStudentId}?bindingId=...` → `{bindingId,sourceStudentId,linked,mode,classes:[{sourceClassId,name,active}],tests:{assigned,completed},lastActivityAt}`. webhookSecret, 지점과 학생 ID 고정. 에이와 원생 상세의 오늘의수학 탭에서 사용. 조회 실패는 오류로 구분하며 풀이 기록의 역방향 영속 저장은 추후 범위.
- source `GET /api/connected-apps/todays-math/authorize?bindingId=...&state=...&code_challenge=...` → source 로그인 세션 검사 후 고정 target `/api/sso/eywa/v2/callback?code=...&state=...&bindingId=...`로 이동.
- source `POST /api/integrations/todays-math/v2/token` body `{bindingId,code,state,codeVerifier}` → `{assertion:string}`. ssoSecret. code와 nonce 원자 소비.
- target 시작 주소 `/api/sso/eywa/v2/start?bindingId=...`, state/PKCE cookie 생성 후 source authorize로 이동. 최종 세션은 기존 Auth.js 흐름과 연결하되 관리 원장·현재 자격·1회 jti를 필수 검사.
- source cron `/api/cron/todays-math-sync`: 기존 CRON_SECRET 검사, 1분. 독립적인 동기화 dispatcher. pg_net wake는 이 source dispatcher를 호출하되 별도 서버 확인 사용.

## JSON 모양

Control: `{schemaVersion:2,bindingId,tenantId,targetBranchId,sourceEpoch,securityRevision,tenantRevocationGeneration,enabled,mode,validatedAt,nextEffectiveAt:string|null,healthy:boolean,users:ControlUser[]}`. 특정 userId면 한 명 또는 삭제된 신원을 나타내는 0명. users 전체는 초기 동기화에 사용.

ControlUser: `{id,email,name,status,role,subjects:string[],eligible:boolean,blockReasons:string[],accountRevocationGeneration,classListRevision,classes:{id,permissionRevision,capabilities:string[],validUntil:string|null}[]}`. 계정 자격은 active 수학/겸임 교사이며 ASSIGNABLE_TEACHER_ROLES 재사용. 교사 판정과 메뉴 판정을 섞지 않는다(예외 2026-11-05: source authorize의 **코드 발급만** aywa '연결 앱 권한'(`app_todays_math`)도 본다 — 자격 확인 뒤, 꺼진 사람은 코드 없이 `/login?eywa=not-linked`. ControlUser 자격·명단 동기화는 이 권한과 무관). 플랫폼 보호 계정은 자동 연결 제외. 삭제된 사용자는 생략하되 영속 tombstone과 계정 generation은 유지.

capabilities의 허용 값은 `class:read`, `student:read`, `test:read`, `test:write`, `progress:read`, `progress:write`, `student:account`. delegate는 네 가지 `:read`만 발급한다. 지점 ID는 대상 서비스의 문자열 ID, membership ID는 UUID 또는 안정된 문자열 ID를 허용한다.

Event: `{schemaVersion:2,eventId,bindingId,tenantId,sourceEpoch,securityRevision,tenantRevocationGeneration,occurredAt,kind:'security'|'content'|'reconcile',entityType,entityId:string|null}`. 최신 상태로 합쳐도 취소 generation은 감소하지 않는다.

Manifest: `{schemaVersion:2,snapshotId,bindingId,tenantId,targetBranchId,sourceEpoch,securityRevision,contentGeneration,generatedAt,expiresAt,complete:true,control:Control,collections:{[kind]:{total:number,pages:{page:number,count:number,sha256:string}[]}}}`. collections는 staff/classes/memberships/students/enrollments/progress 6개 모두 필수. 정상 0건은 total=0/pages=[]. PostgreSQL의 JSON을 정확히 해시하기 위해 Page는 `{snapshotId,bindingId,kind,page,json:string,sha256:string}`. json은 동결된 행 배열 문자열 그대로이며 소비자는 UTF8 hash 검증 후 JSON.parse한다. 이로써 서로 다른 JSON serializer 공백 차이를 피한다.

- staff: ControlUser 동일.
- classes: `{id,name,subject,grade:string|null,active:boolean,closedAt:string|null,teacherId:string|null,permissionRevision}`.
- memberships: `{id,classId,userId,role:'homeroom'|'slot'|'delegate',startsOn:string|null,endsOn:string|null,revokedAt:string|null,capabilities:string[]}`. 대강 양끝 포함. homeroom/slot/delegate 권한은 독립; delegate 기본 read만.
- students: `{id,name,grade:string|null,school:string|null,status,isTest:boolean,phoneLast4?:string|null}`. 학생별 단일 identity, 과거 데이터 보존. 연락처는 끝 4자리만 전달하며 학생 전화 우선·보호자 전화 대체, 누락 시 null이다. 이전 snapshot의 필드 생략을 허용하고 학생 계정 발급은 현재 수강 자격 및 관리자의 명시적 실행을 별도로 검사한다.
- enrollments: `{id,studentId,classId,startsOn:string,endsOn:string|null,onHold:boolean,isTransferred:boolean,attendanceDays:string[]}`. 예정/종료/휴원 포함; 판정은 기존 eligibility 함수와 동일.
- progress: `{id,studentId,classId:string|null,makeupClassId:string|null,reportDate:string,createdAt:string,progress:string}`. 이름으로 학생 연결 금지. 전역 삭제 금지; null class 귀속이 애매하면 보류.

SSO assertion 형식 `v2.<base64url JSON>.<base64url HMAC-SHA256(ssoSecret, v2.payload)>`; payload `{iss:'aywa',aud:'todays-math',bindingId,sourceEpoch,sub,tenantId,email,name,securityRevision,tenantRevocationGeneration,accountRevocationGeneration,iat,exp,jti}`. 토큰은 서버 교환에서만 반환. 발급 후 60초, jti DB 1회 소비. HTTP 서명 keyId와 binding으로 SSO 키 선택.

## 원본 저장/RPC

원본 DB 작업자가 아래 RPC를 구현한다. snake_case 매개변수, public RPC는 service_role만 EXECUTE, private 내부 상태는 RLS/권한 제한. 원본 public table의 업무 컬럼을 변경/삭제하지 않는다.

- `tm_sync_control(p_binding_id uuid,p_user_id uuid default null)` → Control JSON. current authoritative read, expires_at·Auth ban·날짜 경계·필수 trigger 상태 검사 포함.
- `tm_sync_create_snapshot(p_binding_id uuid)` → Manifest JSON, 같은 읽기 스냅샷에 데이터+revision 고정. frozen pages를 DB에 저장. export만 contentGeneration 직렬화.
- `tm_sync_snapshot_page(p_binding_id uuid,p_snapshot_id uuid,p_kind text,p_page integer)` → Page JSON.
- `tm_sync_claim_events(p_limit integer)` → event 행 배열 `{event:Event,leaseToken,attempts}`; SKIP LOCKED/lease fencing.
- `tm_sync_finish_event(p_event_id uuid,p_lease_token uuid,p_status text,p_error text default null)` → 성공/재시도/충돌/적용 구분, lease 검사. 원문 PII 기록 금지.
- `tm_sync_consume_nonce(p_binding_id uuid,p_nonce uuid,p_expires_at timestamptz)` → boolean(insert unique).
- `tm_sync_issue_code(p_binding_id uuid,p_user_id uuid,p_code_hash text,p_state_hash text,p_challenge text)` → boolean; 60초 고정, 현재 자격 검사.
- `tm_sync_redeem_code(p_binding_id uuid,p_code_hash text,p_state_hash text,p_challenge text)` → `{control:Control,user:ControlUser,jti:string,issuedAt:string,expiresAt:string}` 또는 null; lock+consume+현재 자격 재검사. verifier→S256 challenge는 API가 계산.
- 실제 token HTTP 경로는 `tm_sync_exchange_code`를 사용한다. 위 redeem 인수에 `p_nonce uuid,p_expires_at timestamptz`를 더해 nonce와 code를 **한 DB 트랜잭션**에서 소비한다.
- `tm_sync_reconcile()` → dirty 콘텐츠 대조/효력일 wake/보존 기간 cleanup, 기존 보안 세대 감소 없음.

운영 RPC: `tm_sync_configure_binding(p_binding_id,p_tenant_id,p_target_branch_id,p_mode='shadow',p_apply=false)`, `tm_sync_status(p_binding_id=null)`, `tm_sync_configure_wake(p_source_origin,p_wake_secret,p_apply=false)`, `tm_sync_retry_event(p_event_id)`. 설정은 기본 미리보기이며 명시 적용만 변경한다. 즉시 wake는 `pg_net`으로 원본 dispatcher의 고정 경로를 POST하고, 비밀/업무 데이터를 외부 목적지로 보내지 않는다. wake 실패와 필수 outbox 기록 실패는 별개로 취급한다.

binding 등록·mode 변경은 운영자 명시 작업이며 고정 대상/소속 검증, 최초 shadow. worker는 안전한 구성 스크립트와 미리보기/상태 조회 수단을 제공하되 실제 DB/binding/계정을 이 단계에서 바꾸지 않는다. coordinator가 검증 후 운영 적용을 담당한다.

## 수신 관계 작업자용 모델 책임

수신 schema 단일 소유자는 인증 작업자다. 최소 모델 EywaBinding(원본/대상 지점·epoch·mode·제어 상태), EywaManagedAccount(현재 user/sourceUUID 유일 + 이력·승인·blockReasons·lease), EywaInbox, EywaSsoUse, ClassMembership, StudentEnrollment. Class에 안정된 branchId와 eywaBindingId, Student에 source 지점 문맥, 관계별 기간/role/capabilities, User.manualSuspendedAt와 연동 전용 인증 출처를 추가한다. 정확한 Prisma 필드명은 두 수신 작업자가 먼저 합의해 coordinator에게 보고한다. 오늘의수학 수신자가 완전한 Manifest 검증 후에만 관계 누락을 종료하며 학생·반·사용자는 삭제하지 않는다.

기존 runSync 자동·수동·직결은 새 binding에 쓰지 못하게 fence. 자동 초안은 기존 2반 allowlist를 직접 검사한 뒤에만 실행. 플랫폼 복구 계정은 관리 교사로 편입 금지. 승인 대기·거절·삭제·정지·다른 신원 충돌은 자동 해제/병합 금지. 직접 로그인과 세션, 서버/API 모두 관리 원장 자격을 확인. 계정 lease는 요청 시작/원본 확인 시각 중 이른 값 +60초, 만료 시 원본 확인 실패하면 거절. 반 권한 revision은 로그인 취소 세대와 분리.

## 완료 증거

신규/기존/충돌/퇴사/OFF-ON/대강/반 이동/복수 수강/미래 날짜/nonce 재사용/서명 위조/순서 역전/부분 snapshot/lease 만료를 의미 있는 테스트로 확인한다. SQL은 격리된 실제 Postgres 계열에서 트리거·동시성·rollback을 검증한다. 라이브 DB/개인 명단/비밀을 출력하지 않는다. 운영 적용 전 통합 fixture, typecheck, targeted tests, build 및 양쪽 배포 경로 점검. 부분 구현을 완료라고 부르지 않는다.
