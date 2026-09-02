# AGENTS.md — Angular dashboard

Context for AI coding agents working on the `dashboard/` Angular app in paper-agents.

**Backend and repo-wide context:** see [../AGENTS.md](../AGENTS.md) and [../README.md](../README.md).

## Stack

| Item | Value |
|------|-------|
| Angular | 19 (standalone components) |
| Control flow | `@if`, `@for`, `@switch` (not `*ngIf` / `*ngFor`) |
| API proxy | `proxy.conf.js` → `http://localhost:3001` |
| Lint | `npm run lint` (from `dashboard/`) or `npm run dashboard:lint` (from repo root) |

## Project layout

Organize by **feature**, not by artifact type. Do not create top-level `components/`, `services/`, or `directives/` folders that mix unrelated features.

```text
dashboard/src/
  main.ts                 Bootstrap entry (always here)
  app/
    app.component.ts      Root shell
    app.component.html
    app.config.ts
    app.routes.ts
    api.service.ts        HTTP client for /api/*
    models.ts             Shared interfaces (no UI logic)
    components/           Reusable widgets used across pages
      scroll-load-box/
      agent-pipeline-stepper/
    pages/
      dashboard/          Feature page: .ts + .html + .css together
```

When a widget is only used by one page, colocate it under that page’s directory instead of `components/`.

## File naming

| Rule | Example |
|------|---------|
| Hyphenate words in file names | `agent-pipeline-stepper.component.ts` |
| Match the primary symbol in the file | `DashboardComponent` → `dashboard.component.ts` |
| Use conventional type suffixes | `.component`, `.service`, `.pipe`, `.guard` |
| Same base name for class, template, styles | `foo.component.ts`, `foo.component.html`, `foo.component.css` |
| Tests end in `.spec.ts` | `foo.component.spec.ts` next to `foo.component.ts` |
| Avoid generic names | No `helpers.ts`, `utils.ts`, `common.ts` unless truly shared |

## Templates and styles (required)

**Always use external template and style files.** Do not use inline `template:` or `styles:` in `@Component` metadata.

```typescript
@Component({
  selector: 'app-example',
  standalone: true,
  templateUrl: './example.component.html',
  styleUrl: './example.component.css',
})
export class ExampleComponent {}
```

Put real HTML in `.html` files. Keep TypeScript files for class logic, bindings API, and lifecycle — not large template strings.

## Component conventions

### Selectors

- **Components:** element selector, `app` prefix, kebab-case — `app-scroll-load-box`
- **Directives:** attribute selector, `app` prefix, camelCase — `[appTooltip]`

### Class member order

1. Injected dependencies (`inject()`)
2. Inputs, outputs, models, queries
3. Other fields and computeds
4. Constructor (avoid if using `inject()` only)
5. Lifecycle hooks (thin — delegate to named methods)
6. Public methods used from template (`protected` when only template needs them)
7. Private helpers

### Dependency injection

Prefer `inject()` over constructor parameter injection:

```typescript
private readonly api = inject(ApiService);
```

### Access modifiers

- `readonly` on `input()`, `output()`, `model()`, and query fields
- `protected` for members only referenced from the template
- Keep the public surface small; components are not general-purpose libraries

### Change detection

Use `changeDetection: ChangeDetectionStrategy.OnPush` on new components. OnPush runs when inputs change by reference or events fire in the subtree — avoid mutating input objects in place.

### Keep components presentation-focused

Move validation, pagination, API orchestration, and data transforms into services or plain functions. The component wires template ↔ service.

### Lifecycle

Implement lifecycle hook **interfaces** (`OnInit`, `OnDestroy`, etc.). Keep hooks short; call well-named private methods:

```typescript
ngOnInit(): void {
  this.loadInitialData();
}
```

### Event handlers in templates

Name handlers for the **action**, not the DOM event:

```html
<button type="button" (click)="savePrompt()">Save</button>
```

Not `handleClick()`.

### Template complexity

Use `@if` / `@for` for structure. Prefer simple expressions in templates; move non-trivial logic to the class (computed signals or methods). Use `[class.foo]` and `[style.prop]` instead of `NgClass` / `NgStyle` in new code.

Example template patterns:

```html
@if (loading) {
  <p class="muted">Loading…</p>
} @else {
  <ul>
    @for (item of items; track item.id) {
      <li [class.selected]="item.id === selectedId">{{ item.label }}</li>
    }
  </ul>
}
```

## Services and state

| Concern | Where |
|---------|--------|
| HTTP calls | `api.service.ts` (extend or split by domain if it grows) |
| Shared types | `models.ts` |
| Page-specific state | Page component or a colocated `*.service.ts` |

Use RxJS for async streams (this project uses `subscribe` / `async` patterns in the dashboard page). Prefer `takeUntilDestroyed()` or explicit `Subscription` cleanup in `ngOnDestroy`.

Do not put business rules that belong on the API into the dashboard — the UI reflects server state.

## SOLID in Angular terms

| Principle | Practice |
|-----------|----------|
| **Single responsibility** | One component/service/pipe per file; one reason to change per class. Split files that grow past ~400 lines. |
| **Open/closed** | Extend behavior via inputs/outputs and composition, not by editing shared base components. |
| **Liskov substitution** | Program to interfaces/types (`Agent`, `Portfolio`); services should be replaceable in tests. |
| **Interface segregation** | Small, focused services (e.g. `ApiService` methods grouped by domain if split). |
| **Dependency inversion** | Depend on abstractions via `inject()`; never `new ApiService()` inside components. |

## Signals (when adding new code)

- Use `input()` / `output()` / `model()` on new components where appropriate
- Derive state with `computed()`; use `effect()` only for side effects (logging, DOM sync), not for propagating state between signals

Existing code may use `@Input()` / `@Output()` — migrate opportunistically, not in unrelated diffs.

## Testing

- Unit tests live beside source: `foo.component.spec.ts`
- Use `TestBed` + `ComponentFixture`
- Prefer CDK harnesses for DOM interaction when tests grow beyond trivial bindings

## Lint and format

From repo root:

```bash
npm run dashboard:lint
```

From `dashboard/`:

```bash
npm run lint
```

ESLint config: `dashboard/eslint.config.mjs` (`@angular-eslint` + `typescript-eslint`). Fix lint issues before finishing a change. Warnings such as missing `OnPush` should be addressed on touched components when practical.

## Common tasks

| Task | Location |
|------|----------|
| Main dashboard layout / data loading | `src/app/pages/dashboard/` |
| Reusable scroll / stepper UI | `src/app/components/` |
| API client | `src/app/api.service.ts` |
| Shared types | `src/app/models.ts` |
| Global styles | `src/styles.css` |
| Dev server / proxy | `package.json` scripts, `proxy.conf.js` |

## Checklist before submitting dashboard changes

- [ ] Templates in `.html` files via `templateUrl` (not inline `template`)
- [ ] Styles in `.css` via `styleUrl` when component-scoped
- [ ] File names hyphenated; type suffix present
- [ ] Feature/colocated folder structure preserved
- [ ] No secrets or API keys in frontend code
- [ ] `npm run dashboard:build` succeeds
- [ ] `npm run dashboard:lint` passes with zero errors
