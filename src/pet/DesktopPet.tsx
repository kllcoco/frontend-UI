import { useEffect, useRef, useState } from "react";
import Chibi from "./Chibi";
import LivePet from "./LivePet";
import { IDLE_ACTIONS } from "./LivePet";
import type { PetAction } from "./LivePet";
import type { Mood } from "./Chibi";
import { desktop } from "../lib/desktop";
import { androidPetBridge } from "./android-bridge";
import { loadLanguage, translate } from "../lib/i18n";
import { bubbleText, PET_MOODS, setPetEnabled } from "../lib/pet";
import type { PetCommand, PetEdge, PetProgress, PetStream } from "../lib/pet";

/* Ciro pet. Desktop app: its own transparent always-on-top window (?pet=1). Web / Android: `inline`,
   a small draggable Ciro floating over the app.
   Click: happy · stroke her head: shy · poke 5× quickly: angry · leave her alone: falls asleep ·
   double-click: quick ask · right-click: menu · drag anywhere. She thinks while Ciro is answering
   and tells you when the answer is ready. Artwork: put PNGs in public/pet/ and list them in
   public/pet/pet.json ({"states":{"idle":"idle.png","happy":"happy.png",...}}) to replace the drawing. */
type Art = Partial<Record<Mood, string>>;
const SLEEP_AFTER = 3 * 60_000;

function greeting(t: (s: string) => string): string {
  const h = new Date().getHours();
  if (h < 5) return t("这么晚还没睡吗？我陪着你。");
  if (h < 11) return t("早上好，今天也一起加油吧。");
  if (h < 14) return t("中午了，记得吃饭哦。");
  if (h < 18) return t("下午好，要一起工作吗？");
  if (h < 23) return t("辛苦了，休息一下吧。");
  return t("夜深了，早点休息吧。");
}

const INLINE_POS = "ciro.pet-pos.v1";
const INLINE_SCALE = "ciro.pet-scale.v1";
const INLINE_EDGE = "ciro.pet-edge.v1";
export const MIN_SCALE = .5, MAX_SCALE = 1.6;
/** Touch screens: the edges belong to system gestures (status bar pull-down, home / back swipes). She hides
 *  behind a line this far inside them, so she can always be touched and dragged again. */
function gutters(): { side: number; top: number; bottom: number } {
  if (!window.matchMedia?.("(pointer: coarse)").matches) return { side: 0, top: 0, bottom: 0 };
  let safeTop = 0, safeBottom = 0;
  try {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe); safeTop = parseFloat(cs.paddingTop) || 0; safeBottom = parseFloat(cs.paddingBottom) || 0;
    probe.remove();
  } catch { /* no env() support */ }
  return { side: 30, top: safeTop + 48, bottom: safeBottom + 60 };
}
/** In-app position (right / bottom offsets) for hiding at an edge. */
function edgePos(edge: Exclude<PetEdge, null>, w: number, h: number, p: { x: number; y: number }) {
  const g = gutters(), W = window.innerWidth, H = window.innerHeight;
  const midY = Math.max(g.bottom, Math.min(H - h - g.top, p.y)), midX = Math.max(g.side, Math.min(W - w - g.side, p.x));
  return edge === "right" ? { x: g.side, y: midY } : edge === "left" ? { x: W - w - g.side, y: midY }
    : edge === "bottom" ? { x: midX, y: g.bottom } : { x: midX, y: H - h - g.top };
}
/** Inside the app and, on touch screens, away from the system gesture areas. */
function keepIn(p: { x: number; y: number }, w: number, h: number) {
  const g = gutters();
  return { x: Math.max(g.side, Math.min(window.innerWidth - w - g.side, p.x)), y: Math.max(g.bottom, Math.min(window.innerHeight - h - g.top, p.y)) };
}
const clampScale = (v: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v)) * 100) / 100;
function stored(key: string): string { try { return localStorage.getItem(key) || ""; } catch { return ""; } }
function store(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* storage off */ } }
function savedPos(): { x: number; y: number } | null {
  try { const p = JSON.parse(localStorage.getItem(INLINE_POS) || "null"); return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null; } catch { return null; }
}

