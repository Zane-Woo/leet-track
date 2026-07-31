import type { Metadata } from "next";
import { headers } from "next/headers";
import { LeetTrackApp } from "./LeetTrackApp";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "题迹 · 力扣刷题记录",
    description: "记录每一道题，看见每一点进步。数据只保存在你的设备上。",
    openGraph: {
      title: "题迹 · 力扣刷题记录",
      description: "记录每一道题，看见每一点进步。",
      images: [{ url: imageUrl, width: 1734, height: 907, alt: "题迹应用预览" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "题迹 · 力扣刷题记录",
      description: "记录每一道题，看见每一点进步。",
      images: [imageUrl],
    },
  };
}

export default function Home() {
  return <LeetTrackApp />;
}
