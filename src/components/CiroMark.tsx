import { useId } from "react";
/** Ciro "orbit C" mark: an open ring with a four-pointed star in the gap, in black and gold. Colours follow the theme tokens. */
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
        <path className="ciro-mark-star" d="M51 23.5C51.6 29.4 53.6 31.4 59.5 32C53.6 32.6 51.6 34.6 51 40.5C50.4 34.6 48.4 32.6 42.5 32C48.4 31.4 50.4 29.4 51 23.5Z"/>
      </svg>
    </span>
  );
}
