---
name: Ace & Clay
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#3d4947'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#6d7a77'
  outline-variant: '#bcc9c6'
  surface-tint: '#006a60'
  primary: '#00685d'
  on-primary: '#ffffff'
  primary-container: '#008376'
  on-primary-container: '#f4fffb'
  inverse-primary: '#6fd8c8'
  secondary: '#556500'
  on-secondary: '#ffffff'
  secondary-container: '#ceed3e'
  on-secondary-container: '#596a00'
  tertiary: '#97422b'
  on-tertiary: '#ffffff'
  tertiary-container: '#b65a41'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#8cf5e4'
  primary-fixed-dim: '#6fd8c8'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005048'
  secondary-fixed: '#d1f041'
  secondary-fixed-dim: '#b5d321'
  on-secondary-fixed: '#181e00'
  on-secondary-fixed-variant: '#3f4c00'
  tertiary-fixed: '#ffdbd2'
  tertiary-fixed-dim: '#ffb4a1'
  on-tertiary-fixed: '#3c0800'
  on-tertiary-fixed-variant: '#7c2e19'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
  app-green: '#00685d'
  app-green-hover: '#007a6c'
  app-green-soft: 'rgba(0, 104, 93, 0.08)'
  app-card: '#ffffff'
  app-border: 'rgba(0, 0, 0, 0.06)'
  app-muted: '#86868b'
  app-fill: '#f5f5f7'
  app-text: '#1d1d1f'
typography:
  display-lg:
    fontFamily: Montserrat
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Montserrat
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Montserrat
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Montserrat
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.03em
  app-ui:
    fontFamily: '-apple-system, BlinkMacSystemFont, SF Pro Display, SF Pro Text, Apple SD Gothic Neo, Noto Sans KR, sans-serif'
    pageTitle:
      fontSize: 32px
      fontWeight: '600'
      letterSpacing: '-0.03em'
    pageSubtitle:
      fontSize: 15px
      fontWeight: '400'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  app-card: 1.25rem
  app-list-card: 0.875rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 40px
  xl: 64px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
---

## Brand & Style

The design system is built to evoke the physical energy of a premium tennis club—sun-drenched courts, crisp white lines, and the vibrant pop of a new ball. It targets club administrators, coaches, and active members, necessitating a balance between high-utility management tools and an inviting, community-focused atmosphere.

**Current shell (2026):** The main UI uses a **light, Apple-inspired** presentation—system typography, generous whitespace, thin borders, and minimal shadow—while keeping **tennis court green (`#00685d`)** as the primary accent. Mode is **light only** (no dark theme).

The aesthetic is **clean and calm first**, sporty second. High-energy secondary colors (tennis-ball yellow, clay orange) remain in the token set for calendar chips, status badges, and legacy Tailwind classes, but they are no longer the default look for page chrome or primary buttons.

**Design refresh (2026-09):** A single override layer at the end of the `<style>` block in `index.html` ("Design refresh 2026-09") calms the shell:

