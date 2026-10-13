/**
 * The corrective colour filters of the accessibility settings (daltonization), rendered with the page so they exist at
 * the first paint; `:root[data-vision]` applies one (src/styles/components/access.css).
 *
 * Worked once: simulation S from Machado, Oliveira and Fernandes 2009 (severity 1.0, linear RGB); the colour difference
 * an eye loses, original minus simulated, is shifted into what it still sees (Fidaner, Lin and Ozguven):
 * T = I + SHIFT (I - S). Red-green types shift into green and blue, blue-yellow into red and green. Every row of T sums
 * to 1, so the greys and blacks of the palette are untouched and only colour moves.
 */
export const MATRICES = {
  deutan: "1 0 0 0 0 0.1628 0.725 0.1122 0 0 0.4547 -0.6454 1.1907 0 0 0 0 0 1 0",
  protan: "1 0 0 0 0 0.4789 0.4769 0.0442 0 0 0.5973 -0.6887 1.0914 0 0 0 0 0 1 0",
  tritan: "0.7412 -0.4072 0.666 0 0 0.0751 0.5852 0.3397 0 0 0 0 1 0 0 0 0 0 1 0",
} as const;

export function VisionFilters() {
  return (
    <svg className="access-filters" aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(MATRICES).map(([kind, values]) => (
          <filter key={kind} id={`mop-vision-${kind}`} colorInterpolationFilters="linearRGB">
            <feColorMatrix type="matrix" values={values} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
