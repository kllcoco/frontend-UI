/* Chibi Ciro drawn in SVG (black-and-gold dress, long dark wavy hair, gold star hairpin, amber eyes).
   Used until artwork images are added under public/pet/ (see DesktopPet). */
export type Mood = "idle" | "happy" | "love" | "shy" | "angry" | "sleep" | "think" | "work" | "wave" | "drag" | "sad" | "eat";

const STAR = "M0 -11C.8 -3.2 3.2 -.8 11 0C3.2 .8 .8 3.2 0 11C-.8 3.2 -3.2 .8 -11 0C-3.2 -.8 -.8 -3.2 0 -11Z";

export default function Chibi({ mood, blink, look }: { mood: Mood; blink: boolean; look: { x: number; y: number } }) {
  const closedHappy = mood === "happy" || mood === "love" || mood === "wave";
  const closed = mood === "sleep" || (blink && !closedHappy);
  // Pupils drift towards the mouse (at most a few px); shy looks away and down, thinking looks up.
  const px = mood === "shy" ? -3 : mood === "think" ? 2 : look.x * 3;
  const py = mood === "shy" ? 3 : mood === "think" ? -4 : mood === "work" ? 3 : look.y * 2.5;
  const eye = (cx: number) => closed
    ? <path d={`M${cx - 10} 108 Q${cx} ${mood === "sleep" ? 114 : 112} ${cx + 10} 108`} stroke="#3a2618" strokeWidth="2.6" fill="none" strokeLinecap="round"/>
    : closedHappy
      ? <path d={`M${cx - 10} 111 Q${cx} 99 ${cx + 10} 111`} stroke="#3a2618" strokeWidth="2.8" fill="none" strokeLinecap="round"/>
      : <g>
          <ellipse cx={cx} cy="108" rx="11" ry="13" fill="#fffaf2"/>
          <ellipse cx={cx + px} cy={108 + py} rx="9" ry="11" fill="url(#pet-iris)"/>
          <ellipse cx={cx + px} cy={109 + py} rx="4" ry="5.5" fill="#2a1a0e"/>
          <circle cx={cx + px - 3.5} cy={103 + py} r="3" fill="#fff"/>
          <circle cx={cx + px + 3} cy={113 + py} r="1.4" fill="#fff" opacity=".85"/>
          <path d={`M${cx - 12} 99 Q${cx} 91 ${cx + 12} 99`} stroke="#22150c" strokeWidth="3.2" fill="none" strokeLinecap="round"/>
        </g>;
  const mouth = {
    happy: <path d="M93 126 Q100 135 107 126 Z" fill="#c4545b"/>,
    love: <path d="M93 126 Q100 135 107 126 Z" fill="#c4545b"/>,
    wave: <path d="M93 126 Q100 135 107 126 Z" fill="#c4545b"/>,
    angry: <path d="M94 130 Q100 125 106 130" stroke="#8a3b3b" strokeWidth="2" fill="none" strokeLinecap="round"/>,
    sad: <path d="M95 130 Q100 126 105 130" stroke="#8a3b3b" strokeWidth="2" fill="none" strokeLinecap="round"/>,
    shy: <path d="M94 128 q2 -2 4 0 t4 0 t4 0" stroke="#a24a4f" strokeWidth="1.8" fill="none" strokeLinecap="round"/>,
    sleep: <ellipse cx="100" cy="128" rx="2.6" ry="3" fill="#a24a4f"/>,
    think: <path d="M97 128 L104 127" stroke="#a24a4f" strokeWidth="1.8" strokeLinecap="round"/>
  }[mood as string] || <path d="M96 127 Q100 130 104 127" stroke="#a24a4f" strokeWidth="1.8" fill="none" strokeLinecap="round"/>;

  return <svg className="pet-svg" viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <defs>
      <radialGradient id="pet-iris" cx=".45" cy=".35" r=".75"><stop offset="0" stopColor="#f2c776"/><stop offset=".55" stopColor="#b07a33"/><stop offset="1" stopColor="#4d3013"/></radialGradient>
      <linearGradient id="pet-hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a2a22"/><stop offset="1" stopColor="#1a120e"/></linearGradient>
      <linearGradient id="pet-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fbe7b0"/><stop offset=".5" stopColor="#d9b46a"/><stop offset="1" stopColor="#8f6626"/></linearGradient>
      <linearGradient id="pet-dress" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#24201c"/><stop offset="1" stopColor="#0e0c0a"/></linearGradient>
    </defs>
    <ellipse className="pet-shadow" cx="100" cy="240" rx="62" ry="7" fill="#000" opacity=".22"/>
    <g className="pet-body">
      {/* Long wavy hair behind */}
      <g className="pet-hair-back">
        <path d="M44 92 C30 40 170 40 156 92 C170 130 178 170 172 214 C176 226 160 236 148 230 C136 238 120 236 112 230 C100 238 86 238 78 230 C64 238 46 234 40 222 C24 214 26 170 34 140 C36 120 40 104 44 92Z" fill="url(#pet-hair)"/>
        <path d="M46 130 C40 160 44 190 40 220 M154 130 C162 160 156 190 162 218 M60 150 C56 180 62 204 58 228 M140 150 C146 178 138 204 144 228" stroke="#4a382d" strokeWidth="2" fill="none" opacity=".7"/>
      </g>
      {/* Dress: black bodice, white sleeves, gold trim */}
      <path d="M74 140 L126 140 L150 226 Q100 238 50 226 Z" fill="url(#pet-dress)"/>
      <path d="M86 226 L92 150 L108 150 L114 226 Z" fill="#f4eee4" opacity=".92"/>
      <path d="M92 150 L100 162 L108 150" stroke="url(#pet-gold)" strokeWidth="2" fill="none"/>
      <path d="M58 214 Q100 226 142 214" stroke="url(#pet-gold)" strokeWidth="2" fill="none" opacity=".9"/>
      <circle cx="100" cy="166" r="3.2" fill="url(#pet-gold)"/>
      <path d="M100 169 L100 186" stroke="url(#pet-gold)" strokeWidth="1.4"/>
      <path transform="translate(100 190) scale(.42)" d={STAR} fill="url(#pet-gold)"/>
      <g className="pet-arm pet-arm--l"><path d="M74 146 C58 154 50 176 56 196 C66 204 80 198 84 186 C82 170 80 156 74 146Z" fill="#f7f1e7"/>
        <path d="M54 192 C62 200 78 198 84 188" stroke="url(#pet-gold)" strokeWidth="2" fill="none"/>
        <circle cx="74" cy="196" r="7" fill="#fde9de"/></g>
      <g className="pet-arm pet-arm--r"><path d="M126 146 C142 154 150 176 144 196 C134 204 120 198 116 186 C118 170 120 156 126 146Z" fill="#f7f1e7"/>
        <path d="M146 192 C138 200 122 198 116 188" stroke="url(#pet-gold)" strokeWidth="2" fill="none"/>
        <circle cx="126" cy="196" r="7" fill="#fde9de"/></g>
      {mood === "work" && <g className="pet-laptop"><path d="M66 204 L134 204 L140 222 L60 222 Z" fill="#c9ccd2"/><path d="M70 172 L130 172 L134 204 L66 204 Z" fill="#e6e8ec"/>
        <path transform="translate(100 188) scale(.5)" d={STAR} fill="#9aa6b8"/></g>}
      {/* Head */}
      <g className="pet-head">
        <ellipse cx="100" cy="100" rx="48" ry="45" fill="#fdeade"/>
        <ellipse cx="72" cy="122" rx="8" ry="4.5" fill="#f4a7a7" opacity={mood === "shy" || mood === "love" ? .75 : .35}/>
        <ellipse cx="128" cy="122" rx="8" ry="4.5" fill="#f4a7a7" opacity={mood === "shy" || mood === "love" ? .75 : .35}/>
        {mood === "shy" && <path d="M64 118 l4 -4 M69 120 l4 -4 M126 120 l4 -4 M131 118 l4 -4" stroke="#d76b6b" strokeWidth="1.4" strokeLinecap="round"/>}
        {eye(81)}{eye(119)}
        {mood === "angry" && <path d="M70 94 L90 99 M130 94 L110 99" stroke="#22150c" strokeWidth="3" strokeLinecap="round"/>}
        {mood === "sad" && <path d="M70 97 L88 93 M130 97 L112 93" stroke="#22150c" strokeWidth="2.6" strokeLinecap="round"/>}
        {mouth}
        {/* Bangs and side locks */}
        <path d="M48 100 C40 30 160 30 152 100 L146 88 L140 106 L130 80 L120 104 L108 76 L100 102 L90 78 L82 106 L72 82 L64 104 L56 88 Z" fill="url(#pet-hair)"/>
        <path d="M62 62 C78 48 120 46 140 60" stroke="#6b5444" strokeWidth="2.4" fill="none" opacity=".55" strokeLinecap="round"/>
        <path d="M52 92 C44 120 50 150 44 170 C54 160 60 140 60 112 Z M148 92 C156 120 150 150 156 170 C146 160 140 140 140 112 Z" fill="url(#pet-hair)"/>
        <path d="M100 58 C96 70 98 86 106 98 M80 64 C76 76 76 88 80 100 M122 64 C126 76 124 90 118 100" stroke="#4d3a2f" strokeWidth="1.6" fill="none" opacity=".8"/>
        {/* Gold star hairpin with a ribbon and a small chain */}
        <g className="pet-pin" transform="translate(140 62)">
          <path d="M-4 4 C-14 10 -16 20 -10 24 M-2 6 C-4 16 2 24 6 26" stroke="#1a120e" strokeWidth="5" fill="none" strokeLinecap="round"/>
          <path d={STAR} fill="url(#pet-gold)" stroke="#8f6626" strokeWidth=".8"/>
          <path d="M2 8 L4 26" stroke="url(#pet-gold)" strokeWidth="1.2"/><circle cx="4" cy="27" r="2" fill="url(#pet-gold)"/>
        </g>
      </g>
      {mood === "angry" && <path className="pet-mark" d="M150 70 l6 -6 m-6 0 l6 6 M160 74 l6 -6 m-6 0 l6 6" stroke="#d9534f" strokeWidth="2.4" strokeLinecap="round"/>}
    </g>
  </svg>;
}
