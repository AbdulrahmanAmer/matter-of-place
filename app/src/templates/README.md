# src/templates

React templates consumed by render jobs, not by pages: social carousel, story and cover templates, the Open Graph image, the newsletter block, and React Email templates under `src/templates/email/`. Templates take their colours and type from the values in `src/styles/tokens.css`, never hex. A new email is a template here plus a row in the `email_templates` seed with its subject and variables (`docs/HOW-TO-ADD.md`).
