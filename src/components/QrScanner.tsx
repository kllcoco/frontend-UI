import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/** Full-screen camera QR scanner. Uses the browser's BarcodeDetector when present, otherwise jsQR. */
export default function QrScanner({ t, onResult, onClose }: { t: (s: string) => string; onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError(t("当前环境无法使用相机。也可以直接用手机自带的相机扫描电脑上的二维码。")); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
      catch (e) {
        setError((e as DOMException)?.name === "NotAllowedError" ? t("需要相机权限才能扫码。请在系统设置里允许 Ciro 使用相机，或用手机自带的相机扫描。") : t("无法打开相机。也可以用手机自带的相机扫描电脑上的二维码。"));
        return;
      }
      if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const tick = async () => {
        if (stopped || done.current) return;
        if (video.readyState >= 2 && video.videoWidth) {
          let text = "";
          try {
            if (detector) text = (await detector.detect(video))[0]?.rawValue || "";
            else if (jsQR && ctx) {
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data || "";
            }
          } catch { /* frame not ready */ }
          if (text && !done.current) { done.current = true; navigator.vibrate?.(12); onResult(text); return; }
        }
        raf = requestAnimationFrame(() => void tick());
      };
      void tick();
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((tr) => tr.stop()); };
  }, [onResult, t]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return <div className="qr-root" role="dialog" aria-label={t("扫码连接电脑")}>
    <video ref={videoRef} className="qr-video" playsInline muted/>
    <div className="qr-frame" aria-hidden="true"><span/></div>
    <p className="qr-hint">{error || t("对准电脑上 工作模式 里显示的二维码")}</p>
    <button type="button" className="qr-close" onClick={onClose} aria-label={t("关闭")}><X size={22}/></button>
  </div>;
}
