# 0003 Plain CSS with design tokens, no utility framework

Status: accepted

## Context

The brand is a quiet editorial publication with a five-colour palette and two type families. The template shipped Tailwind and a shadcn component kit; none of the shipped components suited the design and utility classes made the markup noisy.

## Decision

Styling is plain CSS organised by responsibility under `src/styles/`: tokens, base reset and typography, layout (header, overlays, footer), components, pages, motion. All colour, font and grid values are custom properties in `tokens.css`. Components carry semantic class names.

`tailwindcss` and `@tailwindcss/vite` remain installed only because the Lovable Vite preset lists them as peer dependencies; no stylesheet imports Tailwind. They can be removed together with that preset when the project moves to a plain Vite config.

## Consequences

- One breakpoint set (1100, 900, 800, 700 px) documented in `tokens.css`.
- `--muted` is a surface token; text uses `--muted-foreground`.
- Sections set vertical padding only; `.section-wrap` owns width and side padding, so the header, footer and content share one grid.
