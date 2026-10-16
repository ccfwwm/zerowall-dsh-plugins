---
name: univer-slide
description: Create, redesign, edit, lint, screenshot and export editable Univer Slide Units. For scientific decks load zerowall-presentation for evidence, rich content, independent multi-image assets and batch review. Passive PPTX reading uses Host extraction.
---

# Univer Slide Units

The user's requested template, visual language, density, page count and settings take precedence. Layout examples and numerical defaults are guidance for unspecified choices, not restrictions. Follow minimalist, dense, dark or other requested styles, chosen fonts/colors, image labels and requested headers/footers. There are no word-count, image-count or layout quotas. Local edits preserve the surrounding design; redistribute content within the requested total slide count instead of adding pages to meet a density target. Fit images and text together with deliberate hierarchy, alignment and spacing. Omit automatic top-left kickers and decorative labels unless the user or page plan needs them. Generated image prompts follow the requested style and may include readable text; there is no universal palette, background or no-text rule.

Load `univer` first. `univer_execute` provides `univerAPI`, `api` (the same object), and `presentation` (the `FPresentation` selected by `unitId`). Do not redeclare them. A Slide Unit does not provide `workbook`; if it is undefined, verify the selected Unit type.

Facade page indexes are zero-based (`getSlideByIndex`, `getSlides()[i]`). Tool page numbers are one-based: `univer_compile_svg.page` and numeric `univer_lint.pages` use `1` for the first page. Prefer stable page IDs when carrying a page from inspection into Facade code.

Scientific decks follow zerowall-presentation: extract evidence, plan the complete rich content, design assets and layout together, batch-build all pages, check the deck, repair only failed pages, then export and read back. Multiple literature/generated images per page are supported. Generated graphics may contain accurate readable labels and explanatory text; inspect Chinese glyphs, spelling and layout. Formal report pages show substantive report content, with provenance and production explanations in speaker notes by default. Use clear hierarchy and varied layouts instead of uninterrupted paragraphs. No mandatory style exploration or seed/edit ceremony. Use presentation_prepare with file/unitId/worktreeId and batch presentation_* tools. Preserve model and quality settings.

## Route the task

- Create or redesign a page: author SVG and call `univer_compile_svg`. Do not hand-write Facade drawing calls for generated page content.
- Edit existing content: use `univer_execute` with live Facade handles.
- Insert or update native charts: reserve the rectangle in the page SVG, then use the direct
  `FSlide` chart methods through `univer_execute`.
- Verify every changed page: `univer_inspect`, then `univer_lint`, then `univer_screenshot` and inspect the returned PNG.
- Export only after verification: `univer_export` to `.pptx`.

## Presentation structure

A presentation contains ordered slides. A slide contains elements in bottom-to-top stacking order. Shapes, text boxes, images, groups, tables, and charts are elements. A text box is a shape. Imported decks may contain additional element kinds; query their Facade before editing. After the final SVG replacement, use getSpeakerNotes()/setSpeakerNotes(string) to record per-page sources, figure provenance and image explanations. Master/layout pages require separate explicit support.

## Multi-page deck workflow

### 1. Write the page specification

Before drawing, write a workspace `presentation-spec.json` (the single content and layout plan; no duplicate spec.md required) with final copy and a coherent visual system derived from the user's requirements. Revise it when content or visual review calls for a better arrangement. Record deck-level choices: `#RRGGBB` colors, font roles in points (`design px × 0.75`), font families, icon/illustration style, and page size.

For every page specify:

1. Planned content regions and page dimensions; use the layout that the content and requested style need.
2. Structure type such as process, hub-spoke, layers, circular stages, timeline, comparison, card grid, or hero.
3. Page purpose and primary takeaway, allowing multiple topics where the requested content needs them.
4. Verbatim final copy for every title, label, card, and annotation.
5. Required workspace image or SVG assets. Describe asset meaning here; select concrete resource handles while building the page.

Use a coherent page rhythm: repeat structures where comparisons benefit from consistency, and vary them when the content needs it. For reconstruction, transcribe reference text exactly.

### 2. Batch-build the complete deck

Plan every page first, then compile pages serially with presentation_compile_pages. Do not finish page N before beginning page N+1. Check and repair affected pages after the initial deck exists.

