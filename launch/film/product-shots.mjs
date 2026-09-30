// Product moments for the launch film (beat 8). Each `frame` runs inside the live page at film time t.
// Home scrolls at a cinematic pace; the properties grid scrolls while the cursor settles on Tiburon and the real
// hover (image scale 1.018, 0.5 s ease) plays; the dossier opens on its hero and scrolls to the fact row, which
// masks in figure by figure.

export const shots = [
  {
    name: "home",
    path: "/",
    duration: 4.4,
    frame: (t) => {
      const k = Math.min(1, t / 4.4);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // power2.inOut
      window.scrollTo(0, Math.round(30 + e * 560));
      return {};
    },
  },
  {
    name: "grid",
    path: "/properties",
    duration: 3.4,
    frame: (t) => {
      const D = 3.4;
      const k = Math.min(1, t / D);
      const e = 1 - Math.pow(1 - k, 2); // power2.out
      window.scrollTo(0, Math.round(860 + e * 250));
      const card = document.querySelector('a.property-card[href$="tiburon-waterline"]');
      const img = card.querySelector("img");
      const r = img.getBoundingClientRect();
      const target = [r.left + r.width * 0.58, r.top + r.height * 0.62];
      const start = [1760, 1010];
      const m = Math.min(1, Math.max(0, (t - 0.25) / 1.3));
      const em = m < 0.5 ? 4 * m * m * m : 1 - Math.pow(-2 * m + 2, 3) / 2; // power3.inOut
      const cx = start[0] + (target[0] - start[0]) * em;
      const cy = start[1] + (target[1] - start[1]) * em;
      // The site's own hover: transform scale(1.018) over 0.5 s, CSS `ease` approximated by power2.out.
      const h = Math.min(1, Math.max(0, (t - 1.45) / 0.5));
      img.style.transform = `scale(${1 + 0.018 * (1 - Math.pow(1 - h, 2))})`;
      return { cursor: [cx, cy], hover: h };
    },
  },
  {
    name: "dossier",
    path: "/property/tiburon-waterline",
    duration: 4.6,
    setup: () => {
      // Wrap each figure and label of the fact row in a mask so it can rise into place.
      for (const el of document.querySelectorAll(".dossier-facts strong, .dossier-facts span")) {
        const inner = document.createElement("div");
        inner.className = "mop-rise";
        inner.style.display = "inline-block";
        inner.style.willChange = "transform";
        inner.textContent = el.textContent;
        el.textContent = "";
        el.style.display = "block";
        el.style.overflow = "hidden";
        el.appendChild(inner);
      }
    },
    frame: (t) => {
      const k = Math.min(1, Math.max(0, (t - 0.7) / 2.6));
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // power3.inOut
      window.scrollTo(0, Math.round(e * 700));
      const rises = [...document.querySelectorAll(".dossier-facts .mop-rise")];
      // figures first, then labels, 60 ms stagger, expo.out over 0.8 s
      const figures = rises.filter((s) => s.parentElement.tagName === "STRONG");
      const labels = rises.filter((s) => s.parentElement.tagName !== "STRONG");
      const rise = (list, t0) => list.forEach((s, i) => {
        const p = Math.min(1, Math.max(0, (t - t0 - i * 0.06) / 0.8));
        const y = p >= 1 ? 0 : 112 * Math.pow(2, -10 * p) * (1 - p);
        s.style.transform = `translateY(${y.toFixed(2)}%)`;
      });
      rise(figures, 2.2);
      rise(labels, 2.45);
      return {};
    },
  },
];
