import { prisma } from "./prisma";
import { estimateCost, GeminiUsage } from "./gemini";

export type AIUsageKind =
  | "synthesize"
  | "qa"
  | "grade"
  | "essay"
  | "essay_failed"
  | "essay_harness"
  | "mcq"
  // Tier 2 accuracy critic (src/lib/critic.ts) and the targeted repair pass
  // (src/lib/repair.ts). Both are paid calls, so both are observable per topic —
  // an unlogged verification call is an invisible bill.
  | "critic"
  | "repair";

// Persist a cost-observability row for every Gemini call (whitepaper §3 / §6).
export async function logAIUsage(opts: {
  topicId?: string | null;
  kind: AIUsageKind;
  usage: GeminiUsage;
}): Promise<void> {
  const estimatedCost = estimateCost(opts.usage.promptTokens, opts.usage.candidatesTokens);
  await prisma.aIUsage.create({
    data: {
      topicId: opts.topicId ?? null,
      kind: opts.kind,
      tokensIn: opts.usage.promptTokens,
      tokensOut: opts.usage.candidatesTokens,
      estimatedCost,
    },
  });
}
