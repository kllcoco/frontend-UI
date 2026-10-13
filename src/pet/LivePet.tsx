import { useEffect, useRef } from "react";
import type { Mood } from "./Chibi";

/* Live2D-style motion for one flat illustration: the picture is drawn on a fine WebGL mesh whose vertices are
   moved every frame (breathing, head sway and tilt, hair swaying more towards the ends, eyes following the
   cursor, blinking by squashing the eye region). The artwork itself is never edited. Coordinates below are in
   the sprite's own pixels (600×800, public/pet/idle.webp). Falls back to a plain <img> without WebGL. */
const W = 600, H = 800;
const RIG = {
  neck: [325, 318], face: [310, 238], eyes: [[260, 247], [360, 218]] as const,
  eyeR: [30, 21], eyeTilt: -17 * Math.PI / 180, bodyX: 330
};

const VERT = `
attribute vec2 a;            // vertex position in sprite pixels
uniform float t, breath, head, nodY, sway, blink, lookX, lookY;
varying vec2 uv;
const vec2 NECK = vec2(${RIG.neck[0]}.0, ${RIG.neck[1]}.0);
const vec2 FACE = vec2(${RIG.face[0]}.0, ${RIG.face[1]}.0);
const vec2 E1 = vec2(${RIG.eyes[0][0]}.0, ${RIG.eyes[0][1]}.0);
const vec2 E2 = vec2(${RIG.eyes[1][0]}.0, ${RIG.eyes[1][1]}.0);
const vec2 ER = vec2(${RIG.eyeR[0]}.0, ${RIG.eyeR[1]}.0);
const float TILT = ${RIG.eyeTilt.toFixed(4)};
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// Squash one eye towards its lower lid (blink = 1: closed).
vec2 eye(vec2 p, vec2 e, float k) {
  vec2 l = rot(p - e, -TILT);
  float r = length(l / (ER * vec2(1.35, 1.9)));
  float w = 1.0 - smoothstep(0.55, 1.0, r);
  float lid = ER.y * 0.45;
  l.y = mix(l.y, lid + (l.y - lid) * (1.0 - 0.92 * k), w);
  return e + rot(l, TILT);
}
void main() {
  uv = a / vec2(${W}.0, ${H}.0);
  vec2 p = a;
  // eyes: blink, then follow the cursor; the face shifts a little less (a hint of turning the head)
  p = eye(p, E1, blink); p = eye(p, E2, blink);
  float eyesW = exp(-dot((p - E1) / vec2(46.0, 38.0), (p - E1) / vec2(46.0, 38.0))) + exp(-dot((p - E2) / vec2(46.0, 38.0), (p - E2) / vec2(46.0, 38.0)));
  float faceW = exp(-dot((p - FACE) / vec2(120.0, 95.0), (p - FACE) / vec2(120.0, 95.0)));
  p += vec2(lookX, lookY) * (min(eyesW, 1.0) * 3.0 + faceW * 2.5);
  // head (and the hair around it) rotates around the neck
  float headW = 1.0 - smoothstep(NECK.y - 40.0, NECK.y + 30.0, a.y);
  p = mix(p, NECK + rot(p - NECK, head), headW) + vec2(0.0, nodY * headW);
  // breathing: chest and shoulders rise and fall, feet stay put
  float bodyW = (1.0 - smoothstep(110.0, 230.0, abs(a.x - ${RIG.bodyX}.0))) * smoothstep(NECK.y - 60.0, NECK.y + 40.0, a.y);
  p.y -= breath * (${H}.0 - a.y) * 0.010 * bodyW;
  p.y -= breath * 2.2 * headW;
  // long hair sways, more towards the ends, in a travelling wave
  float side = smoothstep(70.0, 170.0, abs(a.x - ${RIG.bodyX}.0));
  float down = smoothstep(220.0, 720.0, a.y);
  p.x += sin(t * 1.35 + a.y * 0.012) * sway * side * down * (a.y - 220.0) / 500.0;
  gl_Position = vec4(p.x / ${W}.0 * 2.0 - 1.0, 1.0 - p.y / ${H}.0 * 2.0, 0.0, 1.0);
}`;
const FRAG = `precision mediump float; uniform sampler2D img; varying vec2 uv;
void main() { vec4 c = texture2D(img, uv); if (c.a < 0.004) discard; gl_FragColor = vec4(c.rgb * c.a, c.a); }`;

