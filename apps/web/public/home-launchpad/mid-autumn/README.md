# Mid-Autumn native canvas example

Prepared example assets, generated with the built-in imagegen tool. Opening the
example copies these files into a new project; it never starts a model job.

- `concept-a.png`: 3:4 photographic Mid-Autumn poster, midnight teal, gold moon,
  osmanthus, mooncakes and porcelain rabbit. Copy: 月满中秋 / 把团圆，留给今晚.
  A red lantern provides the local-retouch example.
- `concept-b.png`: alternate cream and terracotta paper-cut art direction with
  the same campaign copy.
- `retouched.png`: edit of A removing the red lantern while preserving the moon,
  copy, rabbit, mooncakes and composition; softer moonlight and cleaner shadows.
- `rabbit.png`: transparent extraction of the porcelain rabbit from A.
- `index.html`: editable responsive campaign page using the retouched poster.
  Its primary action explicitly opens a demo note; no registration is submitted.

The native graph and bilingual teaching copy are in `mid-autumn-canvas.ts` and
`canvas-example-copy.ts`. CLI/API clients can reproduce the same example using
project creation, project file upload, and the project canvas-state PATCH API.
The graph does not fabricate media task IDs, run records or provider attribution.
