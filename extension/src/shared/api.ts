export type ApiProvider = "anthropic"

export interface ApiHandlerOptions {
	koduApiKey?: string
	koduEmail?: string
	apiModelId?: KoduModelId
	browserModelId?: string
	cheapModelId?: string
}

export type ApiConfiguration = ApiHandlerOptions & {
	apiProvider?: ApiProvider
}

// Models

export interface ModelInfo {
	maxTokens: number
	contextWindow: number
	supportsImages: boolean
	supportsPromptCache: boolean
	inputPrice: number
	outputPrice: number
	cacheWritesPrice?: number | undefined
	cacheReadsPrice?: number | undefined
	disabld?: boolean
}

export type ApiModelId = KoduModelId

// Anthropic
// https://docs.anthropic.com/en/docs/about-claude/models
export type AnthropicModelId = keyof typeof anthropicModels
export const anthropicDefaultModelId: AnthropicModelId = "claude-3-5-sonnet-20241022"
export const anthropicModels: Record<string, ModelInfo> = {
	"claude-3-5-sonnet-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-5-sonnet-20240620": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0, // $3 per million input tokens
		outputPrice: 15.0, // $15 per million output tokens
		cacheWritesPrice: 3.75, // $3.75 per million tokens
		cacheReadsPrice: 0.3, // $0.30 per million tokens
	},
	"claude-3-opus-20240229": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 15.0,
		outputPrice: 75.0,
		cacheWritesPrice: 18.75,
		cacheReadsPrice: 1.5,
	},
	"claude-3-haiku-20240307": {
		maxTokens: 4096,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.25,
		outputPrice: 1.25,
		cacheWritesPrice: 0.3,
		cacheReadsPrice: 0.03,
	},
	"claude-3-5-haiku-20241022": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.0,
		outputPrice: 5.0,
		cacheWritesPrice: 1.25,
		cacheReadsPrice: 0.1,
	},
} as const

export type KoduModelId = string
export const koduDefaultModelId: KoduModelId = "claude-3-5-sonnet-20241022"
export const koduModels: Record<string, ModelInfo> = {
	...anthropicModels,
	// ...grokModels,
}
export type KoduModels = typeof koduModels

export const returnValidModelId = (modelId: string): KoduModelId => {
	if (modelId === "claude-3-5-sonnet-20240620") {
		return "claude-3-5-sonnet-20241022"
	}
	if (koduModels[modelId]) {
		return modelId
	}
	return koduDefaultModelId
}