1. Prepare this page's local assets and record paths in the spec. For bundled icons, logos, emoji, or illustrations, use `univer_resources` `find` followed by `export` into a workspace resource directory. Copy returned handles exactly, keep a consistent registry/style baseline, and reuse prior exports deliberately. Do not substitute Unicode glyphs or empty placeholders for required visuals.
2. Hand-author the complete `page-NN.svg` with inline styles and workspace-relative assets. Keep every page SVG through delivery.
3. Call `univer_compile_svg` with explicit `source`, target `file`, draft `worktreeId`, Slide `unitId`, one-based `page`, and default `mode: "replace"`.
4. Record compiler warnings per page. Fix fatal compilation errors; review nonfatal warnings after the initial batch and repair only affected pages. Retain a warning only when the actual screenshot confirms the intended result.
5. After the batch, call presentation_check_pages for actual inspect/lint/screenshot coverage. Native charts, tables and notes are inserted after the final SVG replacement.
6. After reviewing the deck, fix affected SVGs and replace only those pages. Resolve or explicitly justify each surviving finding.

Never use `mode: "add"` to fix a page. Add overlays the corrected content while leaving the broken elements underneath. Rework by editing the source SVG and replacing the same page. Use `add` only for genuinely new elements on a finished page.

### 3. Review the deck

Review the current PNGs already returned by presentation_check_pages in batches of at most five pages. Do not capture the same accepted page revision again; call univer_screenshot only for changed pages or missing screenshot coverage. Pass the explicit Slide `pages` and a workspace `output` directory; use `contactSheet: true` only as an additional deck overview, never as the only per-page evidence. Check:

1. Elements clipped by or beyond the page.
2. Text overflowing cards or colored regions.
3. Text boxes overlapping unexpectedly.
4. Shapes hiding required information.
5. Low contrast or text placed over a complex image without backing.
6. Missing requested content.
7. Arrowheads disconnected, misdirected, or mismatched in color.
8. Cross-page consistency in palette, fonts, icon style, margins, and structure diversity.

Treat each defect as a pattern: search all page SVGs for the same mistake, fix sources, replace affected pages, rerun checks only for affected pages, and re-screenshot the affected pages. Record an explicit PASS or FAIL with observed evidence for every checklist item; repair layout defects automatically and ask only for substantive missing requirements or an unrecoverable external failure.

### 4. Deliver

Deliver the requested formats after exported-file validation. For a standalone .univer requested by the user, ready/status/merge the accepted draft and inspect trunk in a fresh call; retain drafts when continued editing is requested.

## SVG is the generation path

For new pages or generated elements, author SVG and compile it. The compiler owns geometry, baseline conversion, text measurement, page selection, and common Facade workarounds. Native charts and tables are the deliberate exceptions; reserve their rectangles in SVG and insert them after the final replacement.

A new Slide Unit already contains one empty page. Compile page 1 into it. Do not call `appendSlide()` for the first page; use it only for page two and later. The default page is 960 × 540 with a top-left origin.

`univer_compile_svg` is declarative:

- Replacing an existing page clears and rebuilds it.
- Targeting `pageCount + 1` appends a page.
- A larger page number fails.
- Reapplying the same replacement is idempotent.
- `mode: "add"` overlays without clearing existing elements.

Use browser-valid SVG: shapes, paths, transforms, gradients, text, bitmaps, `<use>`, style sheets, CSS units, and color functions. `<image>` must declare width and height and may reference only an asset inside the session workspace.

Break lines with `<tspan>` using scalar `x` and absolute `y` or non-zero `dy`. Do not use `dx`, per-glyph coordinate lists, or spaces for layout. Default SVG whitespace collapses consecutive and leading spaces. Use `xml:space="preserve"`, positioned text elements, or `&#160;` for deliberate fixed gaps.

Center badge/circle text with `dominant-baseline="middle"` and `text-anchor="middle"`. Draw arrowheads with `<marker orient="auto-start-reverse">`; do not hand-place triangle vertices. Gradient coordinates default to object bounding-box fractions, so a vertical gradient uses `x2="0" y2="1"`.

