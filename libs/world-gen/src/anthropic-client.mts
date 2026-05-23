import type { LlmClient } from './llm-client.mjs';
import type { LlmPrompt } from './world-brief.mjs';

/**
 * A real {@link LlmClient} backed by the Anthropic Messages API.
 *
 * The SDK is imported lazily and is NOT a dependency of this package, so the
 * library builds and runs offline; consumers who want the live path install
 * `@anthropic-ai/sdk` themselves. The model id is never hard-coded — pass it in
 * or set `ANTHROPIC_MODEL` — so this stays current without code changes.
 */
export interface AnthropicClientOptions {
    apiKey?: string;
    model?: string;
    maxTokens?: number;
}

export function createAnthropicLlmClient(
    options: AnthropicClientOptions = {}
): LlmClient {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    const model = options.model ?? process.env.ANTHROPIC_MODEL;
    const maxTokens = options.maxTokens ?? 1024;

    if (!apiKey) {
        throw new Error(
            'createAnthropicLlmClient: no API key (pass apiKey or set ANTHROPIC_API_KEY)'
        );
    }
    if (!model) {
        throw new Error(
            'createAnthropicLlmClient: no model (pass model or set ANTHROPIC_MODEL)'
        );
    }

    return {
        async complete(prompt: LlmPrompt): Promise<string> {
            // Cast the specifier to string so this stays build-safe without the
            // SDK installed; resolved only when the live path is actually used.
            const specifier = '@anthropic-ai/sdk';
            let mod: any;
            try {
                mod = await import(specifier as string);
            } catch {
                throw new Error(
                    'createAnthropicLlmClient: install @anthropic-ai/sdk to use the live LLM path'
                );
            }

            const Anthropic = mod.default ?? mod.Anthropic;
            const client = new Anthropic({ apiKey });

            const response = await client.messages.create({
                model,
                max_tokens: maxTokens,
                system: prompt.system,
                messages: [{ role: 'user', content: prompt.user }]
            });

            const blocks: Array<{ type: string; text?: string }> =
                response.content ?? [];
            return blocks
                .filter(b => b.type === 'text')
                .map(b => b.text ?? '')
                .join('\n');
        }
    };
}
