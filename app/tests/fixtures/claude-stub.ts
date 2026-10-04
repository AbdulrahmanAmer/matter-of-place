// The stub of the Claude CLI (ASSUMED H34 (7)): `CAPTIONS_CLI=bun tests/fixtures/claude-stub.ts`. It answers `--version`,
// appends its arguments and the length of its stdin to the file named by CAPTIONS_STUB_LOG, and prints the fixed CLI
// result that holds the caption JSON of property.fixture.json. CAPTIONS_STUB_MODE=error prints an error result and exits 1;
// error_answer prints the same result and exits 0, the CLI's way of reporting an error inside a clean exit.
import { appendFileSync } from "node:fs";
import fixture from "../../src/templates/social/fixtures/property.fixture.json";
import { propertyLink } from "../../src/server/assets/links.ts";

const args = process.argv.slice(2);

async function readStdin(): Promise<string> {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

if (args.includes("--version")) {
  process.stdout.write("stub 1.0.0\n");
} else {
  const stdin = await readStdin();
  const logFile = process.env["CAPTIONS_STUB_LOG"];
  if (logFile !== undefined) {
    appendFileSync(logFile, `${JSON.stringify({ args, stdin_length: stdin.length })}\n`);
  }
  const mode = process.env["CAPTIONS_STUB_MODE"];
  const failing = mode === "error" || mode === "error_answer";
  const captions = {
    ...fixture.captions,
    x: `${fixture.captions.x} ${propertyLink(fixture.property.slug, "x")}`,
  };
  const answer = {
    type: "result",
    is_error: failing,
    result: failing ? "stub error" : JSON.stringify(captions),
    usage: { input_tokens: 900, output_tokens: 300 },
  };
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exitCode = mode === "error" ? 1 : 0;
}