type Motion = { breath: number; breathSpeed: number; head: number; headSpeed: number; nodY: number; sway: number; blink?: number; look?: [number, number] };
const MOTION: Record<string, Motion> = {
  idle: { breath: 1, breathSpeed: 1.9, head: .018, headSpeed: .55, nodY: 0, sway: 6 },
  happy: { breath: 1.2, breathSpeed: 2.6, head: .06, headSpeed: 2.2, nodY: 0, sway: 9 },
  love: { breath: 1.1, breathSpeed: 2.2, head: .07, headSpeed: 1.4, nodY: 0, sway: 8 },
  wave: { breath: 1.1, breathSpeed: 2.2, head: .05, headSpeed: 2, nodY: 0, sway: 9 },
  shy: { breath: .9, breathSpeed: 2.4, head: -.09, headSpeed: 0, nodY: 2, sway: 5, look: [-.8, .7] },
  angry: { breath: 1.4, breathSpeed: 3.4, head: .02, headSpeed: 4, nodY: 0, sway: 5 },
  sad: { breath: .8, breathSpeed: 1.3, head: .05, headSpeed: 0, nodY: 5, sway: 3, look: [.2, 1] },
  think: { breath: .9, breathSpeed: 1.6, head: .08, headSpeed: 0, nodY: 0, sway: 4, look: [-.7, -.9] },
  work: { breath: .9, breathSpeed: 1.7, head: .03, headSpeed: .4, nodY: 3, sway: 4, look: [.3, .9] },
  eat: { breath: 1, breathSpeed: 2.4, head: .04, headSpeed: 1.6, nodY: 0, sway: 6 },
  sleep: { breath: 1.5, breathSpeed: .9, head: .12, headSpeed: 0, nodY: 7, sway: 2, blink: 1 },
  drag: { breath: 1, breathSpeed: 3, head: .08, headSpeed: 3.2, nodY: 0, sway: 16 }
};

export default function LivePet({ src, mood, look }: { src: string; mood: Mood; look: { x: number; y: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLImageElement>(null);
  const state = useRef({ mood, look });
  state.current = { mood, look };

  useEffect(() => {
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) { cv.style.display = "none"; if (fallback.current) fallback.current.style.display = "block"; return; }
    const shader = (type: number, code: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { cv.style.display = "none"; if (fallback.current) fallback.current.style.display = "block"; return; }
    gl.useProgram(prog);
    // A fine grid (denser than the eyes need) so every bend stays smooth.
    const NX = 72, NY = 96, verts: number[] = [], idx: number[] = [];
    for (let j = 0; j <= NY; j += 1) for (let i = 0; i <= NX; i += 1) verts.push(i / NX * W, j / NY * H);
    for (let j = 0; j < NY; j += 1) for (let i = 0; i < NX; i += 1) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const U = { t: u("t"), breath: u("breath"), head: u("head"), nodY: u("nodY"), sway: u("sway"), blink: u("blink"), lookX: u("lookX"), lookY: u("lookY") };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let ready = false, raf = 0, alive = true;
    const img = new Image();
    img.onload = () => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ready = true;
    };
    img.src = src;

    // Smoothly eased parameters so changing mood or looking around never jumps.
    const cur = { breath: 1, head: 0, nodY: 0, sway: 6, blink: 0, lx: 0, ly: 0 };
    let nextBlink = performance.now() + 2500, blinkStart = -1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!ready) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      const t = reduce ? 0 : now / 1000;
      const { mood: m, look: l } = state.current;
      const M = MOTION[m] || MOTION.idle;
      const ease = (a: number, b: number, k = .08) => a + (b - a) * k;
      // automatic blinking (sometimes twice), unless the mood keeps her eyes shut
      let blinkTarget = M.blink ?? 0;
      if (M.blink === undefined) {
        if (blinkStart < 0 && now > nextBlink) blinkStart = now;
        if (blinkStart >= 0) {
          const k = (now - blinkStart) / 150;
          blinkTarget = k < 1 ? Math.sin(k * Math.PI) : 0;
          if (k >= 1) { blinkStart = -1; nextBlink = now + (Math.random() < .2 ? 180 : 2200 + Math.random() * 4200); }
        }
      }
      cur.blink = M.blink !== undefined ? ease(cur.blink, blinkTarget, .06) : blinkTarget;
      cur.breath = ease(cur.breath, M.breath); cur.nodY = ease(cur.nodY, M.nodY, .05); cur.sway = ease(cur.sway, M.sway, .05);
      const headTarget = M.headSpeed ? M.head * Math.sin(t * M.headSpeed) : M.head;
      cur.head = ease(cur.head, headTarget + (M.look ? 0 : l.x * .03), .06);
      const [tx, ty] = M.look || [l.x, l.y];
      cur.lx = ease(cur.lx, tx, .12); cur.ly = ease(cur.ly, ty, .12);
      gl.uniform1f(U.t, t);
      gl.uniform1f(U.breath, cur.breath * (Math.sin(t * M.breathSpeed) * .5 + .5));
      gl.uniform1f(U.head, cur.head); gl.uniform1f(U.nodY, cur.nodY); gl.uniform1f(U.sway, reduce ? 0 : cur.sway);
      gl.uniform1f(U.blink, cur.blink); gl.uniform1f(U.lookX, cur.lx); gl.uniform1f(U.lookY, cur.ly);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    };
    raf = requestAnimationFrame(frame);
    // Pause when hidden (minimised window, background tab).
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", vis); };
  }, [src]);

  return <>
    <canvas ref={canvas} className="pet-live" aria-hidden="true"/>
    <img ref={fallback} src={src} alt="" draggable={false} style={{ display: "none" }}/>
  </>;
}
