import { useEffect, useRef, useState } from "react";
import Chibi from "./Chibi";
import type { Mood } from "./Chibi";
import { desktop } from "../lib/desktop";
import { loadLanguage, translate } from "../lib/i18n";
import { PET_MOODS, setPetEnabled } from "../lib/pet";
import type { PetCommand } from "../lib/pet";

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
function savedPos(): { x: number; y: number } | null {
  try { const p = JSON.parse(localStorage.getItem(INLINE_POS) || "null"); return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null; } catch { return null; }
}

export default function DesktopPet({ inline = false, onAsk }: { inline?: boolean; onAsk?: () => void }) {
  const language = loadLanguage();
  const t = (s: string) => translate(language, s);
  const bridge = inline ? undefined : desktop()?.pet;
  // Inline: where the pet sits inside the app (right / bottom offsets in px), dragged with the finger or mouse.
  const [pos, setPos] = useState<{ x: number; y: number }>(() => savedPos() || { x: 12, y: 150 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const [mood, setMood] = useState<Mood>("wave");
  const [say, setSay] = useState<string>(() => greeting(t));
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [menu, setMenu] = useState(false);
  const [art, setArt] = useState<Art | null>(null);
  const moodTimer = useRef(0), sayTimer = useRef(0);
  const lastActive = useRef(Date.now());
  const busy = useRef(false);
  const commanded = useRef(0);
  const pokes = useRef<number[]>([]);
  const stroke = useRef({ dist: 0, at: 0 });
  const drag = useRef<{ x: number; y: number; moving: boolean; ox: number; oy: number } | null>(null);
  const sprite = useRef<HTMLDivElement>(null);
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
  function signalled({ signal, focused }: { signal: string; focused: boolean }) {
    lastActive.current = Date.now();
    if (signal === "thinking") { busy.current = true; act("think", 0); speak("…", 0); }
    // The model's own reaction (its <pet> tag) wins over the generic "done" one.
    else if (signal === "done" && Date.now() - commanded.current < 3000) busy.current = false;
    else if (signal === "done") { busy.current = false; act("happy", 3200); speak(focused ? t("好啦～") : t("回答好了，去看看吧。"), focused ? 2000 : 6000); }
    else if (signal === "error") { busy.current = false; act("sad", 3200); speak(t("出错了……再试一次吧。"), 4200); }
  }
  const wake = () => { lastActive.current = Date.now(); if (moodRef.current === "sleep") { act("idle", 0); speak(t("唔……我醒着呢。"), 2400); } };

  useEffect(() => {
    if (!inline) document.documentElement.classList.add("pet-page");
    // ?pet=1&mood=shy shows one expression (artwork previews and screenshots).
    const preview = new URLSearchParams(window.location.search).get("mood") as Mood | null;
    if (preview && PET_MOODS.includes(preview)) { act(preview, 0); setSay(""); }
    else { act("wave", 3200); speak(greeting(t), 5200); }
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
    const life = window.setInterval(() => {
      if (busy.current || drag.current || moodRef.current === "sleep") return;
      if (Date.now() - lastActive.current > SLEEP_AFTER) { act("sleep", 0); speak("Zzz…", 0); return; }
      const roll = Math.random();
      const hour = new Date().getHours() + new Date().getMinutes() / 60;
      const meal = (hour >= 11.5 && hour < 13) || (hour >= 17.5 && hour < 19);
      if (meal && roll < .12) { act("eat", 15_000); speak(t("我先吃点东西～你也记得吃饭。"), 4200); }
      else if (roll < .05) { act("work", 20_000); speak(t("我也来认真工作一会儿。"), 3600); }
      else if (roll < .09) speak([t("我一直在这里。"), t("要一起工作吗？"), greeting(t), t("有什么想问的，双击我就好。")][Math.floor(Math.random() * 4)], 4200);
    }, 30_000);
    // The model's <pet> tag: a mood and a line.
    const command = (cmd: PetCommand) => {
      lastActive.current = Date.now();
      commanded.current = Date.now();
      const mood = cmd.mood && PET_MOODS.includes(cmd.mood) ? cmd.mood : undefined;
      if (mood) act(mood, mood === "sleep" ? 0 : 4200);
      if (cmd.say) speak(cmd.say, 5200);
    };
    const onWindowCommand = (e: Event) => { if (inline) command((e as CustomEvent<PetCommand>).detail || {}); };
    const onWindowSignal = (e: Event) => { if (inline) signalled((e as CustomEvent<{ signal: string; focused: boolean }>).detail); };
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
      window.clearTimeout(blinkTimer); window.clearInterval(life); offCursor?.(); offSignal?.(); offCommand?.();
      window.removeEventListener("ciro-pet", onWindowCommand); window.removeEventListener("ciro-pet-signal", onWindowSignal);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Click-through everywhere except on her (and the menu / bubble while shown).
  const hover = (over: boolean) => { if (!drag.current) bridge?.setIgnore(!over && !menu); };
  useEffect(() => { if (menu) bridge?.setIgnore(false); }, [menu]);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    wake();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.screenX, y: e.screenY, moving: false, ox: posRef.current.x, oy: posRef.current.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (d) {
      if (!d.moving && Math.hypot(e.screenX - d.x, e.screenY - d.y) > 4) { d.moving = true; bridge?.drag("start"); act("drag", 0); speak(t("哇，要带我去哪里？"), 0); }
      if (d.moving) {
        if (inline) setPos({ x: Math.max(0, Math.min(window.innerWidth - 90, d.ox - (e.screenX - d.x))), y: Math.max(0, Math.min(window.innerHeight - 120, d.oy - (e.screenY - d.y))) });
        else bridge?.drag("move");
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
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d?.moving) {
      if (inline) { try { localStorage.setItem(INLINE_POS, JSON.stringify(posRef.current)); } catch { /* storage off */ } }
      else bridge?.drag("end");
      act("happy", 1600); speak(t("这里不错。"), 2200); return; }
    if (!d) return;
    const now = Date.now();
    pokes.current = [...pokes.current.filter((x) => now - x < 1600), now];
    if (pokes.current.length >= 5) { pokes.current = []; act("angry", 2800); speak(t("别戳啦！"), 2600); return; }
    act(Math.random() < .3 ? "love" : "happy", 2200);
    speak([t("嗯？"), t("我在哦。"), t("找我有事吗？"), t("嘿嘿。")][Math.floor(Math.random() * 4)], 2400);
  }
  const shown: Mood = mood;
  const image = art ? (art[shown] || art.idle) : null;
  const run = (action: "open" | "quick" | "hide") => {
    setMenu(false);
    if (!inline) { bridge?.action(action); return; }
    if (action === "hide") setPetEnabled(false);
    else onAsk?.();
  };

  return <div className={inline ? "pet-root pet-root--inline" : "pet-root"} onMouseLeave={() => hover(false)}
    style={inline ? { right: pos.x, bottom: pos.y } : undefined}>
    {say && <div className={"pet-say" + (say === "…" ? " pet-say--dots" : "")} role="status" onMouseEnter={() => hover(true)}>{say}</div>}
    {menu && <div className="pet-menu" role="menu" onMouseEnter={() => hover(true)}>
      <button type="button" role="menuitem" onClick={() => run("quick")}>{t("快速提问")}</button>
      {!inline && <button type="button" role="menuitem" onClick={() => run("open")}>{t("打开 Ciro")}</button>}
      <button type="button" role="menuitem" onClick={() => { setMenu(false); act("sleep", 0); speak("Zzz…", 0); }}>{t("让她睡一会儿")}</button>
      <button type="button" role="menuitem" onClick={() => run("hide")}>{t("隐藏桌宠")}</button>
    </div>}
    <div ref={sprite} className={"pet-sprite pet-sprite--" + shown + (image ? " pet-sprite--art" : "")} aria-label="Ciro" role="img"
      onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      onDoubleClick={() => { act("happy", 1600); speak(t("想问什么？"), 2000); if (inline) onAsk?.(); else bridge?.action("quick"); }}
      onContextMenu={(e) => { e.preventDefault(); wake(); setMenu((v) => !v); }}>
      {image ? <img src={image} alt="" draggable={false}/> : <Chibi mood={shown} blink={blink} look={look}/>}
      {(shown === "happy" || shown === "love") && <span className="pet-fx pet-heart">♥</span>}
      {shown === "sleep" && <span className="pet-fx pet-zzz">z<i>z</i><b>z</b></span>}
    </div>
  </div>;
}
