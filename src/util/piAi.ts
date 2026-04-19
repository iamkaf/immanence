import type { AssistantMessage } from "@mariozechner/pi-ai";

export function assistantText(message: AssistantMessage) {
  return message.content
    .filter(
      (
        item,
      ): item is Extract<
        AssistantMessage["content"][number],
        { type: "text" }
      > => item.type === "text",
    )
    .map((item) => item.text)
    .join("");
}
