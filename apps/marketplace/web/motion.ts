import { useEffect, useRef } from "react";

/** Pointer-only art depth. Controls and text remain stationary. No idle loop. */
export function useArtworkDepth() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window.matchMedia !== "function") return;
    const allowed = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    let point = { x: 0, y: 0 };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete element.dataset.tracking;
      for (const name of ["--art-x", "--art-y", "--light-x", "--light-y"])
        element.style.removeProperty(name);
    };
    const move = (event: PointerEvent) => {
      if (!allowed.matches || event.pointerType === "touch") return;
      point = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!allowed.matches) return;
        const bounds = element.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const x = Math.max(
          -1,
          Math.min(1, ((point.x - bounds.left) / bounds.width - 0.5) * 2),
        );
        const y = Math.max(
          -1,
          Math.min(1, ((point.y - bounds.top) / bounds.height - 0.5) * 2),
        );
        element.style.setProperty("--art-x", `${x * 8}px`);
        element.style.setProperty("--art-y", `${y * 6}px`);
        element.style.setProperty("--light-x", `${x * 70}px`);
        element.style.setProperty("--light-y", `${y * 40}px`);
        element.dataset.tracking = "true";
      });
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerleave", reset);
    element.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    allowed.addEventListener("change", reset);
    return () => {
      reset();
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      element.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      allowed.removeEventListener("change", reset);
    };
  }, []);
  return ref;
}

/** Scroll drives only optical layers. No idle loop, layout state or hidden content. */
export function useSceneProgress(mode: "departure" | "arrival") {
  const ref = useRef<HTMLElement & HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window.matchMedia !== "function") return;
    const allowed = window.matchMedia(
      "(min-width: 601px) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    let visible = true;
    const cancel = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const update = () => {
      frame = 0;
      if (!allowed.matches || !visible || document.hidden) return;
      const rect = element.getBoundingClientRect();
      const value =
        mode === "departure"
          ? -rect.top / Math.max(1, rect.height)
          : (window.innerHeight - rect.top) /
            Math.max(1, window.innerHeight * 0.8);
      const progress = Math.max(0, Math.min(1, value));
      element.style.setProperty("--scene-progress", progress.toFixed(4));
    };
    const schedule = () => {
      if (allowed.matches && visible && !document.hidden && !frame)
        frame = requestAnimationFrame(update);
    };
    const reset = () => {
      cancel();
      element.style.removeProperty("--scene-progress");
      schedule();
    };
    const visibility = () => (document.hidden ? cancel() : schedule());
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) schedule();
            else cancel();
          })
        : undefined;
    observer?.observe(element);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    allowed.addEventListener("change", reset);
    schedule();
    return () => {
      cancel();
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", visibility);
      allowed.removeEventListener("change", reset);
      element.style.removeProperty("--scene-progress");
    };
  }, [mode]);
  return ref;
}