The Slide renderer cannot faithfully reproduce filters, translucent gradients, or radial gradients on non-square shapes. Mark only the affected subtree `data-univer-embed="image"` when bitmap embedding is acceptable; keep editable text and layout structure outside it. Compiler warnings can indicate degraded or dropped content. Record nonfatal warnings for review after batch construction and resolve or justify them using actual screenshots before export; compilation failures need immediate correction.

External workspace SVGs may be referenced with `<image href="./path/icon.svg" ...>`. A self-authored graphic reused in one page may use `<defs><symbol>` and `<use>`. Do not copy truncated path data out of an asset merely to inline it.

## Layout lint discipline

`univer_lint` uses rendered glyph geometry for three conservative rules:

- text off the page;
- text escaping an opaque rectangular container;
- overlapping text glyph bands.

Treat every finding as real until its evidence proves the overlap intentional.

- Off-page text is clipped and must be fixed.
- Escaping a card usually needs shorter copy, explicit line breaks, or a wider/taller card.
- For text overlap, inspect both elements, colors, opacity, and intended stacking before deciding.
- Every finding must end as fixed or explicitly justified in the final report.

Structured inspection proves stored IDs, types, transforms, text, fill, stroke, and order. Lint proves only the three text-layout rules. Screenshot review proves the rendered frame actually inspected and is necessary for wrapping, centering, alignment, contrast, imagery, and overall composition. It does not prove transition playback or uninspected pages.

## Deck and pages through Facade

Select pages with `presentation.getSlideByIndex(0)`, `presentation.getSlideById(id)`, or `presentation.getSlides()`. Backgrounds support colors, images, gradients, and patterns through `slide.setBackground`. `deleteSlide`, `insertSlide`, and `moveSlide` return booleans; check them. Slides have no formulas or recalculation.

## Elements

Read with `getElements()` or `getElementById(id)`; `getShapes()`, `getImages()`, and `getGroups()` narrow the type. Every element exposes `getId()`.

Create a normal shape with `slide.insertShape({ shapeType, transform?, shapeData? })`. It returns a live handle or `null`; check it and retain `getId()` immediately. Mutate the live handle. `getShapeData()` is detached, so modifying its object does not persist; use `setShapeData` or dedicated setters.

`slide.insertElement(element, index?)` restores a complete snapshot with explicit identity. Use it only when restoring imported snapshot IDs and references, not for ordinary authoring. Images use `newImage().…build()` followed by `insertImage`. Delete with `deleteElement(element)`, not an id. Check boolean/null mutation returns.

## Text

Font size is in points while positions and boxes use pixels. Convert design pixels with `fontSize = px × 0.75`.

Do not rely on text-box defaults. Explicitly set wrapping, auto-fit, and padding. For measured single-line text:

```js
shape.getText().setText("...").setTextBoxOptions({
  textWrap: univerAPI.Enum.ShapeTextWrapType.None,
  autoFitType: univerAPI.Enum.ShapeTextAutoFitType.NoAutoFit,
  padding: { left: 0, top: 0, right: 0, bottom: 0 },
});
```

For wrapped text, use `Square`, explicit padding, and enough height. A starting estimate is `lines × fontSizePx × 1.4`. `univer_compile_svg` emits the measured single-line contract automatically.

Use the rich-text builder for multiple styles or lines. Break lines with `.paragraph()` and never put `\n` inside `.span()`. Repeat line-height settings for every paragraph. `univerAPI.newRichText()` takes no argument.

### Read and edit existing text

Styled text is a flat stream plus `[st, ed)` text runs. Each paragraph ends in `\r`, which must never be deleted.

Copy rich text immediately, including for reads:

```js
shape.getText().getRichText()?.copy()?.toPlainText();
```

Without `copy()`, `getTextRuns()` can silently return an empty array. Edit the copy and persist it with `setRichText`:

```js
const rt = shape.getText().getRichText().copy();
for (const paragraph of rt.getParagraphs()) {
  for (const run of paragraph.getTextRuns()) {
    if (run.getText() === "48%") run.setText("52%");
  }
}
shape.getText().setRichText(rt);
```

`run.setText()` keeps style and shifts later runs. Emptying a run invalidates its handle. After any insert/delete, reacquire run handles. Insert unstyled text first and then apply style; always pass both offsets to deletion. Prove each write with a fresh read-only execution.

## Shapes, fill, and stroke

