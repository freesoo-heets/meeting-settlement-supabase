import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "[86~02] 강서구 찐친만들기❤️",
    short_name: "강서구 찐친",
    description: "모임 참석 및 벙비 현황 관리",
    start_url: "/",
    display: "standalone",
    background_color: "#f8f4ef",
    theme_color: "#2d2824",
    lang: "ko",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
