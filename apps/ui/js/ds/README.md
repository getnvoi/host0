# ds

React copies of vrcl's nvoi-ui components (packages/gems/nvoi-ui/app/components/ds in the vrcl repo). The CSS in
css/ds is theirs, unchanged; the markup here must produce the same elements, classes and attributes as each
component.rb (and its .erb, if any), so that CSS applies as is.

- One file per component: js/ds/<name>.tsx, exported as the component's name in PascalCase (Ds::Head::Component is
  `Head`; nested ones, like Ds::Head::Title::Component, are `HeadTitle` in head.tsx).
- Props are the component's options, camelCased. Slots (renders_one / renders_many / content) are children or named
  ReactNode props.
- Stimulus controllers (controller.js) become hooks or effects inside the component, with the same behaviour.
- Icons are lucide only: the `glyph` option takes a glyph name and renders `<Glyph name=... />` (js/ds/glyph.tsx),
  which maps vrcl's glyph names to lucide icons. No pixel glyphs, no illustrated icons (Ds::Icon drawings).
- Copy, do not invent: no variants, options or behaviour the original does not have.