export default function DesktopPet({ inline = false, onAsk }: { inline?: boolean; onAsk?: () => void }) {
  const language = loadLanguage();
  const t = (s: string) => translate(language, s);
  const bridge = inline ? undefined : desktop()?.pet ?? androidPetBridge();
  // Inline: where the pet sits inside the app (right / bottom offsets in px), dragged with the finger or mouse.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => savedPos() || { x: 12, y: 150 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const query = new URLSearchParams(window.location.search);
  // Size (pinch with two fingers, Ctrl / trackpad pinch or the wheel over her) and the screen edge she hides behind.
  const [scale, setScale] = useState(() => clampScale(Number(inline ? stored(INLINE_SCALE) : query.get("scale")) || (inline ? .85 : .8)));
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [edge, setEdge] = useState<PetEdge>(() => {
    const e = inline ? stored(INLINE_EDGE) : query.get("edge") || "";
    return e === "left" || e === "right" || e === "bottom" || e === "top" ? e : null;
  });
  const edgeRef = useRef(edge);
  edgeRef.current = edge;
  const [peeking, setPeeking] = useState(false);
  // Strolling along the bottom of the screen (or the app) now and then; she faces where she is going.
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const walkTimer = useRef(0);
  const walkingRef = useRef(false);
  // The reply Ciro is writing, mirrored in a larger bubble above her.
  const [reply, setReply] = useState<PetStream | null>(null);
  const replyRef = useRef<PetStream | null>(null);
  replyRef.current = reply;
  const replyBox = useRef<HTMLDivElement>(null);
  const replyHover = useRef(false);
  const replyTimer = useRef(0);
  const closeReply = () => { window.clearTimeout(replyTimer.current); setReply(null); if (!inline) bridge?.expand?.(false); };
  // Pinch: the first finger is on her, the second may land anywhere on the screen.
  const pinch = useRef<{ start: number; from: number } | null>(null);
  const touchingPet = useRef(false);
  const [mood, setMood] = useState<Mood>("wave");
  const [say, setSay] = useState<string>(() => greeting(t));
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [menu, setMenu] = useState(false);
  const [art, setArt] = useState<Art | null>(null);
  const moodTimer = useRef(0), sayTimer = useRef(0), progressTimer = useRef(0);
  const lastActive = useRef(Date.now());
  const busy = useRef(false);
  // Body gestures (wave, nod, jump…) played by the live artwork on top of the mood.
  const [gesture, setGesture] = useState<{ name: PetAction; id: number } | null>(null);
  const play = (name: PetAction) => setGesture({ name, id: Date.now() + Math.random() });
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  const commanded = useRef(0);
  const pokes = useRef<number[]>([]);
  const stroke = useRef({ dist: 0, at: 0 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moving: boolean; ox: number; oy: number } | null>(null);
  const sprite = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;

  /** Show a mood for a while, then go back to idle (or to thinking while Ciro is still answering). */
  const act = (next: Mood, ms = 2600) => {
    window.clearTimeout(moodTimer.current);
    setMood(next);
    if (ms > 0) moodTimer.current = window.setTimeout(() => setMood(busy.current ? "think" : "idle"), ms);
  };
  const speak = (text: string, ms = 4200) => {
    window.clearTimeout(sayTimer.current);
    setSay(text);
    if (ms > 0) sayTimer.current = window.setTimeout(() => setSay(""), ms);
  };
  /** Work / background progress: she shows it in her bubble (and peeks out from the edge to tell you). */
  function progressed(p: PetProgress) {
    stopWalk();
    lastActive.current = Date.now();
    if (!p || !p.text) return;
    if (replyRef.current && !replyRef.current.done && p.source === "chat") return;
    // Work mode on the computer: she comes out from the edge and works along.
    if (p.source === "work" && !p.done && edgeRef.current) { setEdge(null); if (inline) store(INLINE_EDGE, ""); else bridge?.unedge?.(); }
    if (edgeRef.current) { setPeeking(true); window.setTimeout(() => setPeeking(false), p.done ? 5200 : 3600); }
    const text = p.text + (typeof p.percent === "number" ? " " + Math.round(p.percent) + "%" : "");
    if (p.done) { busy.current = false; act(p.ok === false ? "sad" : "happy", 3600); play(p.ok === false ? "shake" : pick<PetAction>(["nod", "jump", "sparkle"])); speak(text, 6500); return; }
    if (p.attention) { act("wave", 4000); play("wave"); speak(text, 0); return; }
    if (moodRef.current !== "work" && moodRef.current !== "think") act("work", 0);
    speak(text, 0);
    window.clearTimeout(progressTimer.current);
    // No news for a while: stop showing the last step.
    progressTimer.current = window.setTimeout(() => { setSay(""); if (!busy.current) act("idle", 0); }, 45_000);
  }
  function streamed(r: PetStream) {
    stopWalk();
    if (!r || typeof r.text !== "string") return;
    lastActive.current = Date.now();
    if (!replyRef.current && !inline) bridge?.expand?.(true);
    window.clearTimeout(replyTimer.current);
    r = { ...r, text: bubbleText(r.text).slice(-4000) };
    setReply(r);
    setSay("");
    if (edgeRef.current) setPeeking(true);
    if (r.done) {
      if (edgeRef.current) window.setTimeout(() => setPeeking(false), 6000);
      // Stays a while (longer for long answers), and as long as the pointer is on it.
      const keep = Math.min(40_000, 9000 + r.text.length * 40);
      const later = () => { replyTimer.current = window.setTimeout(() => { if (replyHover.current) later(); else closeReply(); }, keep); };
      later();
    }
  }
  function signalled({ signal, focused }: { signal: string; focused: boolean }) {
    lastActive.current = Date.now();
    if (signal === "thinking") { busy.current = true; act("think", 0); if (!replyRef.current) speak("…", 0); play("magic"); }
    // The model's own reaction (its <pet> tag) wins over the generic "done" one.
    else if (signal === "done" && (Date.now() - commanded.current < 3000 || replyRef.current)) { busy.current = false; if (replyRef.current && Date.now() - commanded.current >= 3000) { act("happy", 2600); play(pick<PetAction>(["nod", "sparkle"])); } }
    else if (signal === "done") { busy.current = false; act("happy", 3200); play(pick<PetAction>(["nod", "jump", "wave"])); speak(focused ? t("好啦～") : t("回答好了，去看看吧。"), focused ? 2000 : 6000); }
    else if (signal === "error") { busy.current = false; act("sad", 3200); speak(t("出错了……再试一次吧。"), 4200); }
  }
  const wake = () => { lastActive.current = Date.now(); if (moodRef.current === "sleep") { act("idle", 0); speak(t("唔……我醒着呢。"), 2400); } };

  useEffect(() => {
    if (!inline) document.documentElement.classList.add("pet-page");
    // ?pet=1&mood=shy shows one expression (artwork previews and screenshots).
    const preview = new URLSearchParams(window.location.search).get("mood") as Mood | null;
    const previewAction = new URLSearchParams(window.location.search).get("action") as PetAction | null;
    if (preview && PET_MOODS.includes(preview)) { act(preview, 0); setSay(""); }
    else { act("wave", 3200); speak(greeting(t), 5200); window.setTimeout(() => play("wave"), 400); }
    if (previewAction) window.setTimeout(() => play(previewAction), 300);
    // ?pet=1&demo=reply shows the reply bubble, &demo=progress a work step (previews and screenshots)
    const demo = new URLSearchParams(window.location.search).get("demo");
    if (demo === "reply") window.setTimeout(() => streamed({ id: "demo", text: t("好的！这是一个示例回答：桌宠会在气泡里同步显示 Ciro 正在写的内容，写完后停留一会儿，你也可以滚动查看全文。"), done: false }), 200);
    if (demo === "progress") window.setTimeout(() => progressed({ text: t("正在运行 npm test"), source: "work" }), 200);
    // Optional artwork images replace the drawing.
    fetch("/pet/pet.json", { cache: "no-store" }).then(async (r) => {
      if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return;
      const data = await r.json() as { states?: Record<string, string> };
      const states: Art = {};
      for (const [k, v] of Object.entries(data.states || {})) if (/^[\w.-]+\.(png|webp|gif)$/i.test(v)) states[k as Mood] = "/pet/" + v;
      if (states.idle) setArt(states);
    }).catch(() => {});
    // Blinking.
    let blinkTimer = 0;
    const scheduleBlink = () => { blinkTimer = window.setTimeout(() => { setBlink(true); window.setTimeout(() => setBlink(false), 140); scheduleBlink(); }, 2600 + Math.random() * 3800); };
    scheduleBlink();
    // Falls asleep when left alone; now and then says something or works on her laptop.
    // Idle life every 12–24 s: a small gesture, now and then a line, a snack at meal times, a nap when left alone.
    let lifeTimer = 0;
    const live = () => {
      lifeTimer = window.setTimeout(live, 12_000 + Math.random() * 12_000);
      if (busy.current || drag.current || pinch.current || walkingRef.current || moodRef.current === "sleep" || moodRef.current === "work") return;
      if (Date.now() - lastActive.current > SLEEP_AFTER) { act("sleep", 0); speak("Zzz…", 0); return; }
      const roll = Math.random();
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      const meal = (hour >= 11.5 && hour < 13) || (hour >= 17.5 && hour < 19);
      // Hidden at the edge: she only peeks out and looks around.
      if (edgeRef.current) { if (roll < .4) { setPeeking(true); play(pick<PetAction>(["lookaround", "peek", "giggle"])); window.setTimeout(() => setPeeking(false), 2600); } return; }
      if (meal && roll < .08) { act("eat", 15_000); speak(t("我先吃点东西～你也记得吃饭。"), 4200); }
      else if (roll < .04) { act("work", 20_000); speak(t("我也来认真工作一会儿。"), 3600); }
      else if (roll < .3 && !replyRef.current) stroll();
      else if (roll < .66) play(pick<PetAction>(IDLE_ACTIONS));
      else if (roll < .7) speak([t("我一直在这里。"), t("要一起工作吗？"), greeting(t), t("有什么想问的，双击我就好。"), t("把我拖到屏幕边上，我就躲起来。")][Math.floor(Math.random() * 5)], 4200);
    };
    lifeTimer = window.setTimeout(live, 8000);
    // The model's <pet> tag: a mood and a line.
    const command = (cmd: PetCommand) => {
      lastActive.current = Date.now();
      commanded.current = Date.now();
      const mood = cmd.mood && PET_MOODS.includes(cmd.mood) ? cmd.mood : undefined;
      if (mood) act(mood, mood === "sleep" ? 0 : 4200);
      if (cmd.say) speak(cmd.say, 5200);
      if (cmd.action) play(cmd.action as PetAction);
    };
    const onWindowCommand = (e: Event) => { if (inline) command((e as CustomEvent<PetCommand>).detail || {}); };
    const onWindowSignal = (e: Event) => { if (inline) signalled((e as CustomEvent<{ signal: string; focused: boolean }>).detail); };
    const onWindowProgress = (e: Event) => { if (inline) progressed((e as CustomEvent<PetProgress>).detail); };
    // In the app the reply is already on screen when its chat is open; she only mirrors it when you are elsewhere.
    const onWindowStream = (e: Event) => {
      const r = (e as CustomEvent<PetStream>).detail;
      if (!inline || !r) return;
      if (r.onScreen && !replyRef.current) return;
      streamed(r);
    };
    window.addEventListener("ciro-pet-stream", onWindowStream);
    const offStream = bridge?.onStream?.(streamed);
    window.addEventListener("ciro-pet-progress", onWindowProgress);
    const offProgress = bridge?.onProgress?.(progressed);
    const offEdge = bridge?.onEdge?.((e) => { setEdge(e); if (e) { act("shy", 2200); speak(t("我躲在这里哦。"), 2400); } });
    window.addEventListener("ciro-pet", onWindowCommand);
    window.addEventListener("ciro-pet-signal", onWindowSignal);
    const offCommand = bridge?.onCommand?.((cmd) => command(cmd as PetCommand));
    // Inline: eyes follow the mouse inside the app.
    const onMove = (e: MouseEvent) => {
      const box = sprite.current?.getBoundingClientRect();
      if (!box) return;
      const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height * .4), d = Math.hypot(dx, dy) || 1;
      setLook({ x: dx / Math.max(d, 60), y: dy / Math.max(d, 60) });
    };
    if (inline) window.addEventListener("mousemove", onMove);
    const offCursor = bridge?.onCursor((p) => {
      // Eyes follow the mouse; normalised direction from her face (window coords ~ (115, 150)).
      const dx = p.x - 115, dy = p.y - 150, d = Math.hypot(dx, dy) || 1;
      setLook({ x: dx / Math.max(d, 60), y: dy / Math.max(d, 60) });
    });
    const offSignal = bridge?.onSignal(signalled);
    return () => {
      window.clearTimeout(blinkTimer); window.clearTimeout(lifeTimer); window.clearTimeout(walkTimer.current); walkingRef.current = false; window.clearTimeout(progressTimer.current); offCursor?.(); offSignal?.(); offCommand?.();
      window.removeEventListener("ciro-pet", onWindowCommand); window.removeEventListener("ciro-pet-progress", onWindowProgress); offProgress?.(); offEdge?.();
      window.removeEventListener("ciro-pet-stream", onWindowStream); offStream?.(); window.clearTimeout(replyTimer.current); window.removeEventListener("ciro-pet-signal", onWindowSignal);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Settings → 桌宠 → 回到默认位置
  useEffect(() => {
    if (!inline) return;
    const reset = () => { setEdge(null); setScale(inline ? .85 : .8); scaleRef.current = .85; setPos({ x: 12, y: 150 }); act("happy", 2000); play("jump"); speak(t("我回来啦。"), 2200); };
    window.addEventListener("ciro-pet-reset", reset);
    return () => window.removeEventListener("ciro-pet-reset", reset);
  }, []);
  // In the app: a place saved by an older version may sit in a system gesture area; move it out once laid out.
  useEffect(() => {
    if (!inline) return;
    const id = window.setTimeout(() => {
      const box = rootRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = edgeRef.current ? edgePos(edgeRef.current, box.width, box.height, posRef.current) : keepIn(posRef.current, box.width, box.height);
      if (next.x !== posRef.current.x || next.y !== posRef.current.y) { setPos(next); store(INLINE_POS, JSON.stringify(next)); }
    }, 300);
    return () => window.clearTimeout(id);
  }, []);

  // Follow the text as it is written, unless you scrolled up to read.
  useEffect(() => {
    const el = replyBox.current;
    if (el && !replyHover.current) el.scrollTop = el.scrollHeight;
  }, [reply?.text]);

  // Click-through everywhere except on her (and the menu / bubble while shown).
  const hover = (over: boolean) => { if (!drag.current) bridge?.setIgnore(!over && !menu); };
  useEffect(() => { if (menu) bridge?.setIgnore(false); }, [menu]);

  /** A short walk left or right (60–220 px), staying on the screen / inside the app. */
  function stroll() {
    if (walkingRef.current || edgeRef.current) return;
    const box = rootRef.current?.getBoundingClientRect();
    const w = box?.width || 160;
    let dir: 1 | -1 = Math.random() < .5 ? -1 : 1;
    let room: number;
    if (inline) room = dir > 0 ? posRef.current.x : window.innerWidth - w - posRef.current.x; // pos.x is the distance from the right
    else {
      const sx = window.screenX - ((window.screen as unknown as { availLeft?: number }).availLeft || 0);
      room = dir > 0 ? window.screen.availWidth - sx - w : sx;
      if (!Number.isFinite(room) || (sx === 0 && !window.screenX)) room = 160; // Android overlay: native keeps her on screen
    }
    if (room < 60) { dir = dir > 0 ? -1 : 1; room = 200; }
    const dist = Math.min(room, 60 + Math.random() * 160);
    walkingRef.current = true;
    setWalking(true); setFacing(dir);
    let done = 0;
    const speed = 1.6; // px per 30 ms ≈ 53 px/s
    const tick = () => {
      if (!walkingRef.current) return;
      const stepPx = Math.min(speed, dist - done);
      done += stepPx;
      const last = done >= dist - .01;
      if (inline) setPos((p) => ({ x: Math.max(0, Math.min(window.innerWidth - w, p.x - dir * stepPx)), y: p.y }));
      else bridge?.move?.(dir * stepPx, last);
      if (last) { stopWalk(); if (inline) store(INLINE_POS, JSON.stringify(posRef.current)); return; }
      walkTimer.current = window.setTimeout(tick, 30);
    };
    walkTimer.current = window.setTimeout(tick, 250);
  }
  function stopWalk() {
    window.clearTimeout(walkTimer.current);
    if (!walkingRef.current) return;
    walkingRef.current = false;
    setWalking(false);
    window.setTimeout(() => setFacing(1), 900);
  }

  /** While she is held (dragged / pinched) the page's own swipe gestures (sidebar, sheets) stand down. */
  const holding = (on: boolean) => { if (inline) { if (on) document.documentElement.dataset.petHold = "1"; else delete document.documentElement.dataset.petHold; } };

  /** New size: the window (desktop) or the floating box (in the app) follows. */
  const resize = (next: number) => {
    const v = clampScale(next);
    if (v === scaleRef.current) return;
    scaleRef.current = v;
    setScale(v);
    if (inline) store(INLINE_SCALE, String(v)); else bridge?.resize?.(v);
  };
  const leaveEdge = () => {
    if (!edgeRef.current) return;
    setEdge(null);
    if (inline) store(INLINE_EDGE, ""); else bridge?.unedge?.();
    act("happy", 2000); play("jump"); speak(t("被你发现了～"), 2400);
  };

  function onPointerDown(e: React.PointerEvent) {
    stopWalk();
    // Only the first finger drags; a second one (anywhere) turns it into a pinch, handled by the touch listeners below.
    if (!e.isPrimary || pinch.current) return;
    if (e.pointerType === "touch") touchingPet.current = true;
    holding(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button !== 0) return;
    wake();
    drag.current = { x: e.screenX, y: e.screenY, cx: e.clientX, cy: e.clientY, moving: false, ox: posRef.current.x, oy: posRef.current.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pinch.current || !e.isPrimary) return;
    const d = drag.current;
    if (d) {
      if (!d.moving && Math.hypot(e.screenX - d.x, e.screenY - d.y) > 4) {
        d.moving = true; bridge?.drag("start"); act("drag", 0); speak(t("哇，要带我去哪里？"), 0);
        if (edgeRef.current) { setEdge(null); if (inline) store(INLINE_EDGE, ""); }
      }
      if (d.moving) {
        // In the app she may be pulled partly past an edge; letting go there hides her behind it.
        const box = rootRef.current?.getBoundingClientRect();
        const w = box?.width || 150, h = box?.height || 200;
        if (inline) setPos({ x: Math.max(-w * .6, Math.min(window.innerWidth - w * .4, d.ox - (e.screenX - d.x))), y: Math.max(-h * .5, Math.min(window.innerHeight - h * .7, d.oy - (e.screenY - d.y))) });
        else bridge?.drag("move", e.clientX - d.cx, e.clientY - d.cy);
      }
      return;
    }
    // Stroking her head (moving over the top half for a while) makes her shy.
    const box = sprite.current?.getBoundingClientRect();
    if (!box || e.clientY > box.top + box.height * .55) return;
    const now = Date.now();
    const s = stroke.current;
    s.dist = now - s.at > 600 ? 0 : s.dist + Math.abs(e.movementX) + Math.abs(e.movementY);
    s.at = now;
    if (s.dist > 420 && moodRef.current !== "shy") { s.dist = 0; wake(); act("shy", 3000); speak(t("唔……别、别一直摸啦。"), 3000); }
  }
  /** The system took the touch (edge swipe, notification shade…): forget it. */
  function onPointerCancel(_e: React.PointerEvent) {
    touchingPet.current = false;
    holding(false);
    const d = drag.current;
    drag.current = null;
    if (d?.moving) { if (inline) { const box = rootRef.current?.getBoundingClientRect(); const next = keepIn(posRef.current, box?.width || 150, box?.height || 200); setPos(next); store(INLINE_POS, JSON.stringify(next)); } else bridge?.drag("end"); act("idle", 0); setSay(""); }
  }
  function onPointerUp(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!e.isPrimary) return;
    touchingPet.current = false;
    if (!pinch.current) holding(false);
    if (pinch.current) { drag.current = null; return; }
    const d = drag.current;
    drag.current = null;
    if (d?.moving) {
      if (inline) {
        const box = rootRef.current?.getBoundingClientRect();
        const w = box?.width || 150, h = box?.height || 200;
        const p = posRef.current;
        const hide: PetEdge = p.x < -w * .3 ? "right" : p.x > window.innerWidth - w * .7 ? "left" : p.y < -h * .25 ? "bottom"
          : p.y > window.innerHeight - h * 1.02 ? "top" : null;
        const next = hide ? edgePos(hide, w, h, p) : keepIn(p, w, h);
        setPos(next);
        store(INLINE_POS, JSON.stringify(next));
        if (hide) { setEdge(hide); store(INLINE_EDGE, hide); act("shy", 2200); speak(t("我躲在这里哦。"), 2400); return; }
      }
      else bridge?.drag("end");
      act("happy", 1600); speak(t("这里不错。"), 2200); play("bow"); return; }
    if (!d) return;
    if (edgeRef.current) { leaveEdge(); return; }
    const now = Date.now();
    pokes.current = [...pokes.current.filter((x) => now - x < 1600), now];
    if (pokes.current.length >= 5) { pokes.current = []; act("angry", 2800); speak(t("别戳啦！"), 2600); play("shake"); return; }
    act(Math.random() < .3 ? "love" : "happy", 2200);
    play(pick<PetAction>(["wave", "nod", "jump", "spin", "magic", "giggle", "sparkle"]));
    speak([t("嗯？"), t("我在哦。"), t("找我有事吗？"), t("嘿嘿。")][Math.floor(Math.random() * 4)], 2400);
  }
  // Two-finger pinch: started with a finger on her, the second finger can be anywhere; she follows smoothly.
  useEffect(() => {
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    let frame = 0, want = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !touchingPet.current) return;
      const d = drag.current;
      if (d?.moving && !inline) bridge?.drag("end");
      drag.current = null;
      pinch.current = { start: dist(e.touches), from: scaleRef.current };
      act("shy", 0); setSay("");
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      const p = pinch.current;
      if (!p || e.touches.length < 2) return;
      e.preventDefault();
      want = p.from * dist(e.touches) / p.start;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; resize(want); });
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) { touchingPet.current = false; holding(false); }
      if (pinch.current && e.touches.length < 2) { pinch.current = null; act("happy", 1600); speak(t("这个大小刚刚好。"), 1800); }
    };
    document.addEventListener("touchstart", onStart, { passive: false, capture: true });
    document.addEventListener("touchmove", onMove, { passive: false, capture: true });
    document.addEventListener("touchend", onEnd, true);
    document.addEventListener("touchcancel", onEnd, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("touchstart", onStart, true); document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", onEnd, true); document.removeEventListener("touchcancel", onEnd, true);
    };
  }, []);
  // Size from the settings slider (in the app, the desktop window and the Android floating pet).
  useEffect(() => {
    const onScale = (e: Event) => { const v = Number((e as CustomEvent<number>).detail); if (inline && Number.isFinite(v)) resize(v); };
    window.addEventListener("ciro-pet-scale", onScale);
    const off = bridge?.onScale?.((v) => { const c = clampScale(v); if (c !== scaleRef.current) { scaleRef.current = c; setScale(c); } });
    return () => { window.removeEventListener("ciro-pet-scale", onScale); off?.(); };
  }, []);
  // Mouse wheel / trackpad pinch (Ctrl+wheel) over her changes her size.
  useEffect(() => {
    const el = sprite.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && inline) return; // in the app the plain wheel keeps scrolling the chat
      e.preventDefault();
      resize(scaleRef.current * Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const shown: Mood = mood;
  const image = art ? (art[shown] || art.idle) : null;
  const run = (action: "open" | "quick" | "hide") => {
    setMenu(false);
    if (!inline) { bridge?.action(action); return; }
    if (action === "hide") setPetEnabled(false);
    else onAsk?.();
  };

  return <div ref={rootRef} className={(inline ? "pet-root pet-root--inline" : "pet-root") + (edge ? " pet-root--edge pet-root--edge-" + edge : "") + (peeking ? " pet-root--peek" : "") + (reply ? " pet-root--reply" : "") + (walking ? " pet-root--walk" : "") + (facing < 0 ? " pet-root--face-left" : "")}
    onMouseLeave={() => hover(false)}
    style={{ ...(inline ? { right: pos.x, bottom: pos.y } : {}), ["--pet-scale" as string]: scale }}>
    {reply && <div className={"pet-reply" + (reply.error ? " pet-reply--error" : "")} role="log" aria-live="polite" aria-label={t("Ciro 的回答")}
      onMouseEnter={() => { replyHover.current = true; hover(true); }} onMouseLeave={() => { replyHover.current = false; hover(false); }}>
      <div ref={replyBox} className="pet-reply-text">{reply.text || "…"}{!reply.done && <i className="pet-caret"/>}</div>
      <div className="pet-reply-bar">
        {reply.done ? <span>{t(reply.error ? "出错了" : "回答完成")}</span> : <span className="pet-reply-live">{t("正在回答…")}</span>}
        <button type="button" onClick={() => { closeReply(); if (inline) onAsk?.(); else bridge?.action("open"); }}>{t(inline ? "去看看" : "打开")}</button>
        <button type="button" aria-label={t("关闭")} onClick={closeReply}>×</button>
      </div>
    </div>}
    {!reply && say && <div className={"pet-say" + (say === "…" ? " pet-say--dots" : "")} role="status" onMouseEnter={() => hover(true)}>{say}</div>}
    {menu && <div className="pet-menu" role="menu" onMouseEnter={() => hover(true)}>
      <button type="button" role="menuitem" onClick={() => run("quick")}>{t("快速提问")}</button>
      {!inline && <button type="button" role="menuitem" onClick={() => run("open")}>{t("打开 Ciro")}</button>}
      <button type="button" role="menuitem" onClick={() => { setMenu(false); act("sleep", 0); speak("Zzz…", 0); }}>{t("让她睡一会儿")}</button>
      {edge ? <button type="button" role="menuitem" onClick={() => { setMenu(false); leaveEdge(); }}>{t("出来吧")}</button>
        : !inline && <button type="button" role="menuitem" onClick={() => { setMenu(false); bridge?.toEdge?.(); }}>{t("躲到屏幕边上")}</button>}
      <button type="button" role="menuitem" onClick={() => { setMenu(false); resize(scaleRef.current > .75 ? .65 : 1); }}>{t(scale > .75 ? "缩小一点" : "放大一点")}</button>
      <button type="button" role="menuitem" onClick={() => run("hide")}>{t("隐藏桌宠")}</button>
    </div>}
    <div ref={sprite} className={"pet-sprite pet-sprite--" + shown + (image ? " pet-sprite--art" : "")} aria-label="Ciro" role="img"
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={() => { act("happy", 1600); speak(t("想问什么？"), 2000); play("magic"); if (inline) onAsk?.(); else bridge?.action("quick"); }}
      onContextMenu={(e) => { e.preventDefault(); wake(); setMenu((v) => !v); }}>
      {image ? <LivePet src={image} mood={shown} look={look} action={gesture} walking={walking}/> : <Chibi mood={shown} blink={blink} look={look}/>}
      {(shown === "happy" || shown === "love") && <span className="pet-fx pet-heart">♥</span>}
      {shown === "sleep" && <span className="pet-fx pet-zzz">z<i>z</i><b>z</b></span>}
      {/* With artwork the face is never repainted: moods show as motion plus a small sign by her head. */}
      {image && shown === "angry" && <svg className="pet-fx pet-sign pet-anger" viewBox="0 0 24 24"><path d="M9 3v5H4M15 3v5h5M9 21v-5H4M15 21v-5h5" stroke="#e0505a" strokeWidth="2.6" fill="none" strokeLinecap="round"/></svg>}
      {image && shown === "sad" && <svg className="pet-fx pet-sign pet-drop" viewBox="0 0 24 24"><path d="M12 3c3 5 6 8.5 6 12a6 6 0 0 1-12 0c0-3.5 3-7 6-12z" fill="#8fc3ec" stroke="#5d9ccc" strokeWidth="1.2"/></svg>}
      {image && shown === "shy" && <span className="pet-fx pet-sign pet-shy">♡</span>}
      {image && shown === "eat" && <svg className="pet-fx pet-sign pet-eat" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#e2a85b" stroke="#a8722c"/><circle cx="9" cy="10" r="1.2" fill="#6b3f17"/><circle cx="14" cy="9" r="1.1" fill="#6b3f17"/><circle cx="13" cy="14.5" r="1.2" fill="#6b3f17"/></svg>}
      {image && shown === "think" && <span className="pet-fx pet-sign pet-think">?</span>}
    </div>
  </div>;
}
