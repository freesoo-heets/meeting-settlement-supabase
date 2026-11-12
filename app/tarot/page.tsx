import Link from "next/link";
import { tarotOrigin } from "../../lib/tarot-portal";
import TarotPortal from "./TarotPortal";
import styles from "../operationsHub.module.css";

export const metadata = {
  title: "타로뱅크 | 강서구 찐친만들기",
  description: "찐친 타로뱅크 리딩과 이용 기록",
};

export default function TarotPage() {
  return <main className={styles.hub} style={{ padding: "20px 14px" }}>
    <header className={styles.hero}>
      <div><p>강서구 찐친만들기</p><h1>찐친 타로뱅크</h1></div>
      <Link href="/">모임관리로 돌아가기</Link>
    </header>
    <section className={styles.section} aria-labelledby="tarot-readings">
      <h2 id="tarot-readings">리딩 선택</h2>
      <p>타로뱅크 계정으로 로그인하면 기존 리딩 기록을 이어서 볼 수 있습니다.</p>
      <TarotPortal />
      <a href={tarotOrigin} target="_blank" rel="noopener noreferrer">타로뱅크 홈에서 열기 ↗</a>
    </section>
  </main>;
}
