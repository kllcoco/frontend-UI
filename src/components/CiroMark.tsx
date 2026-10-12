import { useId } from "react";
/** Ciro "orbit C" mark: an open ring with a single star in the gap. Colours follow the theme tokens. */
export default function CiroMark({ small = false }: { small?: boolean }) {
  const gradientId = useId();
  return (
    <span className={small ? "ciro-mark ciro-mark--small" : "ciro-mark"} aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={gradientId} x1="10" y1="8" x2="52" y2="58" gradientUnits="userSpaceOnUse">
            <stop className="ciro-mark-stop-a"/>
            <stop offset="1" className="ciro-mark-stop-b"/>
          </linearGradient>
        </defs>
        <path d="M48.5 17.5A22 22 0 1 0 48.5 46.5" stroke={"url(#" + gradientId + ")"} strokeWidth="8.5" strokeLinecap="round"/>
        <circle className="ciro-mark-star" cx="51" cy="32" r="5"/>
      </svg>
    </span>
  );
}
