import Link from "next/link";
import { EyIcon } from "@/components/icons/aywa-icons";
import styles from "./public-site.module.css";

/** 로그인 화면의 AYWA 표식(네이비 네모 안 건물 — 오늘 낮 판 모양, 원장이 이 모양을 골랐다). 학원·지점 표기는 두지 않는다(결정 로그). */
export function PublicBrand() {
  return (
    <Link href="/" className={styles.brand} aria-label="AYWA 홈">
      <span className={styles.brandMark}><EyIcon name="building" size={22} /></span>
      <span>AYWA</span>
    </Link>
  );
}
