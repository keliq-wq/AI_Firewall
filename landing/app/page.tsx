"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const LANGS = ["en", "zh"];

function storedLang(): string {
  if (typeof window === "undefined") return "en";
  try {
    const v = window.localStorage.getItem("lang");
    return LANGS.includes(v ?? "") ? (v as string) : "en";
  } catch {
    return "en";
  }
}

// 根路径重定向：默认英文（英语默认），访客选过中文则记住中文
export default function RootRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${storedLang()}/`);
  }, [router]);

  return null;
}
