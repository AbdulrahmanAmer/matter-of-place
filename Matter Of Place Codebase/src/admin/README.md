# src/admin

Components and server functions for the `/admin` route group: request queue, decide with templated emails, invoice, dossier editor, media, publish, asset approvals, channel status, subscriber and interest lists, and the Automation section (recipes, templates, reasons, channel and schedule settings, dry-run). One feature folder per area (`src/admin/<feature>/`). Permission checks by role happen in the server function, never in the UI, and every state change writes an audit row (`docs/HOW-TO-ADD.md`).
