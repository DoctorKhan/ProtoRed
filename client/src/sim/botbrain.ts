// Browser bot brain: calls OpenRouter directly from the page with the user's own
// key (BYO key, cached in localStorage). Falls back to scriptedDecision when no
// key is set or a call fails, so the game always runs. The security boundary
// (sanitizeDecision) is applied identically to LLM and scripted output.

import {
  BotPersona,
  CarView,
  ChatEntry,
  Decision,
  DecideFn,
  DECISION_SCHEMA,
  describeWorld,
  sanitizeDecision,
  scriptedDecision,
  systemPrompt,
} from "../../../shared/brain";
import { BotAction } from "../../../shared/protocol";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter's task-aware router. A concrete model slug remains a supported override. */
export const AUTO_MODEL = "openrouter/auto-beta";
export const DEFAULT_MODEL = (import.meta as any)?.env?.VITE_MODEL ?? AUTO_MODEL;
const AUTO_COST_QUALITY_TRADEOFF = 7;

/** Trusted routing policy: untrusted chat cannot alter cost, privacy, or capabilities. */
export function routingOptions(model: string) {
  const selected = model.trim() || AUTO_MODEL;
  return {
    model: selected,
    ...(selected === AUTO_MODEL
      ? {
          plugins: [
            {
              id: "auto-router",
              cost_quality_tradeoff: AUTO_COST_QUALITY_TRADEOFF,
            },
          ],
        }
      : {}),
    provider: {
      // Never silently route strict structured output to an incompatible endpoint.
      require_parameters: true,
      allow_fallbacks: true,
      // Bot prompts contain player chat; prefer endpoints that do not retain it.
      data_collection: "deny",
    },
  } as const;
}

export interface BrainConfig {
  getKey: () => string | null;
  getModel?: () => string;
  onScripted?: (reason: string) => void;
}

/**
 * Build the decide() function injected into the Game. It is provider-specific
 * (OpenRouter) but returns the same sanitized Decision the scripted path does.
 */
export function createBrowserBrain(cfg: BrainConfig): DecideFn {
  let rejectedKey: string | null = null; // a newly supplied key can recover after a 401

  return async function decide(
    persona: BotPersona,
    self: { name: string; x: number; z: number; speed: number },
    others: CarView[],
    chat: ChatEntry[],
    lastAction: BotAction | null,
  ): Promise<Decision> {
    const validNames = others.map((o) => o.name);
    const key = cfg.getKey();
    if (!key || key === rejectedKey) return scriptedDecision(persona, others, chat);
    const requestedModel = cfg.getModel?.() ?? DEFAULT_MODEL;

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Redliner Protocol",
        },
        body: JSON.stringify({
          ...routingOptions(requestedModel),
          max_tokens: 500,
          messages: [
            { role: "system", content: systemPrompt(persona) },
            { role: "user", content: describeWorld(self, others, chat, lastAction) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "decision", strict: true, schema: DECISION_SCHEMA },
          },
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          rejectedKey = key;
          cfg.onScripted?.("OpenRouter rejected the key (401) — running scripted.");
        } else if (res.status === 429) {
          cfg.onScripted?.("Rate limited — skipping this think.");
        } else {
          cfg.onScripted?.(`OpenRouter error ${res.status}.`);
        }
        return scriptedDecision(persona, others, chat);
      }

      const data = (await res.json()) as {
        model?: unknown;
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) return scriptedDecision(persona, others, chat);
      const parsed = JSON.parse(text) as Decision;
      const model = typeof data.model === "string" ? data.model : null;
      return sanitizeDecision({ ...parsed, source: "llm", model }, validNames);
    } catch (err) {
      cfg.onScripted?.(`Call failed: ${(err as Error).message}`);
      return scriptedDecision(persona, others, chat);
    }
  };
}
