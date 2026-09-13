# Testing

Follow the [testing principles](https://github.com/kentcdodds/kody/blob/main/docs/contributing/testing-principles.md) and the local conventions below.

- Use top-level `test` and descriptive `test.each` rows. Avoid `describe` and suite setup/cleanup hooks.
- Mark each test with `// Given`, `// When`, and `// Then`. Given creates fixtures, When performs the action, and Then checks its observable outcome. Repeat When/Then when continuing the same workflow.
- Keep related assertions together. Preserve meaningful intermediate states, recovery, and retries on the same objects.
- Supply scenario behavior explicitly in each test or an imported factory. Factories return fresh objects and useful handles; never share mutable scenario state.
- Register resource cleanup immediately. Use test-local `try/finally` or an explicitly called resource factory with `onTestFinished`. Await pending work before restoring timers or removing files. Do not run tests using shared module mocks concurrently.
- Assert independent expected values at the caller boundary. Keep runtime validation, output formatting, supplied diagnostic data, and live forbidden-side-effect assertions. Avoid instructional-copy pins, deleted-name absence checks, and expectations computed with the production helper.
- Use local fakes for Raycast and external tools. Do not run Homebrew installation, contact the public internet, or change AirPods settings in automated tests.
- Test runner infrastructure may use lifecycle hooks for mock/log verification and cleanup. It must not hide scenario setup.

`npm test` runs all four projects. `npm run test:unit` runs unit and component tests; `npm run test:integration` runs composed/process and macOS integration tests.

| Project       | Files                                               | Environment and boundary                                                                                               |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `unit`        | Colocated `src/**/*.test.ts`, excluding integration | Node, with external Raycast/tool behavior stubbed. No real helper processes or OS locks.                               |
| `component`   | `src/**/*.test.tsx`                                 | happy-dom with the Raycast DOM adapter. Exercises actions and lifecycle, not native rendering.                         |
| `integration` | `src/test/integration/**/*.integration.test.ts`     | Composed application modules and temporary helper/supervisor processes. Process fixtures require POSIX shell and bash. |
| `macos`       | `src/test/integration/**/*.macos.test.ts`           | Real `lockf`, file descriptors, revision files, and supervised processes. Every case explicitly skips outside macOS.   |

Keep file isolation enabled. Each file must belong to exactly one project. Unit and component cases remain sequential within a file because module mocks are shared. Real lock behavior belongs in the macOS project; do not replace it with stubs or reduce timeout allowances to shorten runs.

For review, check whether a test would fail if the claimed behavior broke. Three comments alone do not establish Given/When/Then, and reducing the test count is not a target.