*   **No card-in-card on the schedule page.** Schedule dates are plain headers above the match cards. Match row cards (`.app-list-card`) and overview cards (`.dash-overview-card`) keep their original style: my matches use the green border + soft green gradient; overview cards never show the Kakao badge.
*   **Calendar status colors.** 미정 (no response) and 참석 share the same green (tint chip on PC, green dot on mobile); 참석 adds a marker (1px green border on the PC chip; a white ✓ inside the same-size 8px green dot on mobile). On mobile, 미정 dots use a lighter green (`#8fc7ba`) so the three states differ in brightness; 불참 is grey. Closed uses a soft red tint; book club / Yonsei keep their own category colors. No neon yellow-green chips. A legend (`.calendar-legend`) under the grid explains the three states: mini chips on PC, dot + label on mobile.
*   **Open calendar grid.** Desktop month view has no boxed cells—only row hairlines; today is a green number circle, past days are muted numbers.
*   **Quiet Kakao marker.** `.kakao-badge` is a grey pill with a small yellow dot; it is always hidden on overview cards and hidden on list rows in review mode (every row there is Kakao). The yellow "카카오톡에서 보기" link stays yellow.
*   **Detail info (B-2).** The match detail shows 장소 · 날짜 · 시간 · 개설 · 날씨 as label + value cells directly on the white card—no grey panel, no divider lines. Long values (장소, 예보) span the full row on mobile; short ones pair up in two columns. PC uses three columns (장소 · 날짜 · 시간 / 개설 · 날씨 with forecast inline). Times use 24h `12:00–15:00`. The lower sections follow the same idea: attendees are avatar + name cells (3 columns mobile, 4 on PC) without boxes, absentees are a small toggle, the Kakao read-only notice is one compact row, and comments are a flat list (name · time, message) with no per-comment boxes.
*   **Schedule row icon = my RSVP.** 참석 → racket (`sports_tennis`, green), 미정 → question mark (`help`, light green), 불참 → calendar ✕ (`event_busy`, grey). Book club / Yonsei keep their category colors. "참석자 없음" is shown in the attendee line, not by the icon.
*   **Korean UI labels.** Navigation, breadcrumbs, month/weekday labels, profile stats and the comment section are Korean (홈 / 일정 / 내 정보, 2026년 9월, 일–토, 댓글). Overview cards lead with a D-day (오늘, D-4).
*   Refined tokens: `--app-green #0b6a5c`, `--app-fill #f3f4f1`, `--app-text #17201c`, `--app-muted #6b7470`, `--app-line rgba(23,32,28,.06)`, `--app-clay #9a4a31`.

## Implementation map

When editing UI, treat these as the source of truth:

| Layer | Where | Use for |
|-------|--------|---------|
| **Apple UI shell** | `body.apple-ui`, `:root` `--app-*` in `index.html` | Page background, titles, cards, nav, buttons, forms |
| **Utility classes** | `.app-page-title`, `.app-card`, `.app-list-card`, `.app-chip`, `.app-icon-btn`, `.app-segment` | New or restyled surfaces |
| **Legacy Tailwind tokens** | `tailwind.config` colors in `index.html` + YAML `colors` above | Calendar event chips, member gender badges, some detail states |

Do not reintroduce removed patterns on main surfaces: colored top borders on cards (`border-t-4`), heavy gradients on buttons, pulse animations on calendar dots, or Montserrat for page titles inside `.apple-ui`.

## Colors

### Apple UI (primary shell)

These map to CSS variables in `index.html` (`:root`).

*   **App green (`#00685d`):** Primary actions, active nav, links, today highlight on the calendar. Hover: `#007a6c`.
*   **App text (`#1d1d1f`):** Headlines and primary body text.
*   **App muted (`#86868b`):** Subtitles, metadata, weekday labels.
*   **App fill (`#f5f5f7`):** Page background, icon buttons, filter chips (inactive), input-adjacent fills.
*   **App card (`#ffffff`):** Cards, sheets, list rows.
*   **App border (`rgba(0,0,0,0.06)`):** Card and field outlines—preferred over strong shadows.

### Legacy / semantic tokens (still in code)

The YAML palette and Tailwind `primary`, `secondary`, `tertiary` tokens are **unchanged** and still appear in:

*   Calendar day chips and dots (match type, book club, events)
*   Schedule row icon backgrounds
*   Error / destructive actions (e.g. leave match, delete)

*   **Primary (`#00685d`):** Same green as `--app-green`; brand anchor for both layers.
*   **Secondary / tertiary:** Use sparingly for **semantic** color inside content, not for global chrome.
*   **White & neutrals:** Cards stay white; page shell uses `#f5f5f7` in the Apple layer (legacy `background` token remains `#f8f9fa` in Tailwind for older classes).

## Typography

### Apple UI shell

