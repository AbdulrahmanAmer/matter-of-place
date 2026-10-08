# Deploying on Cloudflare

> Superseded. Sketch from the MVP phase. The approved spec is ../../../workspace/02-tech-stack/tech-stack.md and ../../../workspace/06-architecture/architecture.md: read this for intent, build from the spec.

One Worker serves the site and `/api/*`. GitHub Actions deploys it from the repo-root `.github/workflows/` (slice B1b), not from this folder. Database changes go through `supabase/migrations`; there is no hand-run SQL. Full stack and deploy path: [tech-stack.md](../../../workspace/02-tech-stack/tech-stack.md).

## Environment variables (frontend)

`VITE_*` names are build-time and public: Vite inlines them into the built JavaScript, so never put a secret in one. Secrets are set server side with `wrangler secret put`.

| Variable            | Required            | Purpose                             |
| ------------------- | ------------------- | ----------------------------------- |
| `VITE_SITE_URL`     | production          | canonical URLs and JSON-LD          |
| `VITE_API_BASE_URL` | when the API exists | switches every service to live mode |

Contact email, phone, registered entity, address and the Instagram, X and LinkedIn addresses are not build variables. They live in `settings.site`, reach the pages through `GET /api/public/site`, and `src/config/site.ts` keeps `null` for each as the local default. A value that is not set renders no line.
