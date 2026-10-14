import { useEffect, useRef } from "react";
import type { Mood } from "./Chibi";

/* Live2D-style motion for the layered artwork in public/pet/ (split with AI from the original picture):
   base.webp (everything but the arms, with what was under them filled in), armL.webp, armR.webp (with the magic
   circle) and eyelids.png (blink frames). Each layer is drawn on a fine WebGL mesh moved every frame: breathing,
   head sway and tilt, hair swaying more towards the ends, eyes following the cursor, arms turning at the
   shoulders as separate pieces. Coordinates are logical sprite pixels (600×800; the images are 2× that).
   Falls back to a plain <img> without WebGL. */
const W = 600, H = 800;
const PAD_X = 36, PAD_TOP = 80;   // must match .pet-live in pet.css (6% each side, 10% on top)
const RIG = {
  neck: [325, 318], face: [310, 238], eyes: [[260, 247], [360, 218]] as const,
  eyeR: [30, 21], eyeTilt: -17 * Math.PI / 180, bodyX: 330
};

const VERT = `
attribute vec2 a;            // vertex position in sprite pixels
uniform float t, breath, head, nodY, sway, lookX, lookY;
uniform float armR, armL, orbSpin, skirt, ear, lift, squash, layer;   // layer: 0 base, 1 left arm, 2 right arm
varying vec2 uv; varying vec2 pos; varying float vLayer;
const vec2 NECK = vec2(${RIG.neck[0]}.0, ${RIG.neck[1]}.0);
const vec2 FACE = vec2(${RIG.face[0]}.0, ${RIG.face[1]}.0);
const vec2 E1 = vec2(${RIG.eyes[0][0]}.0, ${RIG.eyes[0][1]}.0);
const vec2 E2 = vec2(${RIG.eyes[1][0]}.0, ${RIG.eyes[1][1]}.0);
const vec2 ER = vec2(${RIG.eyeR[0]}.0, ${RIG.eyeR[1]}.0);
const float TILT = ${RIG.eyeTilt.toFixed(4)};
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// A soft region (1 inside the ellipse, fading to 0 just outside).
float region(vec2 p, vec2 c, vec2 r) { return 1.0 - smoothstep(0.65, 1.05, length((p - c) / r)); }
vec2 turn(vec2 p, vec2 pivot, float ang, float w) { return mix(p, pivot + rot(p - pivot, ang), w); }
void main() {
  uv = a / vec2(${W}.0, ${H}.0);
  pos = a; vLayer = layer;
  vec2 p = a;
  // arm layers turn as whole pieces at the shoulder (the base underneath has the body / hair filled in);
  // the magic circle in the right hand also spins on its own
  if (layer > 1.5) {
    p = turn(p, vec2(450.0, 335.0), orbSpin, region(a, vec2(450.0, 335.0), vec2(40.0, 40.0)));
    p = vec2(382.0, 352.0) + rot(p - vec2(382.0, 352.0), armR);
  } else if (layer > 0.5) {
    p = vec2(288.0, 352.0) + rot(p - vec2(288.0, 352.0), armL);
  }
  // earrings swing from where they hang
  p = turn(p, vec2(237.0, 297.0), ear, region(a, vec2(237.0, 328.0), vec2(16.0, 36.0)));
  p = turn(p, vec2(405.0, 255.0), ear * 0.8, region(a, vec2(405.0, 287.0), vec2(16.0, 38.0)));
  // skirt and ribbons sway, feet stay planted
  float feet = region(a, vec2(310.0, 720.0), vec2(70.0, 90.0));
  p.x += sin(t * 1.7 + a.x * 0.011) * skirt * smoothstep(470.0, 700.0, a.y) * (1.0 - feet);
  // eyes follow the cursor; the face shifts a little less (a hint of turning the head). Blinking is drawn
  // in the fragment shader as an eyelid layer, so the eye itself is never stretched.
  float faceW = exp(-dot((p - FACE) / vec2(120.0, 95.0), (p - FACE) / vec2(120.0, 95.0)));
  p += vec2(lookX, lookY) * faceW * 2.5;
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
  // whole body: squash & stretch around the feet, and lift off the ground for jumps
  p.y = ${H}.0 - (${H}.0 - p.y) * (1.0 - squash);
  p.x = ${RIG.bodyX}.0 + (p.x - ${RIG.bodyX}.0) * (1.0 + squash * 0.55);
  p.y -= lift;
  // the canvas is larger than the sprite (PAD_X each side, PAD_TOP above) so jumps and raised arms stay inside
  vec2 q = vec2((p.x + ${PAD_X}.0) / ${W + 2 * PAD_X}.0, (p.y + ${PAD_TOP}.0) / ${H + PAD_TOP}.0);
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;
// Blinking never stretches the eyes: public/pet/eyes-closed.webp is the base picture with her closed eyes (taken
// from the closed-eye artwork) painted in, and its alpha marks the eye areas; the shader cross-fades to it.
const FRAG = `precision mediump float; uniform sampler2D img, closed, smile; uniform float glow, blink, hasClosed, smiling, hasSmile; varying vec2 uv; varying vec2 pos; varying float vLayer;
const vec2 SIZE = vec2(${W}.0, ${H}.0);
// Textures are uploaded premultiplied, so filtering never blends in the black of transparent pixels (that read
// as a dark halo around her, most visibly while she moves); the colour maths below wants straight colour.
vec4 straight(vec4 t) { return t.a > 0.0 ? vec4(t.rgb / t.a, t.a) : t; }
void main() {
  vec4 c = straight(texture2D(img, pos / SIZE)); if (c.a < 0.004) discard;
  // (the layer number comes through a varying: a uniform shared by both shaders would need equal precision)
  if (vLayer > 0.5) {   // arm layers: only the circle's glow
    float gg = vLayer > 1.5 ? glow * exp(-dot((pos - vec2(450.0, 335.0)) / 42.0, (pos - vec2(450.0, 335.0)) / 42.0)) : 0.0;
    float ll = dot(c.rgb, vec3(0.299, 0.587, 0.114));
    gl_FragColor = vec4((c.rgb + vec3(1.0, 0.82, 0.48) * gg * 0.32 * smoothstep(0.45, 0.85, ll)) * c.a, c.a);
    return;
  }
  if (hasClosed > 0.5 && blink > 0.01) {
    vec4 e = straight(texture2D(closed, pos / SIZE));
    c.rgb = mix(c.rgb, e.rgb, blink * e.a);
  }
  // her smile (from the same closed-eye artwork), faded in when she is happy
  if (hasSmile > 0.5 && smiling > 0.01) {
    vec4 sm = straight(texture2D(smile, pos / SIZE));
    c.rgb = mix(c.rgb, sm.rgb, smiling * sm.a);
  }
  // the magic circle glows (warm gold) when she uses it
  float g = glow * exp(-dot((pos - vec2(450.0, 335.0)) / 42.0, (pos - vec2(450.0, 335.0)) / 42.0));
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 col = c.rgb + vec3(1.0, 0.82, 0.48) * g * 0.32 * smoothstep(0.45, 0.85, lum) * c.a;
  gl_FragColor = vec4(col * c.a, c.a);
}`;

/** One-off gestures, each a function of progress p (0→1) returning extra pose values. */
export type PetAction = "wave" | "nod" | "shake" | "bow" | "jump" | "stretch" | "magic" | "spin"
  | "lookaround" | "yawn" | "hum" | "doze" | "tidy" | "giggle" | "sparkle" | "peek";
/** Gestures she plays on her own while idle (the model can use them too). */
export const IDLE_ACTIONS: PetAction[] = ["lookaround", "yawn", "hum", "doze", "tidy", "giggle", "sparkle", "peek", "stretch", "nod", "magic", "spin"];
type Pose = Partial<{ armR: number; armL: number; head: number; nodY: number; lift: number; squash: number; orb: number; glow: number; ear: number; skirt: number;
  lookX: number; lookY: number; blink: number; smile: number }>;
const ramp = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const env = (p: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, p))) ** .6;
const ACTIONS: Record<PetAction, { ms: number; pose: (p: number) => Pose }> = {
  // raise the right hand (with the circle) and wave it
  wave: { ms: 1900, pose: (p) => ({ armR: -(0.34 + 0.16 * Math.sin(p * Math.PI * 6)) * env(p), head: 0.05 * env(p), ear: 0.25 * Math.sin(p * 18) * env(p) }) },
  nod: { ms: 1000, pose: (p) => ({ nodY: 7 * Math.sin(p * Math.PI * 4) ** 2 * env(p), head: 0.02 * env(p) }) },
  shake: { ms: 1100, pose: (p) => ({ head: 0.075 * Math.sin(p * Math.PI * 6) * env(p), ear: 0.35 * Math.sin(p * Math.PI * 6 + 1) * env(p) }) },
  bow: { ms: 1600, pose: (p) => ({ nodY: 14 * env(p), squash: 0.035 * env(p), armL: 0.12 * env(p), armR: 0.1 * env(p), head: 0.03 * env(p) }) },
  // crouch, jump (stretched), land (squash), settle
  jump: { ms: 950, pose: (p) => {
    if (p < .22) { const k = p / .22; return { squash: 0.07 * Math.sin(k * Math.PI / 2) }; }
    if (p < .72) { const k = (p - .22) / .5; return { lift: 34 * Math.sin(k * Math.PI), squash: -0.045 * Math.sin(k * Math.PI), armR: -0.18 * Math.sin(k * Math.PI), armL: 0.16 * Math.sin(k * Math.PI), skirt: 8, ear: 0.4 * Math.sin(k * Math.PI) }; }
    const k = (p - .72) / .28; return { squash: 0.05 * Math.sin(Math.PI * (1 - k)) * (1 - k) };
  } },
  // both arms up, stand a little taller, then relax
  stretch: { ms: 2400, pose: (p) => ({ armR: -0.32 * env(p), armL: 0.34 * env(p), squash: -0.03 * env(p), head: -0.04 * env(p), nodY: -3 * env(p) }) },
  // show the magic circle: lift it, spin it, glow
  magic: { ms: 2200, pose: (p) => ({ armR: -0.2 * env(p), orb: p * Math.PI * 2.2, glow: 0.8 * env(p), head: 0.06 * env(p) }) },
  // a little twirl: skirt and hair fly out, one hop
  spin: { ms: 1300, pose: (p) => ({ skirt: 18 * env(p), lift: 10 * Math.sin(p * Math.PI), head: 0.05 * Math.sin(p * Math.PI * 2), ear: 0.5 * Math.sin(p * 12) * env(p) }) },
  // look to one side, then the other, the head turning a little with the eyes
  lookaround: { ms: 3200, pose: (p) => {
    const x = p < .45 ? -Math.sin(ramp(p, 0, .45) * Math.PI / 2) : p < .55 ? -1 + 2 * ramp(p, .45, .55) : Math.cos(ramp(p, .55, 1) * Math.PI / 2);
    return { lookX: x * env(p), lookY: -0.15 * env(p), head: 0.045 * x * env(p) };
  } },
  // arms up, eyes shut, head back a little, then a small shake-off
  yawn: { ms: 2600, pose: (p) => ({ armR: -0.26 * env(ramp(p, 0, .8)), armL: 0.28 * env(ramp(p, 0, .8)), blink: env(ramp(p, .1, .75)), head: -0.05 * env(ramp(p, .1, .75)),
    nodY: -4 * env(ramp(p, .1, .75)), squash: -0.02 * env(ramp(p, 0, .8)), ear: 0.3 * Math.sin(p * 30) * env(ramp(p, .8, 1)) }) },
  // swaying to a tune with a smile
  hum: { ms: 3600, pose: (p) => ({ head: 0.06 * Math.sin(p * Math.PI * 4) * env(p), smile: env(p), skirt: 5 * Math.sin(p * Math.PI * 4) * env(p), ear: 0.35 * Math.sin(p * Math.PI * 4 + .5) * env(p), lookY: -0.3 * env(p) }) },
  // nodding off: eyes close, the head sinks, then she jerks awake
  doze: { ms: 3400, pose: (p) => {
    const sink = p < .8 ? Math.sin(ramp(p, 0, .8) * Math.PI / 2) : 1 - ramp(p, .8, .86);
    return { blink: Math.min(1, sink * 1.3), nodY: 9 * sink, head: 0.07 * sink, lift: p > .8 && p < .9 ? 6 * Math.sin(ramp(p, .8, .9) * Math.PI) : 0 };
  } },
  // tucks her hair: left hand up to the head, head tilts into it
  tidy: { ms: 2200, pose: (p) => ({ armL: 0.3 * env(p), head: -0.06 * env(p), lookX: -0.4 * env(p), ear: 0.25 * Math.sin(p * 14) * env(p) }) },
  // giggles: small bounces, eyes closed in a smile
  giggle: { ms: 1500, pose: (p) => ({ lift: 4 * Math.abs(Math.sin(p * Math.PI * 5)) * env(p), squash: 0.015 * Math.sin(p * Math.PI * 10) * env(p), blink: env(p), smile: env(p), head: 0.03 * Math.sin(p * Math.PI * 5) }) },
  // a quick flick of the circle: sparkle and a smile
  sparkle: { ms: 1400, pose: (p) => ({ armR: -0.14 * env(p), orb: p * Math.PI * 3, glow: 1.1 * env(ramp(p, .2, 1)), smile: env(p) }) },
  // leans in and looks straight at you
  peek: { ms: 2400, pose: (p) => ({ head: 0.1 * env(p), nodY: 3 * env(p), lookX: 0, lookY: 0.1 * env(p), ear: 0.2 * Math.sin(p * 10) * env(p) }) }
};

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
  sleep: { breath: 1.5, breathSpeed: .9, head: .12, headSpeed: 0, nodY: 8, sway: 2, blink: 1, look: [.1, 1] },
  drag: { breath: 1, breathSpeed: 3, head: .08, headSpeed: 3.2, nodY: 0, sway: 16 }
};

export default function LivePet({ src, mood, look, action, walking = false }: {
  src: string; mood: Mood; look: { x: number; y: number }; action?: { name: PetAction; id: number } | null; walking?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fallback = useRef<HTMLImageElement>(null);
  const state = useRef({ mood, look, walking, lookAt: 0 });
  const lastLook = useRef(look);
  // remember when the pointer last moved her eyes; without it she looks around on her own
  const lookAt = lastLook.current.x !== look.x || lastLook.current.y !== look.y ? performance.now() : state.current.lookAt;
  lastLook.current = look;
  state.current = { mood, look, walking, lookAt };
  const playing = useRef<{ name: PetAction; start: number } | null>(null);
  useEffect(() => { if (action && ACTIONS[action.name]) playing.current = { name: action.name, start: performance.now() }; }, [action?.id]);

  useEffect(() => {
    const cv = canvas.current!;
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) { cv.style.display = "none"; if (fallback.current) fallback.current.style.display = "block"; return; }
    const shader = (type: number, code: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("pet: WebGL program failed, showing the still picture", gl.getProgramInfoLog(prog)); cv.style.display = "none"; if (fallback.current) fallback.current.style.display = "block"; return; }
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
    const U = { t: u("t"), breath: u("breath"), head: u("head"), nodY: u("nodY"), sway: u("sway"), blink: u("blink"), lookX: u("lookX"), lookY: u("lookY"),
      armR: u("armR"), armL: u("armL"), orbSpin: u("orbSpin"), skirt: u("skirt"), ear: u("ear"), lift: u("lift"), squash: u("squash"), glow: u("glow"),
      layer: u("layer"), img: u("img"), hasClosed: u("hasClosed"), smiling: u("smiling"), hasSmile: u("hasSmile") };
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    let ready = false, raf = 0, alive = true, hasClosed = false, hasSmile = false;
    const layers: (WebGLTexture | null)[] = [null, null, null];   // base, armL, armR
    const texture = (unit: number, url: string, done: (tex: WebGLTexture) => void) => {
      const im = new Image();
      im.onload = () => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        done(tex!);
      };
      im.src = url;
    };
    const dir = src.replace(/[^/]+$/, "");
    texture(0, src, (tex) => { layers[0] = tex; ready = true; });
    texture(2, dir + "armL.webp", (tex) => { layers[1] = tex; });
    texture(3, dir + "armR.webp", (tex) => { layers[2] = tex; });
    texture(1, dir + "eyes-closed.webp", () => { hasClosed = true; gl.uniform1i(gl.getUniformLocation(prog, "closed"), 1); });
    texture(4, dir + "smile.webp", () => { hasSmile = true; gl.uniform1i(gl.getUniformLocation(prog, "smile"), 4); });

    // Smoothly eased parameters so changing mood or looking around never jumps.
    const cur = { breath: 1, head: 0, nodY: 0, sway: 6, blink: 0, lx: 0, ly: 0, smile: 0, joy: 0, walk: 0 };
    // Free movement: every few seconds new small targets for each layer (arms, head, gaze, weight), eased slowly,
    // so she never holds one pose — shifts her weight, lets an arm drift, glances around, tilts her head.
    const drift = { armL: 0, armR: 0, head: 0, nod: 0, lx: 0, ly: 0 };
    const goal = { armL: 0, armR: 0, head: 0, nod: 0, lx: 0, ly: 0 };
    let nextDrift = 0, nextGlance = 0, lastFrame = performance.now(), drawn = 0;
    let nextBlink = performance.now() + 2500, blinkStart = -1;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // ?pet=1&blink=0.5 holds the closed-eye cross-fade at a fixed amount (only with eyes-closed.webp)
    const q = new URLSearchParams(window.location.search);
    const forced = { blink: q.has("blink") ? Math.min(1, Math.max(0, Number(q.get("blink")) || 0)) : undefined,
      smile: q.has("smile") ? Math.min(1, Math.max(0, Number(q.get("smile")) || 0)) : undefined };
    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!ready) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      const t = reduce ? 0 : now / 1000;
      const { mood: m, look: l, walking: walkingNow, lookAt } = state.current;
      const calm = m === "sleep" || m === "drag";
      if (now > nextDrift) {
        nextDrift = now + 1800 + Math.random() * 3200;
        const r = (a: number) => (Math.random() * 2 - 1) * a;
        const lively = m === "happy" || m === "love" || m === "wave" ? 1.6 : m === "work" || m === "think" ? .6 : 1;
        goal.armL = calm ? 0 : r(.07 * lively) + (Math.random() < .18 ? .12 : 0);
        goal.armR = calm ? 0 : r(.07 * lively) - (Math.random() < .18 ? .12 : 0);
        goal.head = calm ? 0 : r(.045 * lively);
        goal.nod = calm ? 0 : r(2.2);
      }
      if (now > nextGlance) {
        nextGlance = now + 900 + Math.random() * 2600;
        // quick glance somewhere, often back to you
        const back = Math.random() < .4;
        goal.lx = back ? 0 : (Math.random() * 2 - 1) * .9; goal.ly = back ? 0 : (Math.random() * 2 - 1) * .5;
      }
      const dk = .025;
      for (const k of ["armL", "armR", "head", "nod"] as const) drift[k] += (goal[k] - drift[k]) * dk;
      drift.lx += (goal.lx - drift.lx) * .14; drift.ly += (goal.ly - drift.ly) * .14; // eyes move fast, like real glances
      const M = MOTION[m] || MOTION.idle;
      const ease = (a: number, b: number, k = .08) => a + (b - a) * k;
      cur.walk = ease(cur.walk, walkingNow ? 1 : 0, .1);
      // automatic blinking (sometimes twice), unless the mood keeps her eyes shut
      let blinkTarget = M.blink ?? 0;
      if (M.blink === undefined) {
        if (blinkStart < 0 && now > nextBlink) blinkStart = now;
        if (blinkStart >= 0) {
          // ~140 ms, shut for most of it: a cross-fade blink must not linger half-way (that would look doubled)
          const k = (now - blinkStart) / 140;
          blinkTarget = k < 1 ? Math.min(1, Math.sin(k * Math.PI) * 2.2) : 0;
          if (k >= 1) { blinkStart = -1; nextBlink = now + (Math.random() < .2 ? 180 : 2200 + Math.random() * 4200); }
        }
      }
      // gesture on top of the mood's motion
      let pose: Pose = {};
      const act = playing.current;
      if (act) {
        const p = (now - act.start) / ACTIONS[act.name].ms;
        if (p >= 1) playing.current = null; else pose = ACTIONS[act.name].pose(p);
      }
      const smiley = m === "happy" || m === "love" || m === "wave" || m === "eat";
      cur.smile = ease(cur.smile, forced.smile ?? Math.max(smiley ? 1 : 0, pose.smile || 0), .1);
      // happy / love: a closed-eye smile (eyes shut softly, then open again while still smiling)
      cur.joy = ease(cur.joy, m === "happy" || m === "love" ? 1 : 0, .12);
      cur.blink = M.blink !== undefined ? ease(cur.blink, blinkTarget, .06) : Math.max(blinkTarget, cur.joy > .05 ? Math.min(1, cur.joy * 1.1) : 0);
      cur.breath = ease(cur.breath, M.breath); cur.nodY = ease(cur.nodY, M.nodY, .05); cur.sway = ease(cur.sway, M.sway, .05);
      const headTarget = M.headSpeed ? M.head * Math.sin(t * M.headSpeed) : M.head;
      cur.head = ease(cur.head, headTarget + (M.look ? 0 : l.x * .03), .06);
      const pointerRecent = now - lookAt < 4000;
      const [tx, ty] = pose.lookX !== undefined || pose.lookY !== undefined ? [pose.lookX ?? 0, pose.lookY ?? 0] : M.look || (pointerRecent ? [l.x, l.y] : [drift.lx, drift.ly]);
      cur.lx = ease(cur.lx, tx, .12); cur.ly = ease(cur.ly, ty, .12);
      gl.uniform1f(U.t, t);
      gl.uniform1f(U.breath, cur.breath * (Math.sin(t * M.breathSpeed) * .5 + .5));
      gl.uniform1f(U.sway, reduce ? 0 : cur.sway);

      // ongoing touches per mood: the circle turns slowly while she thinks or works, the skirt always moves a little
      const baseOrb = m === "think" || m === "work" ? t * 0.6 : t * 0.12;
      const baseGlow = m === "think" || m === "work" ? 0.35 + 0.2 * Math.sin(t * 2.2) : 0.1 + 0.07 * Math.sin(t * 1.3);
      // walking: arms swing in turn, a small bob each step, head nods along
      const stepPhase = t * 7.5, wk = cur.walk;
      const walkArm = Math.sin(stepPhase) * .11 * wk, walkBob = Math.abs(Math.sin(stepPhase)) * 4 * wk;
      // typing at the desk while working
      const typing = m === "work" ? Math.sin(t * 13) * .018 + Math.sin(t * 7.3) * .012 : 0;
      const free = act ? .35 : 1; // gestures take over, the drift fades back a little
      gl.uniform1f(U.head, cur.head + (pose.head || 0) + drift.head * free + Math.sin(stepPhase * 2) * .012 * wk);
      gl.uniform1f(U.nodY, cur.nodY + (pose.nodY || 0) + drift.nod * free);
      gl.uniform1f(U.armR, (pose.armR || 0) + drift.armR * free + walkArm + typing + Math.sin(t * M.breathSpeed) * 0.012 * cur.breath);
      gl.uniform1f(U.armL, (pose.armL || 0) + drift.armL * free + walkArm - typing - Math.sin(t * M.breathSpeed + .6) * 0.012 * cur.breath);
      gl.uniform1f(U.orbSpin, reduce ? 0 : baseOrb + (pose.orb || 0));
      gl.uniform1f(U.glow, baseGlow + (pose.glow || 0));
      gl.uniform1f(U.skirt, reduce ? 0 : 2.2 * cur.sway / 6 + (pose.skirt || 0) + Math.sin(stepPhase) * 6 * wk);
      gl.uniform1f(U.ear, (pose.ear || 0) + (reduce ? 0 : Math.sin(t * 1.9) * 0.06));
      gl.uniform1f(U.lift, (pose.lift || 0) + walkBob); gl.uniform1f(U.squash, pose.squash || 0);
      gl.uniform1f(U.blink, hasClosed ? forced.blink ?? Math.max(cur.blink, pose.blink || 0) : 0); gl.uniform1f(U.hasClosed, hasClosed ? 1 : 0);
      gl.uniform1f(U.smiling, hasSmile ? cur.smile : 0); gl.uniform1f(U.hasSmile, hasSmile ? 1 : 0);
      gl.uniform1f(U.lookX, cur.lx); gl.uniform1f(U.lookY, cur.ly);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      // base first, then the arms on top, each with its own texture
      lastFrame = now;
      if (layers[0]) drawn += 1;
      layers.forEach((tex, i) => {
        if (!tex) return;
        gl.activeTexture(gl.TEXTURE0 + [0, 2, 3][i]); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(U.img, [0, 2, 3][i]); gl.uniform1f(U.layer, i);
        gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
      });
    };
    raf = requestAnimationFrame(frame);
    // Some hosts (the Android floating pet) throttle or stop requestAnimationFrame; keep her moving with a timer
    // then, and show the still picture if nothing could be drawn at all — she must never be invisible.
    const floating = new URLSearchParams(window.location.search).has("overlay");
    const keepAlive = window.setInterval(() => {
      if (!alive || (document.hidden && !floating)) return;
      const now = performance.now();
      if (now - lastFrame > 250) { cancelAnimationFrame(raf); frame(now); }
    }, 60);
    const watchdog = window.setTimeout(() => {
      if (drawn === 0 && fallback.current) { cv.style.display = "none"; fallback.current.style.display = "block"; }
    }, 4000);
    // Pause when hidden (minimised window, background tab).
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(frame); };
    document.addEventListener("visibilitychange", vis);
    cv.addEventListener("webglcontextlost", () => { cv.style.display = "none"; if (fallback.current) fallback.current.style.display = "block"; });
    return () => { alive = false; cancelAnimationFrame(raf); window.clearInterval(keepAlive); window.clearTimeout(watchdog); document.removeEventListener("visibilitychange", vis); };
  }, [src]);

  return <>
    <canvas ref={canvas} className="pet-live" aria-hidden="true"/>
    <img ref={fallback} src={src} alt="" draggable={false} style={{ display: "none" }}/>
  </>;
}
