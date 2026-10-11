"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 判定印章 —— 本页唯一的主演动画时刻：
 * 进入视口时快速落章（缩放 + 旋转回弹），此后保持静止。
 * prefers-reduced-motion 下直接呈现静止态。
 */
export function Stamp({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setInked(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInked(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      className={`stamp ${inked ? "is-inked" : "is-pending"}`}
      role="img"
      aria-label={text}
    >
      {text}
    </span>
  );
}
