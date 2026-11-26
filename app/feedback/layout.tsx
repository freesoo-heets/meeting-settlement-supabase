import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "찐친 소리함",
  description: "강서구 찐친만들기 회원들의 건의사항과 의견을 전달하는 비공개 소리함입니다.",
  alternates: { canonical: "/feedback" },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "강서구 찐친만들기",
    url: "/feedback",
    title: "찐친 소리함",
    description: "강서구 찐친만들기 회원들의 건의사항과 의견을 전달하는 비공개 소리함입니다.",
  },
  twitter: {
    card: "summary",
    title: "찐친 소리함",
    description: "강서구 찐친만들기 회원들의 건의사항과 의견을 전달하는 비공개 소리함입니다.",
  },
};

export default function FeedbackLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
