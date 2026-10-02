const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The calm 500 page: self-contained, no script and no outside asset. B17 brands the markup. */
export function serverErrorHtml(requestId: string): string {
  const id = requestId.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Something went wrong | Matter of Place</title>
</head>
<body>
<main>
<h1>Something went wrong</h1>
<p>We could not show this page just now. Please try again in a moment.</p>
<p>Reference ${id}</p>
</main>
</body>
</html>
`;
}
