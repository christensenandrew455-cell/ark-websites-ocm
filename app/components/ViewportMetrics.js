"use client";

import { useEffect } from "react";

export default function ViewportMetrics() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;

    const update = () => {
      const height = viewport?.height || window.innerHeight;
      const offsetTop = viewport?.offsetTop || 0;
      root.style.setProperty("--ark-visual-viewport-height", `${Math.round(height)}px`);
      root.style.setProperty("--ark-visual-viewport-top", `${Math.round(offsetTop)}px`);
      root.toggleAttribute("data-keyboard-open", height < window.innerHeight * 0.8);
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("orientationchange", update, { passive: true });
    viewport?.addEventListener("resize", update, { passive: true });
    viewport?.addEventListener("scroll", update, { passive: true });

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);

  return null;
}
