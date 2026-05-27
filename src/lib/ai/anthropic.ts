import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = "claude-opus-4-7";

/**
 * Named API keys to keep per-feature usage in separate billing buckets.
 * The default key is used for enrollment + meetings. Student care
 * insights go through ANTHROPIC_API_KEY_CONSULTATIONS so we can track
 * usage of that workflow independently.
 */
export type AnthropicKeyName = "default" | "consultations";

const KEY_ENV: Record<AnthropicKeyName, string> = {
  default: "ANTHROPIC_API_KEY",
  consultations: "ANTHROPIC_API_KEY_CONSULTATIONS",
};

const clients = new Map<AnthropicKeyName, Anthropic>();

export function getAnthropic(keyName: AnthropicKeyName = "default"): Anthropic {
  const cached = clients.get(keyName);
  if (cached) return cached;

  const envVar = KEY_ENV[keyName];
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`${envVar} is not set`);
  }
  const client = new Anthropic({ apiKey });
  clients.set(keyName, client);
  return client;
}
