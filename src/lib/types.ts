export interface HighlightAnchor {
  startXPath: string;
  startOffset: number;
  endXPath: string;
  endOffset: number;
  text: string;
  prefix: string;
  suffix: string;
}

export interface StoredHighlight extends HighlightAnchor {
  id: string;
  color: string;
  url: string;
  createdAt: number;
}

export interface MarkerSettings {
  defaultColor: string;
  customColors: string[];
}

export interface PageState {
  urlKey: string;
  highlights: StoredHighlight[];
  settings: MarkerSettings;
}

export type MarkerMessage =
  | { type: 'MARKER_GET_STATE' }
  | { type: 'MARKER_CLEAR_PAGE' }
  | { type: 'MARKER_SET_DEFAULT_COLOR'; color: string };
