<!-- stardust:provenance
  writtenBy:        stardust:extract
  writtenAt:        2026-11-16T15:30:00Z
  mode:             descriptive (current state of https://main--wknd--aem-growth-adoption.aem.live)
  readArtifacts:
    - stardust/current/_brand-extraction.json
    - stardust/current/_computed-styles.json
    - stardust/current/pages/*.json (5 pages)
    - stardust/current/DESIGN.json (extensions.breakpoints from cap-probe)
  synthesizedInputs: []
  stardustVersion:  0.37.2
-->
---
name: WKND
description: Adventure and travel magazine site, black-and-white editorial with a single electric-yellow accent.
colors:
  wknd-yellow: "#ffea00"
  ink: "#202020"
  paper: "#ffffff"
  mist: "#ebebeb"
  light-surface: "#f7f7f7"
  dim-gray: "#696969"
  link-blue: "#0045ff"
  indicator-gray: "#afafaf"
typography:
  display:
    fontFamily: "asar, asar-fallback, georgia, 'Times New Roman', times, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  headline:
    fontFamily: "asar, asar-fallback, georgia, 'Times New Roman', times, serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  title:
    fontFamily: "asar, asar-fallback, georgia, 'Times New Roman', times, serif"
    fontSize: "24px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "'Source Sans Pro', source-sans-pro-fallback, 'Helvetica Neue', helvetica, arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  label:
    fontFamily: "'Source Sans Pro', source-sans-pro-fallback, 'Helvetica Neue', helvetica, arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  label-lg:
    fontFamily: "'Source Sans Pro', source-sans-pro-fallback, 'Helvetica Neue', helvetica, arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  none: "0px"
  circle: "50%"
spacing:
  gutter: "14px"
  content-max: "1164px"
  shell-max: "1680px"
  header: "200px"
  button-size: "48px"
components:
  button-primary:
    backgroundColor: "{colors.wknd-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "14px 35px"
  button-secondary:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "1rem 2rem"
    height: "48px"
  nav-item-active:
    backgroundColor: "{colors.wknd-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0px 17px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  footer:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.mist}"
  portrait:
    rounded: "{rounded.circle}"
---

# Design System: WKND

## Overview

**Creative North Star: "The Trail Journal"**

WKND reads like a printed outdoor magazine: big full-bleed landscape photography carries the emotion, while the chrome stays monochrome, square, and quiet. A white page, near-black ink (#202020), and a single electric yellow (#ffea00) do all the work. The yellow is never decorative fill; it marks action (buttons), position (the active nav item), and emphasis (a short 2px rule under section titles).
