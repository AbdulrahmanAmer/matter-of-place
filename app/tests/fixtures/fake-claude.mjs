// A stand-in for the Claude CLI in tests of scripts/workforce/cli.ts. The mode is the first argument; the prompt
// arrives on stdin as with the real CLI.
const mode = process.argv[2];
const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const result = (extra = {}) =>
  line({
    type: "result",
    is_error: false,
    result: "done",
    session_id: "s-1",
    usage: { input_tokens: 3, output_tokens: 2 },
    ...extra,
  });

process.stdin.resume();
process.stdin.on("end", () => {
  if (mode === "json") {
    process.stdout.write(
      JSON.stringify({ is_error: false, result: "one answer", session_id: "s-2" }),
    );
    return;
  }
  if (mode === "silent") {
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === "talk") {
    // Works for about 600 ms in total, printing every 60 ms: longer than the test's 400 ms silence limit in one go.
    let n = 0;
    const tick = setInterval(() => {
      n += 1;
      line({
        type: "assistant",
        message: { content: [{ type: "text", text: `step ${String(n)}` }] },
      });
      if (n === 10) {
        clearInterval(tick);
        result();
      }
    }, 60);
    return;
  }
  if (mode === "tool-mentions-limit") {
    line({
      type: "user",
      message: {
        content: [
          { type: "tool_result", is_error: true, content: "the page says: rate limit reached" },
        ],
      },
    });
    result();
    return;
  }
  if (mode === "out-of-usage") {
    result({ is_error: true, result: "Claude usage limit reached|1792040000" });
  }
});
