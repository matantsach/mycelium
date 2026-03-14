# Changelog

## [0.8.0](https://github.com/matantsach/mycelium/compare/mycelium-v0.7.0...mycelium-v0.8.0) (2026-03-14)


### Features

* Phase 4 — Mycelium Knowledge + Runtime Adapters ([#8](https://github.com/matantsach/mycelium/issues/8)) ([fd55458](https://github.com/matantsach/mycelium/commit/fd5545815aa663aa145f26366c14bc00f2b7e858))

## [0.7.0](https://github.com/matantsach/mycelium/compare/mycelium-v0.6.0...mycelium-v0.7.0) (2026-03-14)


### Features

* Phase 3 — Captain Intelligence ([#6](https://github.com/matantsach/mycelium/issues/6)) ([f6473a8](https://github.com/matantsach/mycelium/commit/f6473a8186a74d9ac1fa79945b28a3625d5478e8))

## [0.6.0](https://github.com/matantsach/mycelium/compare/mycelium-v0.5.0...mycelium-v0.6.0) (2026-03-14)


### Features

* add arm cleanup hook (agentStop/subagentStop) ([0f46063](https://github.com/matantsach/mycelium/commit/0f4606397abb8a8a546f27e142522a7db8e2b3b8))
* add audit log protocol (appendAuditEntry) ([a80ec78](https://github.com/matantsach/mycelium/commit/a80ec7883875f0b618a0909cda4d807189cd85b1))
* add context-loader sessionStart hook ([43fc5da](https://github.com/matantsach/mycelium/commit/43fc5daaa1a372f015d355f5b892b3c795b56a6e))
* add dual-write and audit logging to all MCP tools ([e1dc661](https://github.com/matantsach/mycelium/commit/e1dc66167d3ff9d1cddf4e26dea234a2d5167540))
* add findTaskFile and updateTaskFileFrontmatter ([019469a](https://github.com/matantsach/mycelium/commit/019469af723796612eac51a97b67eeae843c9b19))
* add Focus Mode skill, spawn script, and teammate agent ([ef98750](https://github.com/matantsach/mycelium/commit/ef98750c82fc05d5837e133176ae162fd81e9d51))
* add inbox messaging protocol (writeMessage, readMessages, markRead, broadcasts) ([c699ae7](https://github.com/matantsach/mycelium/commit/c699ae75ffd50b2ff2e5fca1d11c03bc95001d1d))
* add MCP server with 5 atomic tools and dual-write ([883abb2](https://github.com/matantsach/mycelium/commit/883abb24e6f20d98c3bfc3b28a947569576a3941))
* add mission/task/member file readers and writers ([769106b](https://github.com/matantsach/mycelium/commit/769106b01f2f18672a3066e8ab55aad5d80ccfbb))
* add mycelium directory structure initializer ([f338e71](https://github.com/matantsach/mycelium/commit/f338e71c0318e5aff349749af0f5b93e93be3f27))
* add nudge-messages postToolUse hook placeholder ([16acf67](https://github.com/matantsach/mycelium/commit/16acf67718ca4413844dd5e22332a96731fb3c9c))
* add postToolUse passive monitor hook, remove nudge-messages ([686f748](https://github.com/matantsach/mycelium/commit/686f74804e96413df4c4fa7ee207f218ad647680))
* add preToolUse scope enforcer hook ([6dcb226](https://github.com/matantsach/mycelium/commit/6dcb226ab1f95db722fe56de67b7365337281805))
* add RuntimeAdapter interface and Copilot CLI adapter ([9cfdd63](https://github.com/matantsach/mycelium/commit/9cfdd63a3fc3db2938d96b3db17ea18e5ad3e104))
* add sessionEnd checkpoint hook for crash recovery ([c5f7c48](https://github.com/matantsach/mycelium/commit/c5f7c48a15b3d0b2f4dc5023acd591389f1002bc))
* add team-coordinate skill, update teammate agent for filesystem-first protocol ([c4bfe95](https://github.com/matantsach/mycelium/commit/c4bfe95092a50a112e6aa4dd53df261c21118633))
* add TeamDB with missions, tasks, and approval tables ([e841f42](https://github.com/matantsach/mycelium/commit/e841f42b368b9853193b5100c0dfba5fbbfbb5f2))
* add YAML frontmatter parser for mycelium protocol files ([8aaba1f](https://github.com/matantsach/mycelium/commit/8aaba1f20dd42560ad4c6a4cae31538127c06a1e))
* Phase 2 — Protocol Migration (Filesystem-First) ([cad60fe](https://github.com/matantsach/mycelium/commit/cad60fe7426ab9c4c5e8cd1bfbaaa56e0adc2087))
* reject_task sends feedback to arm inbox ([f044dc2](https://github.com/matantsach/mycelium/commit/f044dc25c32fc1d60ad8db0a1f896255922d0b5b))
* update hooks.json with all 6 hooks, enhance context-loader for arm sessions ([833fac3](https://github.com/matantsach/mycelium/commit/833fac3b88b2313051596e8ac5519dca85f387ef))


### Bug Fixes

* fix CI failures — use process.cwd() in tests, fix setup-node version ([547e3e6](https://github.com/matantsach/mycelium/commit/547e3e6c967fd0f4fc1f46af0058d1f05dfe7171))
* rename team-focus skill to focus, update CLAUDE.md for Phase 2 ([76791a3](https://github.com/matantsach/mycelium/commit/76791a3db6732db7c707118828a3a41f6eac9e3f))


### Documentation

* add CLAUDE.md project guide ([803b7d0](https://github.com/matantsach/mycelium/commit/803b7d045df5252e32ad647983b8612ffca3fefc))
* add Phase 2 implementation plan (reviewed and fixed) ([4e02cc5](https://github.com/matantsach/mycelium/commit/4e02cc5613d1145e9cdd41823942f08d179707ed))
* add Phase 2 protocol migration design spec ([6cadfdf](https://github.com/matantsach/mycelium/commit/6cadfdf668a06baae00092db3d99f048d0697a4e))
* fix 5 issues from spec review in Phase 2 design ([f60eaf8](https://github.com/matantsach/mycelium/commit/f60eaf88527e551277e3a10345f94945eb5608d2))


### Miscellaneous

* add .worktrees/ to .gitignore ([5337b1f](https://github.com/matantsach/mycelium/commit/5337b1f016987865d8feb8523ffc3331f836f267))
* add CI/CD, release-please, documentation, and repo setup ([5578e63](https://github.com/matantsach/mycelium/commit/5578e633319deabf0eb0d15ada31a017d810e495))
* commit dist/ for plugin install compatibility ([2111bb6](https://github.com/matantsach/mycelium/commit/2111bb6b4a59774a54d16086874c984e7ab7b8e4))
* **deps:** bump actions/setup-node from 4 to 6 ([49b6856](https://github.com/matantsach/mycelium/commit/49b6856dc86d8c6508debf9607a68bd3f754721b))
* **deps:** bump actions/setup-node from 4 to 6 ([ca23a18](https://github.com/matantsach/mycelium/commit/ca23a180471d9195709afedc87facfd24bca93a0))
* scaffold mycelium project ([1e7efaa](https://github.com/matantsach/mycelium/commit/1e7efaafd69ee6077735aa49d03f614b3fb6366e))
* trigger release-please ([156bba1](https://github.com/matantsach/mycelium/commit/156bba1084956406d0377ed2b80084314d62c482))
* update build config for Phase 2 hooks, rebuild dist/ ([8941bf4](https://github.com/matantsach/mycelium/commit/8941bf40aa59337a395970afdaefd1af5b3f87cf))