Query `ShapeTypeEnum`, `ShapeFillEnum`, and `ShapeLineTypeEnum`. Geometry belongs in `transform`; visual data belongs in `shapeData`. For every manual element, set fill, stroke, and text color explicitly.

- Fill with `setSolidFill`, `setGradientFill`, `setImageFill`, or `setNoneFill`.
- For visible strokes, set color and width explicitly.
- For no stroke, call `setStrokeLineType(api.Enum.ShapeLineTypeEnum.NoLine)`; width zero does not disable a line.
- Use `#RRGGBB` or `rgba(...)`; color names and `hsl()` are unsupported.

Connectors use `bindStart` / `bindEnd` with stable target shape IDs. Arbitrary paths require `setCustomGeometry` with `dataArray`; prefer SVG compilation for complex geometry.

## Images

Use bitmap images for photos, logos, QR codes, complex illustrations, and 3D icons instead of Unicode or assemblies of primitives. In SVG, reference a local workspace asset:

```svg
<image x="0" y="0" width="240" height="160" href="./materials/photo.png"/>
```

The compiler validates PNG, JPEG, GIF, WebP, and SVG files. Register raster images in the page assetIds before composition. Image shape opacity may be lost during PPTX export: the presentation wrapper bakes it into an alpha PNG derivative used by both preview and export. Keep images outside translucent groups. Avoid placing any image above formal text/chart/table bounds; image occlusion is checked in addition to glyph lint. Facade insertion supports Base64 and URL sources, but local Base64 is more reproducible. Crop values are displayed-element pixel distances, not source pixels or percentages. Never place a full-page reference screenshot behind editable elements.

## Editing existing pages

For a dense page, track logical block element IDs. To rebuild one block, delete all its old elements before applying an SVG containing only the new block with `mode: "add"`. If identity or coverage is uncertain, redraw the entire page and replace it. Always inspect and lint the full page after block edits.

## Stacking order

There is no `zIndex`; element order is bottom to top. SVG document order is preserved. A normal insertion lands on top. Use element reorder methods when available or the complete `slide.command.reorder-elements` command after confirming its exact API.

The reorder command requires the complete order. A partial list moves listed elements to the bottom. A wrong ID may return success as a silent no-op, so always read `getElements().map((item) => item.getId())` back.

## Native charts

Create detached chart information directly from the slide, call `.build()`, then await
`slide.insertChart(info)` to obtain a live `FSlideChart`:

```js
const slide = presentation.getSlideByIndex(0);
const info = slide
  .newChart(univerAPI.Enum.ChartTypeString.Donut)
  .setTitle({ text: "Design Elements" })
  .setSource([
    ["Design element", "Share"],
    ["Color", 30],
    ["Composition", 22],
  ])
  .setCategoryField(0)
  .setValueFields([1])
  .setDoughnutHole(0.46)
  .setLegend(true)
  .setAbsolutePosition(390, 160)
  .setSize(260, 220)
  .build();
const inserted = await slide.insertChart(info);
return { chartId: inserted.getId(), info: inserted.getInfo(), resource: inserted.getChartData() };
```

`slide.getCharts()` and `slide.getChart(id)` return live charts. Await
`chart.setDataSource(values)` for data changes. Common setters update the live chart; for a complete
replacement, use `chart.toBuilder().build()` and `await chart.update(info)`. Remove it with
`await chart.remove()` and check the boolean. Verify in a fresh execution with
`slide.getCharts().map((item) => ({ id: item.getId(), type: item.getType(), info: item.getInfo(), resource: item.getChartData() }))`.
Insert charts after the final full-page SVG replacement, because replacement clears every page
element.

## Transitions

A transition belongs to the destination slide. Query transition APIs before use and verify only through `getTransition()`; inspection and lint do not prove playback.

```js
const slide = presentation.getSlideByIndex(2);
slide.setTransition({
  type: univerAPI.Enum.SlideTransitionTypeEnum.Push,
  duration: 1000,
  direction: univerAPI.Enum.SlideTransitionDirectionEnum.Right,
});
return slide.getTransition();
```

Direction applies only to directional transition types and can otherwise be dropped. Auto-advance and sound fields are stored but not played; do not claim support.

