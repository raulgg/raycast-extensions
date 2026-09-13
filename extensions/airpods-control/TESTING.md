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

`npm test` runs the complete suite. During migration it includes colocated Node tests, the happy-dom setup view, and process/macOS integration tests. The final suite selection and platform requirements will be documented here when the projects are separated.

For review, check whether a test would fail if the claimed behavior broke. Three comments alone do not establish Given/When/Then, and reducing the test count is not a target.
