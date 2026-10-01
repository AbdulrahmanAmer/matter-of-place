# scripts

Deterministic work that never goes through a model: seed from `src/data/*` into a dev database, image variants for R2 (thumb, card, hero, og, carousel, made once at publish), render-social, render-reel and publish-meta. Each script runs with `bun run scripts/<name>.ts`, takes its inputs as arguments or environment, and is what GitHub Actions calls for heavy renders.