**System stack** (via `.apple-ui`): `-apple-system`, `SF Pro Display`, `SF Pro Text`, `Apple SD Gothic Neo`, `Noto Sans KR`.

*   **Page title** (`.app-page-title`): 32px / weight 600 / letter-spacing -0.03em
*   **Page subtitle** (`.app-page-subtitle`): 15px / weight 400 / `--app-muted`
*   **Body in lists and forms:** 14–16px, weight 400–600

### Legacy scale (Montserrat + Inter)

Montserrat / Inter scale in the YAML frontmatter remains valid for **Tailwind `font-display`, `font-headline-*`, `font-body-*`** where those classes are still used (e.g. some detail copy, tailwind config). **Do not** use Montserrat for new work inside `.apple-ui` page headers—use `.app-page-title` instead.

Use tabular numerals for times and counts where possible.

## Layout & Spacing

The layout follows a **Fluid Grid** model with a 12-column structure for desktop and a 4-column structure for mobile.

To maintain the "airy" feel, the design system utilizes generous outer margins and gutters. Components are grouped using a consistent 8px base unit.
- **Desktop:** 48px margins to allow the content to breathe.
- **Mobile:** 16px margins to maximize screen real estate.

Section spacing on Apple UI pages is typically `20–24px` (`space-y-5` / `space-y-6`) rather than the older large gutter-only stacks.

**Mobile forms (schedule / event sheets):** Related fields sit on one row—date + court (or category), start + end; checkbox pairs (regular / closed) side by side.

## Elevation & Depth

Apple UI favors **border + very light shadow** over heavy ambient shadow.

1.  **Level 0 (Base):** `--app-fill` (`#f5f5f7`).
2.  **Level 1 (Cards):** White fill, `1px` `--app-border`, optional `0 1px 2px rgba(0,0,0,0.04)`.
3.  **Level 2 (Sheets / menus):** White panel, `0 8px 30px rgba(0,0,0,0.08)` or similar; backdrop `rgba(0,0,0,0.35)`.

Legacy `shadow-ambient` / `shadow-float` classes may still exist on older markup; prefer `.app-card` for new work.

## Shapes

The shape language is defined by **Rounded** corners, reinforcing the friendly and approachable brand personality.

*   **App cards:** `1.25rem` (20px)
*   **List rows / inner panels:** `0.875rem` (14px)
*   **Buttons / chips / segments:** pill (`9999px`) or `0.625rem` on inputs
*   **Icon buttons:** circular, 32px

Avoid sharp 90-degree angles on interactive containers.

## Components

### Buttons

*   **Primary (`.btn-primary` under `.apple-ui`):** Flat `--app-green`, white text, weight 600—no gradient.
*   **Outline (`.btn-outline`):** White background, `--app-border`, green label.
*   **Icon (`.app-icon-btn`):** Grey fill circle; `.is-primary` variant for green (+) actions.

High-energy yellow secondary buttons are **deprecated for chrome**; keep green as the default CTA.

### Chips & Badges

*   **Filter / sort (`.app-chip`):** Pill, white + border; active state = green fill.
*   **Semantic badges** (calendar, gender, book club): Still use legacy color tokens—do not migrate unless redesigning that component.

### Input Fields

1px `--app-border`, white background, green focus ring (`0 0 0 3px rgba(0,104,93,0.12)`). Labels above fields, weight 500–600.

### Cards

*   **`.app-card`:** Dashboard calendar, courts, member stats, detail sections.
*   **`.app-list-card`:** Schedule rows; `.is-mine` adds soft green tint for the current user's matches.

No colored top-border accents on main cards.

### Navigation

*   **Sidebar / header / bottom tab:** Frosted light background, thin border, active item in `--app-green`.
*   **Brand home:** Logo / wordmark returns to Dashboard and resets calendar month + selected date.

### Lists & Tables

Prefer white list cards with `--app-border` and comfortable vertical padding (~16px). Zebra striping is optional; default list UI is flat white rows on grey page background.