Use supported chart axis bounds when needed. The pinned setYAxis facade drops interval/majorUnit; for fixed numeric tick spacing call presentation_set_chart_ticks with page, actual chart_id, axis, mode: fixed and positive major_unit. Use mode: automatic without major_unit to restore automatic ticks. It persists majorUnit through the official snapshot command and keeps native editability. Chart resource changes invalidate only affected pages. The pinned presentation export adapter preserves speaker notes while retaining editable objects. Reserve margin for CJK font metrics with adequate table label-column widths. Render/read back the export before acceptance. For standalone .univer delivery, use univer_worktree(action: ready), the separate univer_status tool, then univer_worktree(action: merge) after export validation and inspect the completed Unit from trunk. Status is never a worktree action. Merged drafts are terminal.

## Tables

A native table is one editable element, unlike an SVG grid of loose shapes. Build with `slide.newTable()`, configure values, rows/columns, dimensions, position, size, then `slide.insertTable(builder.build())`. Cells are zero-based and expose rich text.

Table style requires both a valid style ID and matching role options such as `{ firstRow: true, bandRow: true }`. `setStyleId` does not validate; a typo silently loses styling. Verify with `table.describe()` and relevant cells.

## Capability limits

- Element animation and master/layout-page editing are unsupported. Speaker notes use the direct FSlide getter/setter after final SVG replacement.
- Non-image elements do not support arbitrary clipping, masks, blur, or glow.
- Letter spacing is stored but not rendered.

Always finish with complete structural readback, `univer_lint` for every changed page, rendered screenshots of every page, and the `univer` ready/status workflow.


## Editable reconstruction and image refinement

Continue using gpt-image-generator generate_image/edit_image during reconstruction and final polishing for separate illustrations, icons, textures and backgrounds. Keep the environment image configuration, independently of media-project models. Inspect new assets, keep real PNG/.generation.json receipts, register distinct asset IDs with presentation_record_assets and suitable illustration/icon/background roles, and update the page assetIds, editable image-element plan and SVG together. Backgrounds omit formal titles/body/data labels; reconstruct those as editable objects. Preserve the complete prototype separately as reference-only role: template. Raster assets remain independently movable/replaceable; never flatten the final page. Reuse successful assets and only recheck affected pages. Independent image requests have at most two-way concurrency; writes to the same draft are serial.


## Required ZeroWall page prototypes

For every newly authored PPT/PPTX page, load zerowall-presentation and gpt-image-generator. After the complete content plan and presentation_prepare, call presentation_generate_templates to generate a whole-page non-editable PNG prototype using the environment image configuration, inspect it, then call presentation_plan_editable_pages and reconstruct the editable SVG/native objects. A background or illustration alone does not satisfy this stage. Keep the whole-page PNG as reference-only; final titles, body, shapes, connectors, charts and tables must be editable. Do not silently skip prototypes if generation fails. Independent page images may run in parallel with at most two image requests; writes to one draft are serial. Local edits may reuse existing prototypes and preserve unaffected pages.


## ZeroWall illustration routing

For PPT/PPTX illustrations load gpt-image-generator and use generate_image/edit_image with the environment-configured image model, group and parameters. Register the real workspace PNG and .generation.json receipt with presentation_record_assets. Do not create media projects or jobs or call media-create/media_models/media_import/media_project/media_job for deck images. Keep the selected image settings on errors and report the actual configuration failure; do not switch routes. Only explicitly requested video, audio/music or promotional-video generation may use media-create; its images are video references. Ordinary image generation and editing always use gpt-image-generator without changing the deck image workflow.


## ZeroWall checks and export recovery

Read presentation_check_pages top-level presentationFindings or presentation_status for page numbers, finding hashes and export blockers. These fields belong to ZeroWall, not the canonical univer_lint result. Record page reviews with presentation_record_reviews(reviews: [{kind: "page", target: "N", observations: "actual screenshot observations", waivers: []}]). For command-line recovery resume presentation_prepare with the same spec/manifest/file/unitId/worktreeId, check and review only blocked pages, then univer_export to a new .pptx path. presentation_status state.exportReceipt records the final notes-preserved size and SHA-256. Exported-awaiting-readback requires rendering/reopening the actual exported PPTX. INVALID_TOOL_OUTPUT involving presentationFindings is a plugin interface failure; keep the draft and update the plugin. Do not bypass review checks or substitute an older output.
