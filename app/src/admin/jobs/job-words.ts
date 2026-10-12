// Admin pass (2026-10-12): a job by the name a person uses for it, so the Jobs table never asks anyone to read
// `meta_token_refresh`. The steps keep the labels the flow editor shows (step-specs.ts); the system jobs are named for
// what they do. A type added later without a name here still reads, with its underscores as spaces.

export const jobNames: Readonly<Record<string, string>> = {
  // Steps of a flow
  send_email: "Send email",
  notify_admin: "Notify the team",
  bump_catalog_version: "Refresh the catalog",
  purge_cache: "Purge cache",
  render_variants: "Render image sizes",
  render_cover: "Render cover",
  render_carousel: "Render carousel",
  render_story: "Render story",
  render_reel: "Render reel",
  write_captions: "Write captions",
  build_newsletter_block: "Build newsletter block",
  post_meta: "Post to Meta",
  post_x: "Post to X",
  post_linkedin: "Post to LinkedIn",
  render_og_static: "Render share images",
  queue_digest: "Queue Place Notes",
  webhook_omnikom: "Send to Omnikom",
  // System jobs
  health: "Daily health check",
  prune: "Nightly clean-up",
  reconcile: "Upload check",
  retention: "Retention clean-up",
  meta_token_refresh: "Renew the Meta sign-in",
  invoice_pdf: "Make the invoice PDF",
  newsletter_send: "Send Place Notes",
  newsletter_preview: "Preview Place Notes",
  newsletter_hygiene: "Mailing list care",
  kpi_weekly: "Weekly numbers",
  market_open_notice: "Tell a market's waiting list",
  copy_submission_media: "Copy a request's photographs",
  takedown_media: "Take down published files",
};

export function jobName(type: string): string {
  return jobNames[type] ?? type.replaceAll("_", " ");
}
