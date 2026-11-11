import Link from "next/link";

export const metadata = { title: "타로뱅크 | 강서구 찐친만들기", description: "찐친 타로뱅크 서비스 바로가기" };

export default function TarotPortal() {
  return <main style={{minHeight:"100dvh",display:"grid",placeItems:"center",padding:"24px",background:"#f7f7fb",color:"#171724"}}>
    <section style={{maxWidth:480,width:"100%",background:"#fff",border:"1px solid #e7e7ef",borderRadius:24,padding:32,textAlign:"center",boxShadow:"0 12px 40px #1111110a"}}>
      <p style={{fontSize:32,margin:"0 0 8px"}}>🔮</p>
      <h1 style={{fontSize:27,margin:"0 0 12px"}}>찐친 타로뱅크</h1>
      <p style={{lineHeight:1.7,color:"#55556b"}}>3카드 · 6개월 운세 · 켈틱 크로스<br/>기존 타로 기록과 로그인 정보를 그대로 유지합니다.</p>
      <a href="https://tarot-bank.vercel.app/" style={{display:"block",marginTop:24,padding:"15px 20px",borderRadius:14,background:"#342663",color:"#fff",fontWeight:700,textDecoration:"none"}}>타로뱅크 시작하기 ↗</a>
      <p style={{fontSize:12,color:"#77778b",marginTop:12}}>1단계에서는 안전하게 기존 타로 서비스로 이동합니다. 통합 로그인은 후속 단계에서 적용합니다.</p>
      <Link href="/" style={{display:"inline-block",marginTop:18,color:"#56516d"}}>← 모임관리로 돌아가기</Link>
    </section>
  </main>;
}
