/**
 * 🔴 학원 PC 수집기 배포 스위치 — false면 서버가 켜기·연결 파일 발급·PC 수신을 전부 거절하고, 화면에도 설치·연결 관리가 서지 않는다.
 * Windows 실측(설치 · 암호화 보관 · 예약 작업 · 한글 파일 전송 · 다시 설치 · 해제 뒤 재시도) 전이라 꺼 둔다(원장 승인 2026-11-11 협의안).
 * 열 때: ① `apps/collection-agent/build-package.py`로 설치 묶음을 만들어 `public/downloads`에 넣고 ② 이 값을 true로.
 * 지점 스위치(`management_collection_settings` — 원장이 화면에서 켠다)는 이 값이 켜진 뒤에만 뜻이 있다. 이미 있는 연결의 해제·끄기는 늘 된다.
 */
export const COLLECTOR_DEPLOYED: boolean = false;
export const isCollectorDeployed = () => COLLECTOR_DEPLOYED;
