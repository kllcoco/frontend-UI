import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { BrainCircuit, ChevronDown, Info } from "lucide-react";
import { THINKING_LEVELS } from "../lib/thinking";

type Props = {
  value: number;
  onChange: (index: number) => void;
  t: (text: string) => string;
  /** Short note shown under the slider (e.g. backend support). */
  note?: string;
};

const last = THINKING_LEVELS.length - 1;

/** Composer chip + popover with an animated, draggable five-stop thinking-depth slider. */
export default function ThinkingDepth({ value, onChange, t, note }: Props) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const level = THINKING_LEVELS[value] ?? THINKING_LEVELS[2];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  function positionFrom(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    return Math.min(last, Math.max(0, ((clientX - rect.left) / rect.width) * last));
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(positionFrom(event.clientX));
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag === null) return;
    const next = positionFrom(event.clientX);
    setDrag(next);
    if (Math.round(next) !== value) onChange(Math.round(next));
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag === null) return;
    onChange(Math.round(positionFrom(event.clientX)));
    setDrag(null);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (event.key in step) { event.preventDefault(); onChange(Math.min(last, Math.max(0, value + step[event.key]))); }
    if (event.key === "Home") { event.preventDefault(); onChange(0); }
    if (event.key === "End") { event.preventDefault(); onChange(last); }
  }

  const position = drag ?? value;
  const percent = (position / last) * 100;
  const style = { "--td-pos": percent + "%", "--td-level": value } as CSSProperties;

  return <div className="td-root" ref={rootRef}>
    <button type="button" className={"td-chip td-chip--" + level.id} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen((v) => !v)} title={t("思考深度")} aria-label={t("思考深度") + ": " + t(level.label)}>
      <span className="td-chip-icon" style={{ "--td-level": value } as CSSProperties}><BrainCircuit size={15}/></span>
      <span key={level.id} className="td-chip-label">{t(level.label)}</span>
      <ChevronDown size={13} className={open ? "td-chev td-chev--open" : "td-chev"}/>
    </button>
    {open && <div className="td-pop" role="dialog" aria-label={t("思考深度")} style={style}>
      <div className="td-head">
        <div><strong>{t("思考深度")}</strong><span>{t("拖动滑杆调节 Ciro 回答前的思考时间")}</span></div>
        <span className={"td-badge td-badge--" + level.id} key={level.id}>{t(level.label)}</span>
      </div>
      <div className="td-slider" ref={trackRef} role="slider" tabIndex={0}
        aria-label={t("思考深度")} aria-valuemin={0} aria-valuemax={last} aria-valuenow={value}
        aria-valuetext={t(level.label)}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)} onKeyDown={onKeyDown}
        data-dragging={drag !== null ? "true" : "false"}>
        <div className="td-track"><div className="td-fill"/></div>
        {THINKING_LEVELS.map((item, index) => <span key={item.id}
          className={index <= value ? "td-stop td-stop--on" : "td-stop"} style={{ left: (index / last) * 100 + "%" }}/>)}
        <div className="td-thumb"><span className="td-thumb-glow"/></div>
      </div>
      <div className="td-labels">
        {THINKING_LEVELS.map((item, index) => <button type="button" key={item.id}
          className={index === value ? "td-label td-label--active" : "td-label"}
          style={{ left: (index / last) * 100 + "%" }} onClick={() => onChange(index)}>{t(item.label)}</button>)}
      </div>
      <p className="td-hint" key={level.id}>{t(level.hint)}
        {level.maxSeconds > 0 && <span> · {t("最长")} {level.maxSeconds >= 60 ? level.maxSeconds / 60 + " " + t("分钟") : level.maxSeconds + "s"}</span>}</p>
      {note && <p className="td-note"><Info size={13}/>{note}</p>}
    </div>}
  </div>;
}
