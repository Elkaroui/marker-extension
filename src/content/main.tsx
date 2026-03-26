import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import contentStyles from './styles.css?inline';
import {
  ROOT_ID,
  clearRenderedHighlights,
  createHighlightFromRange,
  getHighlightIdFromPoint,
  rangeIsHighlightable,
  renderStoredHighlights,
} from '../lib/highlights';
import { palette } from '../lib/palette';
import {
  clearPageHighlights,
  getPageState,
  getUrlKey,
  rememberCustomColor,
  savePageHighlights,
  updateSettings,
} from '../lib/storage';
import type { MarkerMessage, PageState } from '../lib/types';

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  text: string;
}

const fallbackCustomColor = '#14b8a6';

const hiddenMenu: MenuState = {
  visible: false,
  x: 0,
  y: 0,
  text: '',
};

function instrumentHistory(onNavigate: () => void): () => void {
  const pushState = history.pushState;
  const replaceState = history.replaceState;

  history.pushState = function pushStateProxy(...args) {
    const result = pushState.apply(this, args);
    onNavigate();
    return result;
  };

  history.replaceState = function replaceStateProxy(...args) {
    const result = replaceState.apply(this, args);
    onNavigate();
    return result;
  };

  const popstateHandler = () => onNavigate();
  window.addEventListener('popstate', popstateHandler);

  return () => {
    history.pushState = pushState;
    history.replaceState = replaceState;
    window.removeEventListener('popstate', popstateHandler);
  };
}

