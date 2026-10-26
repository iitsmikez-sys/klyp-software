# Product-first dashboard and editor design

## Intent

Make Klyp feel like a focused video tool built for streamers. The dashboard should lead people from a VOD to clips; the editor should make the clip, timeline, and next action easy to find. Reduce visual decoration and repeated card styling without removing Klyp's dark identity or green accent.

## Scope

- Redesign the dashboard and full timeline editor first. The landing page, pricing, analytics, and other routes are outside this pass.
- Keep every existing capability, permission gate, cost, and saved state. Do not change clipping, rendering, billing, or Sparks logic.
- Use the current `main` implementation as the base. The full timeline editor is already a separate route with a left library, center preview, right inspector, and bottom timeline; preserve that structure.
- The edit route can also render a legacy editor for older local drafts, and the preview modal uses that legacy editor. This visual pass targets the full timeline editor. Keep the legacy path functional and its compatibility notice readable; a separate visual refresh can follow later.

## Approaches considered

1. **Product-first (selected):** calmer neutral surfaces, stronger preview and timeline hierarchy, fewer competing borders and glow treatments, and a single clear primary action per area. This suits editing work and makes Klyp's actual workflow legible.
2. **Streamer-first:** more color and motion throughout the dashboard and editor. It would preserve energy but compete with the video itself and make dense editing controls harder to scan.

The user selected product-first. My call is to retain Klyp's green for active selection and important actions; all other controls use neutral contrast.

## Dashboard

- Give “Analyze a VOD” the leading position. Align its form, cost, and submit action in one visually coherent work area.
- Keep stream connection and Sparks visible, but quieter than the current task. Keep stats and saved clips subordinate to the result workflow.
- Let real clip thumbnails and titles supply the color and interest in results. Avoid decorative gradients, stacked glow effects, and uniform boxes around every item.
- Use readable type and consistent spacing. De-emphasize microcopy and tiny uppercase labels without hiding useful explanations such as Sparks cost.

## Full editor

- Keep the center preview as the visual anchor. Use one consistent workspace background, with thin separators for the library, inspector, and timeline rather than competing cards.
- Make the current clip title, save state, and Export action clear in the header. Give Preview/Export controls a consistent hierarchy.
- Group inspector controls by task, with readable labels and enough spacing for captions, hooks, format, and media. Keep Pro gates and disabled states obvious.
- Keep timeline tracks easy to distinguish and selection obvious. Do not change drag, trim, split, undo, playback, or export behavior.
- At narrow widths, keep preview visible and use the existing Transcript/Media tabs. The inspector currently stacks below the preview; preserve normal scrolling to reach it. No control may become unreachable or depend on hover.

## Constraints and acceptance

- No new dependencies, generated marketing images, or new editing features.
- Maintain keyboard focus visibility and reduced-motion support. Text must remain readable at common laptop and phone widths.
- Visually review dashboard and editor at desktop and mobile sizes, and exercise the existing core interactions. Run relevant TypeScript/build checks. Report local results separately from hosted behavior.
- No deployment or live claims in this pass.
