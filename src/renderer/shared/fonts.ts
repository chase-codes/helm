// Self-hosted typefaces for the slide + reading canvases (SlideCanvas, ReadingCanvas).
// These three families are what the audience output is designed in; none ship with
// Windows (or a stock Mac), so without bundling them the projected text silently falls
// back to system fonts. Importing the @fontsource CSS here inlines the @font-face rules
// and gets the woff2 files copied into the build — no runtime network, works on any box.
//
// Weights match what the canvases actually use (Hanken 700, JetBrains 500/800,
// Newsreader 400) plus the unweighted default (400) and a little headroom, so any
// fontWeight referenced in the renderer resolves to a real face rather than a synthetic
// bold/regular.
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/hanken-grotesk/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/800.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/newsreader/700.css';
