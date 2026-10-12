/* Phone gestures: the sidebar follows the finger (swipe right to open, left to close) and bottom sheets
   can be swiped down to dismiss. Horizontal scrollers, inputs and sliders keep their own gestures. */
import { useEffect, useRef } from "react";

const PHONE = "(max-width: 760px)";
const KEEP = "textarea,input,select,[role=slider],.td-pop,.cx-plus-menu,.cv-root,.vm-root,.cx-lightbox,.sc-backdrop,.sp-backdrop,[data-no-swipe]";

/** Short vibration on supporting phones (Android); silently ignored elsewhere. */
export function haptic(ms = 8) {
  try { if (window.matchMedia(PHONE).matches) navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

function scrollsSideways(target: Element | null): boolean {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      const o = getComputedStyle(el).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
  }
  return false;
}

export function useSidebarSwipe(open: boolean, setOpen: (open: boolean) => void, blocked: () => boolean) {
  const openRef = useRef(open);
  openRef.current = open;
  const setRef = useRef(setOpen);
  setRef.current = setOpen;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    const phone = window.matchMedia(PHONE);
    let start: { x: number; y: number; t: number; open: boolean } | null = null;
    let dragging = false, dx = 0, width = 0;
    let panel: HTMLElement | null = null;
    // Touch events keep targeting the element the finger landed on; if that element leaves the DOM
    // mid-gesture (boot splash, re-rendered row) they stop bubbling to document, so listen on it too.
    let origin: EventTarget | null = null;
    const unhook = () => {
      origin?.removeEventListener("touchmove", onMove as EventListener);
      origin?.removeEventListener("touchend", onEnd);
      origin?.removeEventListener("touchcancel", reset);
      origin = null;
    };

    function reset() {
      unhook();
      if (panel) { panel.style.transition = ""; panel.style.transform = ""; }
      document.documentElement.style.removeProperty("--cx-drawer");
      panel = null; start = null; dragging = false; dx = 0;
    }
    const onStart = (e: TouchEvent) => {
      unhook();
      if (!phone.matches || e.touches.length !== 1 || blockedRef.current()) return;
      const target = e.target as Element;
      if (target.closest(KEEP) || (!openRef.current && scrollsSideways(target))) return;
      const p = e.touches[0];
      start = { x: p.clientX, y: p.clientY, t: performance.now(), open: openRef.current };
      origin = e.target;
      origin?.addEventListener("touchmove", onMove as EventListener, { passive: false });
      origin?.addEventListener("touchend", onEnd);
      origin?.addEventListener("touchcancel", reset);
    };
    let lastMove: Event | null = null;
    function onMove(e: TouchEvent) {
      if (!start || e === lastMove) return;
      lastMove = e;
      const p = e.touches[0];
      dx = p.clientX - start.x;
      const dy = p.clientY - start.y;
      if (!dragging) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Vertical scroll, or a swipe in the direction that does nothing: let the page have it.
        if (Math.abs(dx) < Math.abs(dy) * 1.3 || (start.open ? dx > 0 : dx < 0)) { start = null; return; }
        panel = document.querySelector<HTMLElement>(".cx-sidebar");
        if (!panel) { start = null; return; }
        width = panel.offsetWidth || 300;
        panel.style.transition = "none";
        dragging = true;
      }
      e.preventDefault();
      const offset = start.open ? Math.min(0, dx) : Math.min(0, -width + dx);
      panel!.style.transform = "translateX(" + offset + "px)";
      // 0 → closed, 1 → open: drives the scrim fade while dragging.
      document.documentElement.style.setProperty("--cx-drawer", String(1 + offset / width));
    }
    function onEnd() {
      if (!start || !dragging) { unhook(); start = null; return; }
      const velocity = dx / Math.max(1, performance.now() - start.t);
      const next = start.open ? !(dx < -width * 0.3 || velocity < -0.35) : dx > width * 0.3 || velocity > 0.35;
      const changed = next !== start.open;
      reset();
      setRef.current(next);
      if (changed) haptic();
    }
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", reset);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
      reset();
    };
  }, []);
}

/** Swipe a bottom sheet down to close it (closing = clicking its scrim). */
export function useSheetSwipe() {
  useEffect(() => {
    let sheet: HTMLElement | null = null, startY = 0, dy = 0, t0 = 0;
    const onStart = (e: TouchEvent) => {
      if (!window.matchMedia(PHONE).matches || e.touches.length !== 1) return;
      const el = (e.target as Element).closest<HTMLElement>(".cx-plus-menu,.td-pop");
      if (!el || (e.target as Element).closest("[role=slider]") || el.scrollTop > 0) return;
      sheet = el; startY = e.touches[0].clientY; dy = 0; t0 = performance.now();
    };
    const onMove = (e: TouchEvent) => {
      if (!sheet) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      if (dy < 6) return;
      e.preventDefault();
      sheet.style.transition = "none";
      sheet.style.transform = "translateY(" + dy + "px)";
    };
    const onEnd = () => {
      if (!sheet) return;
      const el = sheet;
      sheet = null;
      const fast = dy / Math.max(1, performance.now() - t0) > 0.5;
      el.style.transition = "";
      if (dy > 90 || (fast && dy > 30)) {
        el.style.transform = "translateY(110%)";
        haptic();
        window.setTimeout(() => (el.parentElement?.querySelector<HTMLElement>(".cx-sheet-scrim,.td-scrim"))?.click(), 140);
      } else el.style.transform = "";
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);
}