function ContentApp() {
  const [pageState, setPageState] = useState<PageState | null>(null);
  const [menu, setMenu] = useState<MenuState>(hiddenMenu);
  const [customColor, setCustomColor] = useState(fallbackCustomColor);
  const [savedCustomColor, setSavedCustomColor] = useState(fallbackCustomColor);
  const [customEditorOpen, setCustomEditorOpen] = useState(false);
  const activeRangeRef = useRef<Range | null>(null);
  const currentUrlRef = useRef(window.location.href);
  const uiInteractingRef = useRef(false);

  const colors = useMemo(
    () => [...palette, { id: 'custom', label: 'Custom', value: savedCustomColor }],
    [savedCustomColor],
  );

  useEffect(() => {
    void syncPage();

    const isInsideMarkerUiEvent = (event: Event): boolean => {
      return event.composedPath().includes(host);
    };

    const scheduleSelectionCheck = () => {
      window.requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          if (!uiInteractingRef.current) {
            hideMenu();
          }
          return;
        }

        const range = selection.getRangeAt(0).cloneRange();
        if (!rangeIsHighlightable(range)) {
          hideMenu();
          return;
        }

        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) {
          hideMenu();
          return;
        }

        activeRangeRef.current = range;
        setMenu({
          visible: true,
          x: Math.min(window.innerWidth - 24, Math.max(24, rect.left + rect.width / 2)),
          y: Math.max(18, rect.top - 16),
          text: selection.toString().replace(/\s+/g, ' ').trim(),
        });
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (isInsideMarkerUiEvent(event)) {
        return;
      }

      hideMenu();
    };

    const handleHighlightClick = (event: MouseEvent) => {
      if (isInsideMarkerUiEvent(event)) {
        return;
      }

      const highlightId = getHighlightIdFromPoint(event.clientX, event.clientY);
      if (!highlightId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleRemoveHighlight(highlightId);
    };

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local') {
        return;
      }

      if (changes['marker.highlights'] || changes['marker.settings']) {
        void syncPage();
      }
    };

    const stopObservingHistory = instrumentHistory(() => {
      if (currentUrlRef.current !== window.location.href) {
        currentUrlRef.current = window.location.href;
        hideMenu();
        setCustomEditorOpen(false);
        void syncPage();
      }
    });

    const listener = (
      message: MarkerMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (message.type === 'MARKER_GET_STATE') {
        void syncPage().then((state) => sendResponse(state));
        return true;
      }

      if (message.type === 'MARKER_CLEAR_PAGE') {
        void handleClearPage().then((state) => sendResponse(state));
        return true;
      }

      if (message.type === 'MARKER_SET_DEFAULT_COLOR') {
        void handleDefaultColor(message.color).then((state) => sendResponse(state));
        return true;
      }

      return false;
    };

    chrome.runtime.onMessage.addListener(listener);
    chrome.storage.onChanged.addListener(handleStorageChange);
    document.addEventListener('selectionchange', scheduleSelectionCheck);
    document.addEventListener('pointerup', scheduleSelectionCheck);
    document.addEventListener('keyup', scheduleSelectionCheck);
    document.addEventListener('click', handleHighlightClick, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('scroll', hideMenu, true);
    window.addEventListener('resize', hideMenu);

    return () => {
      stopObservingHistory();
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage.onChanged.removeListener(handleStorageChange);
      document.removeEventListener('selectionchange', scheduleSelectionCheck);
      document.removeEventListener('pointerup', scheduleSelectionCheck);
      document.removeEventListener('keyup', scheduleSelectionCheck);
      document.removeEventListener('click', handleHighlightClick, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('scroll', hideMenu, true);
      window.removeEventListener('resize', hideMenu);
    };
  }, [pageState?.highlights]);

  async function syncPage(): Promise<PageState> {
    const state = await getPageState(window.location.href);
    renderStoredHighlights(state.highlights);
    setPageState(state);
    const savedCustom = state.settings.customColors[0] ?? fallbackCustomColor;
    setSavedCustomColor(savedCustom);
    setCustomColor((current) => (current === fallbackCustomColor ? savedCustom : current));
    return state;
  }

  function hideMenu(): void {
    activeRangeRef.current = null;
    setCustomEditorOpen(false);
    setMenu((current) => ({
      ...current,
      visible: false,
    }));
  }

  function handleCloseMenu(): void {
    window.getSelection()?.removeAllRanges();
    hideMenu();
  }

  async function handleHighlight(color: string): Promise<void> {
    const range = activeRangeRef.current;
    if (!range || !pageState) {
      return;
    }

    const normalizedUrl = getUrlKey(window.location.href);
    const highlight = createHighlightFromRange(range, color, normalizedUrl);
    const deduped = pageState.highlights.filter(
      (item) =>
        !(
          item.text === highlight.text &&
          item.startXPath === highlight.startXPath &&
          item.startOffset === highlight.startOffset &&
          item.endXPath === highlight.endXPath &&
          item.endOffset === highlight.endOffset
        ),
    );
    const highlights = [...deduped, highlight];

    if (!palette.some((entry) => entry.value === color)) {
      await rememberCustomColor(color);
      setSavedCustomColor(color);
      setCustomColor(color);
    }

    const settings = await updateSettings({ defaultColor: color });
    await savePageHighlights(pageState.urlKey, highlights);
    renderStoredHighlights(highlights);

    setPageState({
      urlKey: pageState.urlKey,
      highlights,
      settings,
    });
    window.getSelection()?.removeAllRanges();
    hideMenu();
  }

  async function handleClearPage(): Promise<PageState> {
    if (!pageState) {
      return syncPage();
    }

    clearRenderedHighlights();
    await clearPageHighlights(pageState.urlKey);
    const nextState: PageState = {
      urlKey: pageState.urlKey,
      highlights: [],
      settings: pageState.settings,
    };
    setPageState(nextState);
    hideMenu();
    return nextState;
  }

  async function handleRemoveHighlight(highlightId: string): Promise<void> {
    if (!pageState) {
      return;
    }

    const highlights = pageState.highlights.filter((item) => item.id !== highlightId);
    await savePageHighlights(pageState.urlKey, highlights);
    renderStoredHighlights(highlights);

    setPageState({
      ...pageState,
      highlights,
    });
  }

  async function handleDefaultColor(color: string): Promise<PageState> {
    if (!palette.some((entry) => entry.value === color)) {
      await rememberCustomColor(color);
      setSavedCustomColor(color);
      setCustomColor(color);
    }

    const settings = await updateSettings({ defaultColor: color });
    const nextState: PageState = {
      urlKey: pageState?.urlKey ?? getUrlKey(window.location.href),
      highlights: pageState?.highlights ?? [],
      settings,
    };
    setPageState(nextState);
    setSavedCustomColor(settings.customColors[0] ?? savedCustomColor ?? fallbackCustomColor);
    return nextState;
  }

  return (
    <div
      className="pointer-events-none marker-root"
      onMouseDownCapture={() => {
        uiInteractingRef.current = true;
      }}
      onMouseUpCapture={() => {
        window.setTimeout(() => {
          uiInteractingRef.current = false;
        }, 0);
      }}
    >
      <div
        className={`fixed left-0 top-0 z-[2147483647] ${
          menu.visible ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{
          transform: `translate(${menu.x}px, ${menu.y}px) translate(-50%, -100%)`,
        }}
      >
        <div
          className={`origin-bottom transition duration-200 ${
            menu.visible
              ? 'translate-y-0 scale-100 opacity-100'
              : '-translate-y-2 scale-95 opacity-0'
          }`}
        >
          <div className="w-[min(92vw,24rem)] rounded-[1.4rem] border border-white/15 bg-slate-950/92 p-3 text-white shadow-[0_24px_80px_rgba(15,23,42,0.45)] backdrop-blur-xl">
            <div className="mb-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-[0.7rem] uppercase tracking-[0.3em] text-cyan-200/70">
                  Marker
                </p>
                <button
                  type="button"
                  onClick={handleCloseMenu}
                  className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  Close
                </button>
              </div>
              <p className="mt-2 block w-full text-sm font-medium leading-5 text-slate-100">
                {menu.text}
              </p>
            </div>

            <div className="mb-3 grid grid-cols-4 gap-2">
              {colors.map((color) =>
                color.id === 'custom' ? (
                  <div key={color.id} className="relative">
                    <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10">
                      <button
                        type="button"
                        aria-label="Edit custom color"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCustomEditorOpen((open) => !open);
                        }}
                        className="flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white/30"
                        style={{ backgroundColor: savedCustomColor }}
                      />
                      <button
                        type="button"
                        title="Highlight with Custom"
                        onClick={() => void handleHighlight(savedCustomColor)}
                        className="min-w-0 flex-1 text-left text-xs font-medium text-slate-100"
                      >
                        Custom
                      </button>
                    </div>

                    {customEditorOpen && (
                      <div className="absolute right-0 top-full z-10 mt-2 w-52 rounded-2xl border border-white/12 bg-slate-950/96 p-3 shadow-[0_22px_60px_rgba(15,23,42,0.42)] backdrop-blur-xl">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <span className="text-[0.68rem] uppercase tracking-[0.26em] text-slate-400">
                            Custom
                          </span>
                          <button
                            type="button"
                            onClick={() => setCustomEditorOpen(false)}
                            className="rounded-full border border-white/10 px-2 py-1 text-[0.62rem] font-medium uppercase tracking-[0.18em] text-slate-300 transition hover:border-white/20 hover:text-white"
                          >
                            Close
                          </button>
                        </div>

                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={customColor}
                            onChange={(event) => {
                              setCustomColor(event.target.value);
                            }}
                            onFocus={() => {
                              uiInteractingRef.current = true;
                            }}
                            onBlur={() => {
                              window.setTimeout(() => {
                                uiInteractingRef.current = false;
                              }, 0);
                            }}
                            className="h-10 w-12 cursor-pointer rounded-xl border border-white/10 bg-transparent"
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              setSavedCustomColor(customColor);
                              await handleDefaultColor(customColor);
                              await handleHighlight(customColor);
                            }}
                            className="ml-auto rounded-full bg-cyan-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-950 transition hover:bg-cyan-200"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    key={color.id}
                    type="button"
                    title={`Highlight with ${color.label}`}
                    onClick={() => void handleHighlight(color.value)}
                    className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/10"
                  >
                    <span
                      className="h-4 w-4 rounded-full ring-2 ring-white/30"
                      style={{ backgroundColor: color.value }}
                    />
                    <span className="text-xs font-medium text-slate-100">{color.label}</span>
                  </button>
                ),
              )}
            </div>

          </div>
        </div>
      </div>

      {!!pageState?.highlights.length && (
        <button
          type="button"
          onClick={() => void handleClearPage()}
          className="pointer-events-auto fixed bottom-4 right-4 z-[2147483646] rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-slate-100 shadow-[0_14px_50px_rgba(2,6,23,0.28)] backdrop-blur-md transition hover:border-white/20 hover:bg-slate-900/90"
        >
          Clear Page
          <span className="ml-2 rounded-full bg-white/10 px-2 py-1 text-[0.65rem]">
            {pageState.highlights.length}
          </span>
        </button>
      )}
    </div>
  );
}

const host = document.createElement('div');
host.id = ROOT_ID;
host.style.position = 'fixed';
host.style.inset = '0';
host.style.pointerEvents = 'none';
host.style.zIndex = '2147483647';
document.documentElement.append(host);

const shadowRoot = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = contentStyles;
shadowRoot.append(style);

const mountNode = document.createElement('div');
mountNode.style.pointerEvents = 'none';
shadowRoot.append(mountNode);

createRoot(mountNode).render(<ContentApp />);
