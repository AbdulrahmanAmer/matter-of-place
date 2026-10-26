import { createFileRoute } from "@tanstack/react-router";

// PRV-012: every form that collects an address posts here when the page's script has not run (before hydration,
// scripts blocked, a script error). The submit then never becomes a GET with the address in the URL. The body is not
// read, stored or logged: sending needs the page's script (the Turnstile check runs there), so the answer says so.

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Turn on scripts to send this form | Matter of Place</title>
</head>
<body style="margin:0;padding:4rem 1.5rem;font-family:Jost,Urbanist,sans-serif;line-height:1.5">
<main style="max-width:32rem;margin:0 auto">
<h1 style="font-weight:400">This form needs scripts to send</h1>
<p>Nothing you typed was sent or kept. Turn scripts on for this page, go back and send it again.</p>
<p><a href="/">Matter of Place</a></p>
</main>
</body>
</html>
`;

export const Route = createFileRoute("/api/form-fallback")({
  server: {
    handlers: {
      POST: () =>
        new Response(page, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex, nofollow",
          },
        }),
    },
  },
});
