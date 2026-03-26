import { useEffect, useState } from 'react';
import { defaultColor, normalizeColor, palette } from '../lib/palette';
import type { MarkerMessage, PageState } from '../lib/types';

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function sendToActiveTab<T>(message: MarkerMessage): Promise<T | null> {
  const tabId = await getActiveTabId();
  if (!tabId) {
    return null;
  }

  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

export function App() {
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [isUnsupported, setIsUnsupported] = useState(false);
  const [customColor, setCustomColor] = useState(defaultColor);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const state = await sendToActiveTab<PageState>({ type: 'MARKER_GET_STATE' });
    if (!state) {
      setIsUnsupported(true);
      return;
    }

    setIsUnsupported(false);
    setPageState(state);
    setCustomColor(state.settings.defaultColor);
  }

  async function updateDefaultColor(color: string): Promise<void> {
    const state = await sendToActiveTab<PageState>({
      type: 'MARKER_SET_DEFAULT_COLOR',
      color: normalizeColor(color),
    });

    if (!state) {
      setIsUnsupported(true);
      return;
    }

    setPageState(state);
    setCustomColor(state.settings.defaultColor);
  }

  async function clearPage(): Promise<void> {
    const state = await sendToActiveTab<PageState>({ type: 'MARKER_CLEAR_PAGE' });
    if (!state) {
      setIsUnsupported(true);
      return;
    }

    setPageState(state);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(103,232,249,0.18),_transparent_45%),linear-gradient(180deg,_#020617_0%,_#0f172a_100%)] text-slate-100">
      <div className="relative flex min-h-screen flex-col p-4">
        <div className="absolute inset-x-6 top-5 h-20 rounded-full bg-cyan-300/10 blur-3xl" />

        <section className="relative rounded-[1.8rem] border border-white/10 bg-slate-950/70 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-[0.72rem] uppercase tracking-[0.32em] text-cyan-200/70">
                Marker
              </p>
              <h1 className="mt-2 font-display text-xl text-white">Default color</h1>
            </div>
            <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white">
              {isUnsupported ? '--' : pageState?.highlights.length ?? 0}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            {palette.map((color) => {
              const active = pageState?.settings.defaultColor === color.value;
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => void updateDefaultColor(color.value)}
                  className={`rounded-[1.2rem] border p-3 transition ${
                    active
                      ? 'border-cyan-200/40 bg-cyan-300/12'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/8'
                  }`}
                >
                  <span
                    className="block h-7 w-full rounded-full ring-1 ring-white/25"
                    style={{ backgroundColor: color.value }}
                  />
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-white/5 px-3 py-3">
            <span className="text-[0.72rem] font-medium uppercase tracking-[0.28em] text-slate-400">
              Custom
            </span>
            <input
              type="color"
              value={customColor}
              onChange={(event) => {
                const value = event.target.value;
                setCustomColor(value);
                void updateDefaultColor(value);
              }}
              className="ml-auto h-10 w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent"
            />
          </div>

          <button
            type="button"
            onClick={() => void clearPage()}
            disabled={isUnsupported || !pageState?.highlights.length}
            className="mt-4 w-full rounded-full bg-cyan-300 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-950 transition enabled:hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Clear Page
          </button>

          {isUnsupported && (
            <p className="mt-4 text-xs leading-5 text-slate-400">
              This tab blocks extension scripts.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
