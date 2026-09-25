/**
 * 「换引擎留痕」那条样本会话里，换家后第一句前面那段交接说明。
 *
 * 形状照 `@omni/handoff` 的 `briefOf` 写死，不现算：样本要逐像素可比。
 * 内容和样本对得上——第一轮是 Claude Code 跑的，之后换到 Codex（见 `handedOff`）。
 */
export const HANDOFF_NOTE = [
  "<omni-handoff>",
  "这条会话中途换了引擎，接下来由 Codex 接着进行。此前的工作：",
  "- Claude Code：第 1 轮，2026-08-25T02:00:01Z – 2026-08-25T02:00:40Z",
  "",
  "完整转写（omni 从会话记录整理：每轮的提问、回答、思考、工具调用与完整输出、改动 diff；按 `## 第 N 轮` 分节，标题里是这一轮的开始时间（UTC），工具调用行尾〔…〕是原生 id）：",
  "- /work/app/.omni/handoff/th-main.md（412 行，38 KB；最后一轮（第 1 轮）从第 9 行开始）",
  "",
  "各段原始记录（引擎自己的会话文件，下面的格式是从文件里读出来的）：",
  "- Claude Code：/logs/claude-1.jsonl（1.0 MB；JSONL，每行一个 JSON，410 行；顶层 type 取值 assistant 224、user 91；转写里的原生 id 在这份记录的 message.content[].id 字段，例如 toolu_01A；每行的时间戳在 timestamp 字段（ISO 8601））",
  "</omni-handoff>",
].join("\n")
