/**
 * 학생용 데모 데이터 — 로그인 데모 학생 1명(김서연 = onescreen s1).
 * 강사 원스크린의 9명 base를 재사용하고, 결정적 9세션 이력을 입혀 누적 화면을 채운다.
 * idx=0 → seed 37 (프로토타입 s1과 동일 이력).
 */
import { DEMO_ONESCREEN } from "@/features/onescreen/data";
import { buildLearning, type StudentLearning } from "./history";

export const DEMO_STUDENT: StudentLearning = buildLearning(DEMO_ONESCREEN[0]!, 0);
