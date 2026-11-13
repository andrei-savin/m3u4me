import {
  Hct, argbFromHex, hexFromArgb, type DynamicScheme,
  SchemeTonalSpot, SchemeNeutral, SchemeVibrant, SchemeExpressive, SchemeFidelity,
  SchemeContent, SchemeMonochrome, SchemeRainbow, SchemeFruitSalad,
} from '@material/material-color-utilities';

/**
 * Material You colours: turns the one accent colour the user picked into the whole Material 3
 * palette (buttons, selected rows, tinted backgrounds, outlines…), the same way Android does
 * with a wallpaper colour. The maths is Google's own library; this file only writes its result
 * out as CSS variables (`--md-primary`, `--md-surface-container`, …) that index.css hands to
 * Tailwind as colour classes (`bg-primary`, `bg-surface-container`, …).
 *
 * Both the light and the dark palette are written at once (`:root` and `:root.dark`), so
 * switching dark mode is pure CSS. They go into a <style> tag rather than inline styles on
 * <html> so that index.css's AMOLED rules (`:root.amoled.dark`, more specific) can still
 * replace the surfaces with true black.
 */

/**
 * The colour styles offered in Settings → Appearance. Each is one of Google's recipes for
 * building a palette from the same accent colour: how strong the colours are, and which
 * other colours join it. `tonalSpot` is Android's default and the app's.
 */
export const COLOR_STYLES = [
  { id: 'tonalSpot', label: 'Tonal spot', description: "Calm and balanced. Android's default.", scheme: SchemeTonalSpot },
  { id: 'neutral', label: 'Neutral', description: 'Almost grey, with just a hint of your colour.', scheme: SchemeNeutral },
  { id: 'vibrant', label: 'Vibrant', description: 'Stronger colour everywhere.', scheme: SchemeVibrant },
  { id: 'expressive', label: 'Expressive', description: 'Playful: shifts your colour and adds contrasting ones.', scheme: SchemeExpressive },
  { id: 'fidelity', label: 'Fidelity', description: 'Stays closest to the exact colour you picked.', scheme: SchemeFidelity },
  { id: 'content', label: 'Content', description: 'Like Fidelity, with a companion colour close to yours.', scheme: SchemeContent },
  { id: 'monochrome', label: 'Monochrome', description: 'Black, white and grey only.', scheme: SchemeMonochrome },
  { id: 'rainbow', label: 'Rainbow', description: 'Your colour on plain grey surfaces, with a contrasting extra.', scheme: SchemeRainbow },
  { id: 'fruitSalad', label: 'Fruit salad', description: 'The boldest mix: several different colours.', scheme: SchemeFruitSalad },
] as const;

export type ColorStyle = typeof COLOR_STYLES[number]['id'];

// The palette roles the app uses. Each becomes `--md-<role in kebab-case>`.
const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceDim', 'surfaceBright',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'onSurface', 'surfaceVariant', 'onSurfaceVariant',
  'outline', 'outlineVariant',
  'inverseSurface', 'inverseOnSurface', 'inversePrimary',
] as const;

const FALLBACK_ACCENT = '#FF2960';

const toKebab = (name: string) => name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

/** Builds the palette for an accent (a #RRGGBB colour) in one style, light or dark. */
function buildScheme(accent: string, style: ColorStyle, isDark: boolean): DynamicScheme {
  // A hand-edited or corrupted saved setting shouldn't leave the app without colours.
  const hex = /^#[0-9a-f]{6}$/i.test(accent) ? accent : FALLBACK_ACCENT;
  const recipe = COLOR_STYLES.find(s => s.id === style) ?? COLOR_STYLES[0];
  return new recipe.scheme(Hct.fromInt(argbFromHex(hex)), isDark, 0);
}

function schemeVariables(scheme: DynamicScheme): string {
  return ROLES.map(role => `--md-${toKebab(role)}: ${hexFromArgb(scheme[role])};`).join(' ');
}

/**
 * Writes the Material 3 palette for `accent` into the page. Returns the primary colour of the
 * light and of the dark palette (the colour the logo is drawn in), so the browser tab's icon
 * can be given the same shade.
 */
export function applyMaterialTheme(accent: string, style: ColorStyle): { light: string; dark: string } {
  const light = buildScheme(accent, style, false);
  const dark = buildScheme(accent, style, true);

  let styleTag = document.getElementById('md-theme') as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'md-theme';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `:root { ${schemeVariables(light)} }\n:root.dark { ${schemeVariables(dark)} }`;
  return { light: hexFromArgb(light.primary), dark: hexFromArgb(dark.primary) };
}

/**
 * Switches the page between the light and dark palette (the `dark` class on <html>) and turns
 * AMOLED black on or off. The `amoled` class can stay on while the app is light: index.css only
 * uses it together with `dark` (`:root.amoled.dark`), so it simply waits for the next dark spell.
 */
export function applyColorScheme(isDark: boolean, isAmoled: boolean) {
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.classList.toggle('amoled', isAmoled);
  // Tells the browser too, so its own bits (scrollbars, form controls) match.
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

/** A few colours of a style's palette, for the little previews in Settings. */
export function previewColorStyle(accent: string, style: ColorStyle, isDark: boolean): string[] {
  const scheme = buildScheme(accent, style, isDark);
  return [scheme.primary, scheme.secondaryContainer, scheme.tertiary, scheme.surfaceContainer].map(hexFromArgb);
}
