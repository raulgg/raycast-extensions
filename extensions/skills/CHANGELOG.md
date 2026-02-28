# Changelog

## [Align macOS `npx` Execution] - {PR_MERGE_DATE}

- Replace shell-dependent `zsh -li` execution with a runtime path resolver and standardized exec options
- Use a single command resolution flow: `customNpxPath ?? "npx"` with shared `execAsync` execution
- Keep semver-based nvm/fnm path sorting and HOME-based Node env defaults (`NVM_DIR`, `FNM_DIR`, `npm_config_prefix`)
- Add extension preference **Custom npx Path** with `~` expansion for non-standard setups
- Preserve command compatibility (`npx -y skills@latest ...`) and existing error guidance in Manage Skills

## [Inline Detail Panel] - 2026-02-26

- Replace push-to-detail views with inline detail panels across all commands
- Toggle detail panel visibility with Cmd+D
- Lazy-load skill content only for the selected item

## [Install & Remove Skills] - 2026-02-17

- Install skills directly from search and trending commands
- New "Manage Skills" command to view and remove installed skills
- Agent filter dropdown to browse skills by agent

## [Fix Skill Details] - 2026-02-11

- Load SKILL.md files first, fallback to README.md
- Add automatic caching with useCachedPromise
- Improve loading performance with parallel fetch requests
- Fix screen flickering when loading skill details

## [Fix Screenshots] - 2026-02-11

- Move screenshots to assets folder and update README references

## [Initial Version] - 2026-02-11

- Search skills with real-time debounced search
- Trending skills ranked by total installs
- Filter skills by owner/organization
- View skill details
- Copy install commands to clipboard
- Open skill repository on GitHub
- Open skill page on skills.sh
