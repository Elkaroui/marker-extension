import { defaultColor, normalizeColor } from './palette';
import type { MarkerSettings, PageState, StoredHighlight } from './types';

const HIGHLIGHTS_KEY = 'marker.highlights';
const SETTINGS_KEY = 'marker.settings';

type HighlightStore = Record<string, StoredHighlight[]>;

const fallbackSettings: MarkerSettings = {
  defaultColor,
  customColors: [],
};

function getStorage<T>(keys: string | string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result as T);
    });
  });
}

function setStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

export function getUrlKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  return parsed.toString();
}

export async function getHighlightStore(): Promise<HighlightStore> {
  const result = await getStorage<{ [HIGHLIGHTS_KEY]?: HighlightStore }>(HIGHLIGHTS_KEY);
  return result[HIGHLIGHTS_KEY] ?? {};
}

export async function getPageHighlights(urlKey: string): Promise<StoredHighlight[]> {
  const store = await getHighlightStore();
  return store[urlKey] ?? [];
}

export async function savePageHighlights(
  urlKey: string,
  highlights: StoredHighlight[],
): Promise<void> {
  const store = await getHighlightStore();
  store[urlKey] = highlights;
  await setStorage({ [HIGHLIGHTS_KEY]: store });
}

export async function clearPageHighlights(urlKey: string): Promise<void> {
  const store = await getHighlightStore();
  delete store[urlKey];
  await setStorage({ [HIGHLIGHTS_KEY]: store });
}

export async function getSettings(): Promise<MarkerSettings> {
  const result = await getStorage<{ [SETTINGS_KEY]?: Partial<MarkerSettings> }>(SETTINGS_KEY);
  const settings = result[SETTINGS_KEY] ?? {};

  return {
    defaultColor: normalizeColor(settings.defaultColor ?? fallbackSettings.defaultColor),
    customColors: Array.isArray(settings.customColors)
      ? settings.customColors.map(normalizeColor).slice(0, 8)
      : [],
  };
}

export async function updateSettings(partial: Partial<MarkerSettings>): Promise<MarkerSettings> {
  const current = await getSettings();
  const merged: MarkerSettings = {
    defaultColor: normalizeColor(partial.defaultColor ?? current.defaultColor),
    customColors:
      partial.customColors?.map(normalizeColor).slice(0, 8) ?? current.customColors,
  };

  await setStorage({ [SETTINGS_KEY]: merged });
  return merged;
}

export async function rememberCustomColor(color: string): Promise<MarkerSettings> {
  const normalized = normalizeColor(color);
  const settings = await getSettings();
  if (settings.customColors.includes(normalized)) {
    return settings;
  }

  const customColors = [normalized, ...settings.customColors].slice(0, 8);
  return updateSettings({ customColors });
}

export async function getPageState(url: string): Promise<PageState> {
  const urlKey = getUrlKey(url);
  const [highlights, settings] = await Promise.all([
    getPageHighlights(urlKey),
    getSettings(),
  ]);

  return {
    urlKey,
    highlights,
    settings,
  };
}
