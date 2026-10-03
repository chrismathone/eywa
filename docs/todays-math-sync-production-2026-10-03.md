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

진행 중. 에이와 최신 원격 main을 통합했고 연동 테스트 5개 파일 44건, 별도 TypeScript 검사, Next.js 전체 빌드가 통과했다. 빌드는 운영 DB 자격 증명 없이 실행했으므로 기존 공개 브랜딩의 설정 부재 경고가 발생했다. 오늘의수학 수신 DB와 코드 배포를 먼저 완료한 뒤 에이와 코드를 배포한다. 자동 생성·전송·SSO·학습 현황의 실제 운영 결과는 검증 후 이 기록에 추가한다.
