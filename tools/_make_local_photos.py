from pathlib import Path

img = Path(__file__).resolve().parents[1] / "img"
scenes = [
    ("library-home.svg", 1600, 900, "#1a4a2e", "#c9a227", "#f4ecd4"),
    ("service-borrowing.svg", 800, 500, "#174d2c", "#e8c56a", "#f7f3e8"),
    ("service-reservations.svg", 800, 500, "#0d351e", "#d9a52b", "#efe6c8"),
    ("service-visit.svg", 800, 500, "#1e3d2a", "#f0d48a", "#f6f0dc"),
    ("service-research.svg", 800, 500, "#143c24", "#c4a35a", "#f3ead6"),
    ("service-digital.svg", 800, 500, "#0f2f1c", "#e0b84a", "#eef4ea"),
]
for name, w, h, green, gold, paper in scenes:
    shelves = "".join(
        f'<rect x="{40 + i * 48}" y="{h * 0.18:.0f}" width="28" height="{h * 0.44:.0f}" rx="2"/>'
        for i in range(12)
    )
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-hidden="true">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{paper}"/>
      <stop offset="55%" stop-color="{green}"/>
      <stop offset="100%" stop-color="#06140e"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="{gold}"/>
      <stop offset="100%" stop-color="#7a5a0b"/>
    </linearGradient>
  </defs>
  <rect width="{w}" height="{h}" fill="url(#sky)"/>
  <rect x="0" y="{h * 0.62:.0f}" width="{w}" height="{h * 0.38:.0f}" fill="{green}" opacity="0.55"/>
  <g fill="{paper}" opacity="0.22">{shelves}</g>
  <rect x="{w * 0.08:.0f}" y="{h * 0.68:.0f}" width="{w * 0.84:.0f}" height="{h * 0.08:.0f}" rx="6" fill="url(#wood)"/>
  <circle cx="{w * 0.82:.0f}" cy="{h * 0.18:.0f}" r="{h * 0.12:.0f}" fill="{gold}" opacity="0.35"/>
  <rect x="{w * 0.14:.0f}" y="{h * 0.48:.0f}" width="{w * 0.22:.0f}" height="{h * 0.16:.0f}" rx="4" fill="{paper}" opacity="0.7"/>
  <rect x="{w * 0.4:.0f}" y="{h * 0.5:.0f}" width="{w * 0.22:.0f}" height="{h * 0.14:.0f}" rx="4" fill="{paper}" opacity="0.55"/>
</svg>
'''
    (img / name).write_text(svg, encoding="utf8")
    print("wrote", name)
