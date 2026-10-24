import { defineMessages } from "@switchback/i18n"

/** 点「建一份项目说明」时写进 `AGENTS.md` 的样板。这是你的文件，写完随你改。 */
export const PROJECT_DOC = defineMessages(
  {
    starter: `# 项目说明

写给在这个项目里干活的 agent 看。**两家引擎读的是同一份**——
\`CLAUDE.md\` 只有一行 \`@AGENTS.md\` 指到这里。

## 这是个什么项目

（一两句话说清它是干什么的、给谁用的）

## 动手前要知道的

- （构建/测试怎么跑）
- （哪些地方不要碰）

## 约定

- （代码风格、提交信息、命名之类，只写和别处不一样的那些）
`,
  },
  {
    starter: `# Project notes

For the agents working in this project. **Both engines read this same file**:
\`CLAUDE.md\` is a single line, \`@AGENTS.md\`, that points here.

## What this project is

(One or two sentences: what it does and who it's for)

## Before you start

- (How to build and run the tests)
- (What not to touch)

## Conventions

- (Code style, commit messages, naming: only what differs from the usual)
`,
  },
)
