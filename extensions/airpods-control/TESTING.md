# Testing

These rules are for this Raycast extension: stubbed `@raycast/api`, happy-dom for setup UI, fake helper processes, and real macOS `lockf` where the lock itself is the claim.

## Shape

Use top-level `test` and named `test.each` rows. ESLint rejects `describe`, `it`, suite hooks, namespace Vitest imports, and `test.concurrent` in `*.test.*` files. Module mocks and the console guard are file-scoped, so cases in one file stay sequential.

Mark each case with `// Given`, `// When`, and `// Then`. Given creates fixtures and declares dependency behavior. When calls the subject. Then checks an observable result. Repeat When/Then on the same objects for install, retry, disconnect, and lock journeys. Prefer fewer, longer tests when the checks belong to one workflow. A single assertion per test is not the goal.

Names say the condition, the action, and the outcome. Table rows get names too.

```ts
test("returns the Homebrew path when the binary is there", () => {
  // Given
  mockGetPreferenceValues.mockReturnValue({} as never);
  mockStatSync.mockReturnValue({ isFile: () => true } as never);
  mockInstalledAt("/opt/homebrew/bin/airpods-control", "/usr/local/bin/airpods-control");

  // When
  const result = findCliPath();

  // Then
  expect(result).toBe("/opt/homebrew/bin/airpods-control");
});
```

Both default locations are present in that priority case. Reversing search order must fail. Do not assert `CLI_SEARCH_PATHS[0]`.

For async failures, keep the promise in When and assert rejection in Then. Attach the rejection matcher before advancing timers or releasing a deferred failure. For a synchronous throw, When can build a closure and Then use `toThrow`.

## Isolation

Each case supplies its own behavior. Shared helpers live under `src/test/` (`fixtures/`, `mocks/`, `console.ts`). Import them in the case and call the factory in Given, for example `const cli = installedCliSetup()`. Do not create a module-level `const installedCli = installedCliSetup()` that every test mutates. Do not share a suite-level React root or a leftover `cliPath` preference.

If the next assertion needs the same toast, view, or installer promise, keep going in that case. Do not stash it on the module for the next `test()`.

Register cleanup as soon as you acquire a resource. Use test-local `try/finally` or an explicitly called factory with `onTestFinished`. Do not add `using` / `Symbol.dispose` here. Only wrap an object when it owns a resource; a plain fixture does not need a disposable. Await pending installer prompts, brew operations, and child processes before restoring timers or deleting directories, including when an assertion already failed. The installer keeps module-level pending promises; clearing mocks does not clear them.

`vitest.config.ts` enables `clearMocks`, `mockReset`, and `restoreMocks`. Scenario stubs belong in Given. A bare `vi.fn()` is undefined after reset. `vi.fn(implementation)` restores that implementation. Do not `mockReset` in the middle of a case unless that case is a multi-step workflow that needs a fresh stub between When blocks.

Runner `setupFiles` may use hooks for mock or log verification. `src/test/console.ts` is the example. It must not plant scenario state: no temp CLI, no support directory, no default listening mode. That is the same hidden-setup rule as `beforeEach`.

## What to assert

Assert what a caller or user can observe: CLI arguments and paths, confirmed readback, toast style and actions, copied text, opened URLs, launched command names, subtitle strings, lock ownership, exit codes, and structured `CliError` fields.

Keep related checks in one workflow. A loading spinner that only exists between detect and install belongs in that journey, not in its own test.

Independent expected values. An assertion is tautological when it cannot fail unless the implementation and the test change in lockstep. Typical failures:

- Identity predicates: `expect(isSupported(SUPPORTED_MODE)).toBe(true)` when `isSupported` is `===`, `includes`, or `Set.has` of that constant. Keep normalization, negatives, prefix/suffix, and Error wrapping.
- Self-equality: `expect(equal(status, status)).toBe(true)`.
- Echoing a production helper (`listeningModeSubtitle(mode)` on both sides).
- `expect(exportedConstant).toBe(theSameLiteral)` on the export itself. If the value is a public contract, assert it where a caller observes it.
- Pinning instructional copy: setup guidance markdown, toast bodies, preference descriptions, action tooltips, HUD strings, usage hints (`Return here`, long Homebrew repair text). If the behavior matters, click the action or assert the structured contract.
- A lone `not.toContain("Old Action")` after the name was deleted. Fine while deleting; do not commit it. Same for retired preference keys, command names, filenames, and selectors. Absence is useful when a live path could still show the thing: loading vs ready, connected vs not, enabled vs disabled.

Do not retest what TypeScript already enforces. Boundary checks of untrusted launch context still matter; those values arrive at runtime.

Click actions and check destinations. Copied install commands are literals in the test, not `CLI_INSTALL_COMMAND` reused from production.

## Logs

Declare expected `console.error` and `console.warn` calls with `expectConsoleError` and `expectConsoleWarning` from `src/test/console.ts`. Call the helper once per log, with the stable tag and the same error object the production code logs. Do not pin a long log message. There is no incidental-warning allowlist: if production logs, the test declares it. Unexpected error and warning logs fail the test. Do not spy on `console` in test files.

## Environments

Pick the lightest project that can falsify the claim. `npm test` runs all four. `npm run test:unit` is unit plus component. `npm run test:integration` is composed/process plus macOS.

| Project       | Files                                                             | What it can prove                                                                                                                       |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`        | Colocated `src/**/*.test.ts`, excluding `src/test/integration/**` | Node, Raycast and tools stubbed. No real helper processes or OS locks.                                                                  |
| `component`   | `src/**/*.test.tsx`                                               | happy-dom with the Raycast DOM adapter. Action titles, navigation, and React lifecycle. Not native List, Form, or HUD.                  |
| `integration` | `src/test/integration/**/*.integration.test.ts`                   | Composed modules and temporary helper/supervisor processes. Process fixtures need POSIX shell and bash.                                 |
| `macos`       | `src/test/integration/**/*.macos.test.ts`                         | Real `lockf`, file descriptors, revision files, and supervised processes. Every case uses `test.skipIf(process.platform !== "darwin")`. |

Each file belongs to exactly one project. Keep file isolation on. Do not stub `lockf` in the macOS project or cut timeouts to make that suite faster.

happy-dom cannot prove native Raycast rendering or HUD fallback. Vitest cannot prove AirPods hardware or a live Homebrew install. Those stay manual.

## Stay in process

Use the Raycast mock, local fake binaries, and in-process stubs. Automated tests do not install or upgrade the helper with Homebrew, hit the public internet, change AirPods settings, or open the Raycast window.

## Commands

Run from this directory:

```sh
npm test
npm run test:unit
npm run test:integration
npm run type-check
npx --no-install prettier --check src .prettierrc eslint.config.js package.json tsconfig.json vitest.config.ts
npm run lint
npm run build
npm run test:coverage
```

A shuffled run (`npx --no-install vitest run --sequence.shuffle --sequence.seed <n>`) is worth it after isolation changes. Record the seed.

Keep the bar high for new tests, especially process and macOS ones. Do not add a `lockf` case for a typo, or a regression for a bug that cannot happen again, unless that flow is worth owning. Coverage is a gap finder. It is not a percentage target. Do not delete tests to keep a round number.
