# 0003 Plain CSS with design tokens, no utility framework

> Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec.

Status: accepted

## Context

The brand is a quiet editorial publication with a five-colour palette and two type families. The template shipped Tailwind and a shadcn component kit; none of the shipped components suited the design and utility classes made the markup noisy.

## Decision

Styling is plain CSS organised by responsibility under `src/styles/`: tokens, base reset and typography, layout (header, overlays, footer), components, pages, motion. All colour, font and grid values are custom properties in `tokens.css`. Components carry semantic class names.

`tailwindcss` and `@tailwindcss/vite` were removed on 2026-09-30 together with the Vite preset that had listed them as peer dependencies; no stylesheet ever imported Tailwind.

## Consequences

- One breakpoint set (1100, 900, 800, 700 px) documented in `tokens.css`.
- `--muted` is a surface token; text uses `--muted-foreground`.
- Sections set vertical padding only; `.section-wrap` owns width and side padding, so the header, footer and content share one grid.
