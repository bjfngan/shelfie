export const EMBED_COLOR = 0x2e86ab;

export function embedResponse(embed: object) {
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { embeds: [embed] },
  };
}

export function ephemeralResponse(content: string) {
  return {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { content, flags: 64 }, // 64 = EPHEMERAL
  };
}
