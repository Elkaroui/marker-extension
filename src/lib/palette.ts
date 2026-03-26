export interface PaletteColor {
  id: string;
  label: string;
  value: string;
}

export const palette: PaletteColor[] = [
  { id: 'sun', label: 'Sun', value: '#facc15' },
  { id: 'mint', label: 'Mint', value: '#6ee7b7' },
  { id: 'sky', label: 'Sky', value: '#7dd3fc' },
  { id: 'rose', label: 'Rose', value: '#fda4af' },
  { id: 'violet', label: 'Violet', value: '#c4b5fd' },
  { id: 'amber', label: 'Amber', value: '#fdba74' },
];

export const defaultColor = palette[0].value;

export function normalizeColor(color: string): string {
  const value = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }

  if (/^#[0-9a-f]{3}$/i.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return defaultColor;
}

export function withAlpha(color: string, alphaHex: string): string {
  return `${normalizeColor(color)}${alphaHex}`;
}
