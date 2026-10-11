export default function CiroMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "ciro-mark ciro-mark--small" : "ciro-mark"} aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="ciro-crescent" x1="4" y1="0" x2="56" y2="66" gradientUnits="userSpaceOnUse">
            <stop stopColor="#d0ffdc" />
            <stop offset=".45" stopColor="#6be5aa" />
            <stop offset="1" stopColor="#218b66" />
          </linearGradient>
        </defs>
        <path d="M49 10.9C43.7 7.1 37.1 5 30.2 5 15.1 5 3 17.1 3 32.1 3 47.2 15.1 59 30.2 59c6.9 0 13.5-2.1 18.8-5.9-16.1.6-26.4-8.2-26.4-21.1S32.9 10.2 49 10.9Z" fill="url(#ciro-crescent)"/>
        <path d="m51 20.3 2.8 7.9 8.2 3.1-8.2 3.1-2.8 7.9-3-7.9-8.1-3.1 8.1-3.1 3-7.9Z" fill="#bcffe0"/>
      </svg>
    </span>
  );
}
