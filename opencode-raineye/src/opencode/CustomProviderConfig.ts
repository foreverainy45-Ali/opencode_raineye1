import type { ProviderConfig } from "@opencode-ai/sdk/v2";
import type { CustomModelInput } from "../shared/protocol";

export function buildCustomProviderConfig(
  existingProvider: ProviderConfig | undefined,
  input: CustomModelInput,
): ProviderConfig {
  const existingModel = existingProvider?.models?.[input.modelId];
  const context = input.contextLimit;
  const output = input.outputLimit;
  const model = {
    ...existingModel,
    name: input.modelName.trim(),
    attachment: input.supportsImages ?? false,
    reasoning: input.reasoning ?? false,
    modalities: {
      input: input.supportsImages ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    ...((context || output) ? {
      limit: {
        context: context ?? existingModel?.limit?.context ?? 128_000,
        output: output ?? existingModel?.limit?.output ?? 16_384,
      },
    } : {}),
  } satisfies NonNullable<ProviderConfig["models"]>[string];

  return {
    ...existingProvider,
    name: input.providerName.trim(),
    npm: input.npm,
    options: {
      ...existingProvider?.options,
      baseURL: input.baseUrl.trim().replace(/\/+$/, ""),
      ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
    },
    models: {
      ...existingProvider?.models,
      [input.modelId.trim()]: model,
    },
  };
}
