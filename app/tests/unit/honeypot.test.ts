// The bot trap of GD-05: one field a person never reaches, named as the pipeline reads it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Honeypot } from "../../src/components/forms/honeypot";

describe("Honeypot", () => {
  it("renders one input named website, out of the tab order and hidden from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(Honeypot));
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(1);
    const [input] = inputs;
    expect(input).toContain('name="website"');
    expect(input).toContain('tabindex="-1"');
    expect(input).toContain('aria-hidden="true"');
    expect(input).toContain('autoComplete="off"');
    expect(html).toMatch(/^<div class="hp-field">/);
  });
});
