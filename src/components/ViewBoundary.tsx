import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

type Props = { t: (text: string) => string; children: ReactNode; resetKey?: unknown; onHome?: () => void };
type State = { error: Error | null };

/** Keeps one broken view from blanking the whole app: lets the user retry or go home (details go to the console). */
export default class ViewBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Ciro view failed", error, info.componentStack); }
  componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { t, onHome } = this.props;
    return <div className="vb-root" role="alert">
      <TriangleAlert size={26}/>
      <strong>{t("这个页面暂时无法显示")}</strong>
      <p>{t("请检查网络后重试。")}</p>
      <div>
        <button type="button" className="cx-btn cx-btn--primary" onClick={() => this.setState({ error: null })}><RotateCcw size={15}/>{t("重试")}</button>
        {onHome && <button type="button" className="cx-btn" onClick={() => { this.setState({ error: null }); onHome(); }}>{t("回到对话")}</button>}
      </div>
    </div>;
  }
}
