# src/templates

React templates consumed by render jobs, not by pages: social carousel, story and cover templates, the Open Graph image, the newsletter block, and React Email templates under `src/templates/email/`. Templates take their colours and type from the values in `src/styles/tokens.css`, never hex. A new email is a template here plus a row in the `email_templates` seed with its subject and variables (`docs/HOW-TO-ADD.md`).

## Module map

| Path                                    | What it is                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social/SocialFrame.tsx`                | The shared frame of cover, carousel and story: photograph slot, solid band, wordmark and the text slots (marker, location, headline, price, specs). No logic: a slot that is not given is not drawn.                                                                                   |
| `social/social.css`                     | Plain CSS for the frame. Every number is a `--social-*` token from `src/styles/tokens.css`; a format only chooses which tokens apply.                                                                                                                                                  |
| `social/fonts.css`                      | `@font-face` for Jost and Cormorant Garamond (normal and italic) from `public/fonts`.                                                                                                                                                                                                  |
| `social/fixtures/property.fixture.json` | One full illustrative property (`oak-hill-residence`): facts, five photographs under `src/assets`, and the caption JSON. Used by tests and by the render scripts with `--fixture`.                                                                                                     |
| `email/style.ts`                        | The type, measures and motion of every email: each role as a class (the brand stack) and an inline stack Outlook can draw, the scale, and the three style blocks of the head (web fonts, faces and phone layout, motion behind `prefers-reduced-motion`).                              |
| `email/layout.tsx`                      | The shell: a running header (the lockup, a label, a hairline), the letter, and the Obsidian footer in words. A template file whose row only holds blocks exports `Email = letter("<label>")`; `scripts/email-gallery.ts` photographs every email with pictures on, off and on a phone. |
| `email/newsletter-welcome.tsx`          | The welcome a subscriber gets once after confirming, with its slot for the lead piece of the latest Place Notes issue.                                                                                                                                                                 |

## Rules

- The direction is `workspace/08-creative/DIRECTION.md`. A value that changes there changes the `/* social */` block of `src/styles/tokens.css` first, then the template.
- The fonts in `public/fonts` come from `bun run fonts` (`scripts/fonts.mjs`), copied from the `@fontsource-variable/*` packages with their licences. Run it by hand when a package version changes and commit the output with it.
- The fixture property is illustrative. Production shows none.
