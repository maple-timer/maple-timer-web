# Maple Timer Brand Assets

Maple Timer logo assets are managed here so site chrome, favicon, app icons, and social previews can be regenerated from one place.

These assets use an original cooldown-slot concept. They must not be replaced with official Nexon or MapleStory logos, monsters, skill icons, buff icons, or cropped game UI.

## Core Logo

- `logo-symbol.png` - primary transparent symbol for app icons, small UI, and favicon generation.
- `logo-wordmark.png` - transparent Korean wordmark.
- `logo-lockup.png` - transparent horizontal symbol + wordmark lockup.

## Favicon And App Icon Sources

Files in `favicons/` are generated from `logo-symbol.png`.

- `favicon.ico` - multi-size browser favicon.
- `favicon-16x16.png` - browser tab favicon.
- `favicon-32x32.png` - browser tab/favicon fallback.
- `favicon-48x48.png` - browser favicon fallback.
- `apple-touch-icon.png` - iOS home screen icon, 180x180.
- `icon-192.png` - PWA/app icon, 192x192.
- `icon-512.png` - PWA/app icon, 512x512.
- `maskable-icon-512.png` - maskable app icon with extra safe-area padding.

## Social Preview

- `social/og-image-wide.png` - wide Open Graph preview.
- `social/og-image-square.png` - square Open Graph preview.

## Usage Notes

- Keep `logo-symbol.png`, `logo-wordmark.png`, and `logo-lockup.png` transparent.
- Keep generated app icons on an opaque cream background.
- Use the wide social image for 1200x630-style previews and the square image for existing square preview compatibility.
- If the logo is revised, regenerate the root files in `public/` from this directory rather than editing each favicon manually.
