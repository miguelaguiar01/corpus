# Design

The visual system behind every Corpus surface (spec §9). Tokens live in
`apps/web/src/app/globals.css`; this page records what they are and the
principles that decide how they are used.

## Principles

1. **Project text first.** A project's own strings are the largest thing
   on any page that shows them (22–28px, regular weight). Corpus's chrome
   stays smaller and quieter than the text it is there to serve.
2. **Colour means state.** Hue is reserved for translation state: verified
   is moss, stale is amber, destructive actions and errors are red.
   Everything else, including untranslated and translated, is achromatic.
   A coloured element is never decoration.
3. **One family pair.** IBM Plex Sans for chrome, IBM Plex Mono for
   identifiers (string keys, ICU braces, tokens). Nothing else.
4. **Structure by spacing and hairlines.** Sections are separated by
   rhythm and one-pixel borders, not by cards, shadows, or eyebrows.
   Section headings are sentence case, small, and muted.
5. **Same shell everywhere.** Every page renders inside the one app shell
   with the same header, active navigation, and page-header treatment.
6. **Thumb height on phone, inline on desktop.** Primary actions sit in a
   fixed bar at the bottom on phones and move inline with their content
   from `lg` up.

## Type

Loaded with `next/font` in `apps/web/src/app/layout.tsx`. The files are
fetched once at build time and served from `/_next/static`, so the CSP's
`default-src 'self'` covers them and the running app makes no font
requests.

| Role | Face | Weights |
|---|---|---|
| Chrome, project text | IBM Plex Sans | 400, 500, 600 |
| Identifiers, ICU | IBM Plex Mono | 400, 500 |

Scale, exposed as Tailwind's `text-*` utilities:

| Utility | Size | Line-height | Use |
|---|---|---|---|
| `text-xs` | 12px | 1.5 | chips, meta, counts |
| `text-sm` | 14px | 1.5 | body chrome, section headings (500, muted) |
| `text-base` | 16px | 1.5 | form text, editor target |
| `text-lg` | 18px | 1.5 | project text in lists |
| `text-xl` | 22px | 1.25 | project text in the editor, on phones |
| `text-2xl` | 28px | 1.25 | page titles (600), project text on desktop |
| `text-3xl` | 36px | 1.25 | the one hero moment, if a page has one |

`font-semibold` and `font-bold` both resolve to 600, so bold never
synthesises. Numerals are tabular everywhere (`body`), so counts align
in tables and chips.

## Colour

Both themes use a barely-warm neutral base (hue 80–85 in OKLCH, chroma
under 0.01) and an ink foreground. The theme follows the system
preference; there is no toggle and no `.dark` class, so components use
token colours only.

| Token | Meaning |
|---|---|
| `background`, `foreground` | page ground and ink |
| `card`, `popover` | raised surfaces, one step off the background in both themes |
| `muted`, `muted-foreground` | quiet fills and secondary text |
| `secondary`, `accent` | control fills; achromatic |
| `primary` | the ink button; achromatic |
| `border`, `input`, `ring` | hairlines and focus |
| `destructive` | errors and irreversible actions, red |
| `state-verified` | verified translations, moss |
| `state-stale` | stale translations, amber |

Contrast of the foreground pairs, computed from the OKLCH values:

| Pair | Light | Dark |
|---|---|---|
| foreground on background | 17.3 | 16.0 |
| muted-foreground on background | 5.8 | 7.2 |
| state-verified-foreground on state-verified | 5.0 | 8.7 |
| state-stale-foreground on state-stale | 9.2 | 10.3 |
| destructive on background | 5.1 | 5.7 |

All text pairs clear 4.5:1 in both themes.

## Shell

Every page renders inside `AppShell`: a header at least 56px tall with
the wordmark, the project switcher and the primary navigation when there
is a project, and the page below. The current navigation item carries
`aria-current="page"` and a two-pixel underline in the foreground; the
others are muted. The header wraps on a phone rather than overflow.

`Page` gives each page its width and gutters: `form` (28rem) for a single
column of fields, `reading` (42rem) for text and lists, `wide` (72rem)
for facets, grids and two panes. `PageHeader` sets the title, an
optional one-line meta, and optional right-aligned actions.

## Primitives

Four small components in `apps/web/src/components/ui` carry the
structure, so pages never hand-roll it:

- `Section`: a sentence-case heading (14/500, muted), an optional meta
  at the right end of the heading line (a count, a total) and an
  optional description, then the content. Pages are a page header
  followed by sections.
- `Field`: label, one control, optional hint and error. The control is
  labelled by the label and described by the hint or error; an error
  marks it invalid and is announced.
- `Banner`: feedback with a tone, usually one line. Warning is the stale
  amber, error is destructive and an alert; info and success are
  achromatic and a status.
- `Chip`: a small label. Neutral and outline for metadata and facets,
  solid for a selected control, key (mono) for identifiers and ICU
  placeholders, and the two state variants. `chipVariants` gives the
  classes to a link or button that looks like a chip.

Buttons follow one rule: one primary per view, the action the page is
for; secondary actions are outline; anything else is a text link. No
shadows on controls.

## Spacing and shape

A 4px grid through Tailwind's spacing scale. Two radii: `rounded-md`
(6px) for controls and chips, `rounded-lg` (10px) for cards. Borders are
one pixel in the `border` token. No shadows.

## Not doing

Cream backgrounds and serif display faces; a single acid accent; the
card-kit layout with a shadow under everything; uppercase eyebrow labels;
middle-dot meta strings; arrows appended to link text; motion that is not
a response to the person's action.
