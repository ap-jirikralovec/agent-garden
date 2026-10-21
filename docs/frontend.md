# Frontend architecture

Agent Garden uses Vue Composition API, TypeScript, Pinia and SCSS. The current
garden is **dashboard**. Additional gardens and a header selector are deferred.

- `App.vue` owns the application subscription and explicit refresh requests. It
  renders the shared header, `DashboardGarden` and one shared creation dialog.
  Header and garden emit creation requests; App forwards optional project selection
  to that dialog. It contains no card, filtering or form logic. App also selects
  the favicon from the shared snapshot: live input requests take priority over
  running work, including subagents; a disconnected browser uses the plain icon.
  Browser notifications use the same snapshots, alert only on fresh status
  transitions while the tab is in the background, and reset after disconnects.
- `gardenSync.ts` manages the subscription lifetime. SSE supplies snapshots, with
  an initial HTTP fetch and a five-second polling fallback while SSE is down.
  EventSource reconnects automatically; the next valid stream snapshot stops
  fallback polling. Reads time out after ten seconds and never overlap. A newer
  snapshot invalidates an older pending HTTP response. Unmount closes the stream,
  aborts pending reads and clears polling.
- `stores/garden.ts` owns the last snapshot, loading/connectivity state, notices
  and shared derived state, including provider availability and overview counts.
  Disconnecting retains the snapshot and saved identities. Components use
  `storeToRefs` for reactive state and store actions for shared updates.
  Notification opt-in is stored in the browser because permission belongs to the
  browser origin; it does not change server or provider state.
- The server snapshot orders agents by saved conversation activity and projects
  by their most recently active agent. New sessions use creation time until the
  provider reports activity; empty projects follow active ones in saved order.
  This order is shared by the dashboard, project manager and creation picker.
- `api.ts` is the typed HTTP boundary for snapshots and explicit user actions. It
  retains the server's same-origin request header. Provider and native terminal
  routing remain on the backend.
- `components/` holds the app header, connection settings, global settings, project management, creation dialog and
  provider logo. Dialog fields, errors and pending
  states stay local. `WorkWizard.vue` owns the Work selection, parameter and editable
  review steps through the local `useWorkDraft.ts` state. The creation dialog loads
  local presets on open and reuses the existing agent API for the final reviewed
  prompt; no work is submitted by loading or navigating the wizard. Successful creation/removal requests a refresh from App;
  connection/global settings and project management apply the returned snapshot to Pinia.
  Global external visibility is persisted on the backend and applied before
  snapshots reach the client; it is not another garden-local filter. GardenIcon
  shares the header sprout with the accessible Created in Garden card badge.
  Folder picking runs only on explicit Add project; cancellation retains the form
  and saved projects. The backend opens the host folder picker and validates the
  selected path. No browser directory-upload or manual path input is used.
- `gardens/dashboard/` owns dashboard layout, overview, filters, cards, subagent
  dialogs and view helpers. Search, status/provider filters, empty-project visibility and project grouping
  are local view state. A garden consumes shared state without starting another
  monitor or copying the snapshot into local refs.

## Styling

Use `<style scoped lang="scss">` for component-owned styles. `styles/main.scss`
loads the small global foundation: base/reset/accessibility rules and shared
controls, forms, status badges and native dialogs. `_tokens.scss` owns the shared
palette, spacing scale, radii and responsive mixins through modern Sass `@use`.
Use existing tokens for recurring values; keep unique illustration and component
details local. Avoid global selectors for garden-specific elements.

This refactor preserves the current appearance. Theme selection, a theme registry,
additional gardens and a new component library are outside this change.

## Formatting and linting

ESLint's flat config covers Vue, TypeScript and JavaScript across client, server,
scripts, tests and configuration. Recommended Vue/TypeScript rules check code;
Prettier owns formatting, with `eslint-config-prettier` preventing rule conflicts.
Prettier also formats SCSS, HTML, JSON and documentation. Generated output, vendor
assets and the npm lockfile are excluded from formatting.

```sh
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

The committed `.vscode/settings.json` enables Prettier format-on-save and ESLint
fixes on manual save and Auto Save in VS Code-compatible editors. Install the
workspace-recommended Prettier, ESLint and Vue extensions when prompted. Other
editors can use the same repo configs; their save hooks need editor-specific
integration. No global editor preferences are changed.
