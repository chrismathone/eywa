# 에이와 ↔ 오늘의수학 운영 적용 기록

사용자가 2026-10-03 운영 DB 변경과 연동 코드 배포를 승인했다. Vercel 환경변수는 사용자가 직접 입력하고 재배포했다. 기존 코드의 재배포만으로는 새 연동이 제공되지 않음을 양쪽 원격 main 및 운영 API 404로 확인했다.

## 고정 주소

- 에이와: `https://www.aywa.co.kr`. www 없는 주소는 HTTP 307로 이동한다. 양쪽 `EYWA_SYNC_AUTO_JSON`의 `sourceBaseUrl`과 DB wake 설정에 www 주소를 사용한다.
- 오늘의수학: `https://today.aywa.co.kr`.
- 오늘의수학의 기존 요청 주소 기반 인증을 유지한다. 없는 `AUTH_URL`/`NEXTAUTH_URL`을 추가하지 않는다.

## 에이와 DB

- 2026-10-03 20:44 KST: `0337a_todays_math_sync_v2.sql`을 운영 PostgreSQL에서 먼저 트랜잭션 내 검증 후 롤백했다. 동일 SQL의 재실행과 검사 통과 후 커밋했다.
- 줄바꿈 정규화 SHA256: `3d19ff5b2359d7cfe5d5b0817aaa6fa9ceaf634d5a72193c628589738ef0c98b`.
- `tm_sync_schema_health()` healthy=true, 트리거 20/20, 함수 11/11 통과.
- 공개·로그인 역할의 관리 RPC 실행은 차단되며 service_role 실행만 허용되는 것을 확인했다.
- 적용 직후 binding=0, 자동 연결 설정=false. 사용자 계정이나 라이선스를 변경하지 않았다.
- 현재 유효한 오늘의수학 라이선스는 인재원 침산 한 곳이다.
- 기존 Supabase에서 제공하는 pg_net 0.20.3을 활성화했다. `tm_sync_configure_wake`로 www 주소와 기존 생성 키를 등록하고 transportInstalled=true를 확인했다.
- 비공개 표 15개 전체 RLS 활성화, 관리 RPC 17개 전체 anon/authenticated 실행 금지를 확인했다.
- 운영 데이터의 자동 연결과 snapshot/page 검사를 하나의 트랜잭션 안에서 수행한 뒤 롤백했다. 침산의 자격 충족 교사 9명, 원본 직원 54명·반 109개·학생 324명·수강 948개·진도 4,434건이 계약 검증을 통과했다. 이는 원본 snapshot 수이며 실제 발급·연결 수가 아니다.

## 코드 및 실제 왕복 검증

에이와 연동 커밋 `bddea34a9745361d76c49815eb0913ff9af9cbd9`를 원격 main과 로컬 main에 병합했고 Vercel 운영 배포가 성공했다. 연동 테스트 5개 파일 44건, 별도 TypeScript 검사, Next.js 전체 빌드가 통과했다. 빌드는 운영 DB 자격 증명 없이 실행했으므로 기존 공개 브랜딩의 설정 부재 경고가 발생했다.

오늘의수학은 별도 운영 워크트리에서 기존 원격 main에 연동 변경만 통합한 `33ae39be443acda956a4f85bc8e591d943c22f2f`를 배포했다. 원래 main 작업 폴더의 미완료 영어 작업은 포함하거나 변경하지 않았다. 수신 측 집중 테스트 12개 파일 133건, 전체 빌드, 저장소 커밋·push 검사를 통과했다. 더 넓은 검사의 기존 `prerequisiteContext` 실패는 기존 원격에서도 재현되었고 이번 변경과 무관하다.

## 오늘의수학 DB

- 2026-10-03 20:53 KST: 다음 두 migration만 하나의 트랜잭션으로 적용하고 Prisma 이력을 함께 기록했다.
  - `20261003085222_eywa_managed_sync`: SHA256 `775153d00c4f002161387b1244ab00a2ba79e9372271b7c2f446c03c0874a95f`.
  - `20261003103000_eywa_auto_branch`: SHA256 `df977b3aaeb2e0e62ff251b9c792743df798ec842cf8557012708256fa15da35`.
- 기존 사용자 9명, 반 1개, 학생 1명, 영어 시험 1건의 수가 적용 전후 동일했다. 신규 연결 데이터는 아직 없다.
- 새 RLS 표 8개, 보호 트리거 4개, 안전한 함수 2개와 권한·인덱스·제약을 확인했다. backfill 및 인증 불일치 5개 항목은 모두 0이었다.
- 실제 운영 API의 오류 기록 UUID를 런타임 DB에서 확인해 운영 배포가 migration을 적용한 DB를 사용하는 것도 검증했다. 개인 데이터·오류 원문은 출력하지 않았다.

## 운영 검증 보류: 환경변수 JSON 문법

2026-10-03 21:28 KST 기준:

- 양쪽 새 API가 운영에서 응답한다. 에이와 control/wake는 설정 검증에서 `sync_configuration_invalid`로 중단되고, 수신 측은 일반 오류를 반환한다. 아직 실제 계정 생성·학생 동기화가 완료된 것은 아니다.
- 인증이 필요한 읽기 전용 진단을 추가한 `697479439f5e27a315443a772909280931524d39`를 main에 반영하고 배포했다. 관련 테스트 35건과 TypeScript 검사가 통과했다.
- 에이와의 인증된 `POST /api/cron/todays-math-sync?diagnostics=1` 결과는 `EYWA_SYNC_BINDINGS_JSON` 미설정·정상, `EYWA_SYNC_AUTO_JSON` 설정됨·`invalid_json`이었다. 설정 값이나 비밀키를 출력하지 않았다. 진단은 DB나 외부 API를 호출하지 않는다.
- 사용자에게 기존 비밀키를 유지한 JSON 배열만 있는 Value 파일로 양쪽 환경변수를 다시 저장·재배포하도록 안내했다. 파일은 Git에서 제외된 로컬 `work/todays-math-sync-d32598f4-dbd7-43de-a1b7-74ee379e1048/EYWA_SYNC_AUTO_JSON.value.txt`에 있고, main 작업 폴더에도 보존했다.
- 재배포 후 실제 자동 지점 생성, 연결/승인 보류 수, outbox 처리, SSO 시작, 학생 현황 API를 확인해야 한다. 이 확인이 끝나기 전에는 작업 워크트리 정리 완료 신호를 보내지 않는다.
