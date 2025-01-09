/**
 * @fileoverview API Manager for handling Claude API interactions
 * This module manages API communications with the Anthropic Claude API, handling message streams,
 * token calculations, and conversation history management.
 */

import { AxiosError } from "axios"
import { ApiConstructorOptions, ApiHandler, buildApiHandler } from "."
import { ExtensionProvider } from "../providers/extension-provider"
import { KoduError, koduSSEResponse } from "../shared/kodu"
import { amplitudeTracker } from "../utils/amplitude"
import { ApiHistoryItem } from "../agent/v1/types"
import { isTextBlock } from "../agent/v1/utils"

// Imported utility functions
import { calculateApiCost } from "./api-utils"
import { processConversationHistory, manageContextWindow } from "./conversation-utils"
import { mainPrompts } from "../agent/v1/prompts/main.prompt"
import dedent from "dedent"
import { PromptStateManager } from "../providers/state/prompt-state-manager"
import { buildPromptFromTemplate } from "../agent/v1/prompts/utils/utils"

/**
 * Main API Manager class that handles all Claude API interactions
 */
export class ApiManager {
	private api: ApiHandler
	private customInstructions?: string
	private providerRef: WeakRef<ExtensionProvider>

	constructor(provider: ExtensionProvider, apiConfiguration: ApiConstructorOptions, customInstructions?: string) {
		this.api = buildApiHandler(apiConfiguration)
		this.customInstructions = customInstructions
		this.providerRef = new WeakRef(provider)
	}

	/**
	 * Returns the current API handler instance
	 */
	public getApi(): ApiHandler {
		return this.api
	}

	/**
	 * Returns the current model ID
	 */
	public getModelId(): string {
		return this.api.getModel().id
	}

	public getModelInfo() {
		return this.api.getModel().info
	}

	/**
	 * Updates the API configuration
	 * @param apiConfiguration - New API configuration
	 */
	public updateApi(apiConfiguration: ApiConstructorOptions): void {
		this.log("info", "Updating API configuration", apiConfiguration)
		this.api = buildApiHandler(apiConfiguration)
	}

	/**
	 * Updates custom instructions for the API
	 * @param customInstructions - New custom instructions
	 */
	public updateCustomInstructions(customInstructions: string | undefined): void {
		this.customInstructions = customInstructions
	}

	/**
	 * Formats custom instructions with proper sectioning
	 * @returns Formatted custom instructions string
	 */
	public formatCustomInstructions(): string | undefined {
		if (!this.customInstructions?.trim()) {
			return undefined
		}

		return dedent`====
USER'S CUSTOM INSTRUCTIONS
The following additional instructions are provided by the user. They should be followed and given precedence in case of conflicts with previous instructions.

${this.customInstructions.trim()}
`
	}

	/**
	 * Creates a streaming API request
	 * @param apiConversationHistory - Conversation history
	 * @param abortController - Optional abort signal for cancelling requests
	 * @returns AsyncGenerator yielding SSE responses
	 */
	async *createApiStreamRequest(
		apiConversationHistory: ApiHistoryItem[],
		abortController: AbortController,
		customSystemPrompt?: {
			automaticReminders?: string
			systemPrompt?: string | []
			customInstructions?: string
			useExistingSystemPrompt?: (systemPrompt: string[]) => string[]
		},
		skipProcessing = false,
		postProcessConversationCallback?: (apiConversationHistory: ApiHistoryItem[]) => Promise<void>
	): AsyncGenerator<koduSSEResponse> {
		const provider = this.providerRef.deref()
		if (!provider || !provider.koduDev) {
			throw new Error("Provider reference has been garbage collected")
		}

		const executeRequest = async () => {
			const conversationHistory =
				apiConversationHistory ??
				(await provider.koduDev?.getStateManager().apiHistoryManager.getSavedApiConversationHistory())

			let baseSystem = [await this.getCurrentPrompts()]
			if (customSystemPrompt?.systemPrompt) {
				if (Array.isArray(customSystemPrompt.systemPrompt)) {
					baseSystem = customSystemPrompt.systemPrompt
				} else {
					baseSystem = [customSystemPrompt.systemPrompt]
				}
			}
			let criticalMsg: string | undefined = mainPrompts.criticalMsg
			if (customSystemPrompt) {
				criticalMsg = customSystemPrompt.automaticReminders
			}
			// we want to replace {{task}} with the current task if it exists in the critical message
			if (criticalMsg) {
				const firstRequest = conversationHistory.at(0)?.content
				const firstRequestTextBlock = Array.isArray(firstRequest)
					? firstRequest.find(isTextBlock)?.text
					: firstRequest
				if (firstRequestTextBlock && criticalMsg.includes("{{task}}")) {
					criticalMsg = criticalMsg.replace("{{task}}", this.getTaskText(firstRequestTextBlock))
				}
			}

			// Process conversation history using our external utility
			if (!skipProcessing) {
				await processConversationHistory(provider.koduDev!, conversationHistory, criticalMsg, true)
			} else {
				this.log("info", `Skipping conversation history processing`)
			}
			if (postProcessConversationCallback) {
				await postProcessConversationCallback?.(conversationHistory)
			}
			// log the last 2 messages
			this.log("info", `Last 2 messages:`, conversationHistory.slice(-2))

			let systemPrompt = [...baseSystem]
			const customInstructions = this.formatCustomInstructions()
			if (customInstructions && !customSystemPrompt?.customInstructions) {
				systemPrompt.push(customInstructions)
			}
			if (customSystemPrompt?.customInstructions) {
				systemPrompt.push(customSystemPrompt.customInstructions)
			}
			if (customSystemPrompt?.useExistingSystemPrompt) {
				systemPrompt = customSystemPrompt.useExistingSystemPrompt(systemPrompt)
			}
			const stream = await this.api.createMessageStream({
				systemPrompt,
				messages: conversationHistory,
				modelId: this.getModelId(),
				abortSignal: abortController.signal,
			})

			return stream
		}

		let lastMessageAt = 0
		const TIMEOUT_MS = 10_000 // 10 seconds
		const checkInactivity = setInterval(() => {
			const timeSinceLastMessage = Date.now() - lastMessageAt
			if (lastMessageAt > 0 && timeSinceLastMessage > TIMEOUT_MS) {
				abortController?.abort()
				return
			}
		}, 1000)

		try {
			// Update the UI with the request running state
			this.providerRef.deref()?.getWebviewManager().postMessageToWebview({
				type: "requestStatus",
				isRunning: true,
			})

			let retryAttempt = 0
			const MAX_RETRIES = 5
			let shouldResetContext = false

			while (retryAttempt <= MAX_RETRIES) {
				try {
					const stream = await executeRequest()

					for await (const chunk of stream) {
						if (chunk.code === 1) {
							clearInterval(checkInactivity)
							yield* this.processStreamChunk(chunk)
							return
						}

						if (
							(chunk.code === -1 && chunk.body.msg?.includes("prompt is too long")) ||
							shouldResetContext
						) {
							// clear the interval
							clearInterval(checkInactivity)
							// Compress the context and retry
							const result = await manageContextWindow(provider.koduDev!, this.api, (s, msg, ...args) =>
								this.log(s, msg, ...args)
							)
							if (result === "chat_finished") {
								throw new KoduError({ code: 413 })
							}
							retryAttempt++
							break // Break the for loop to retry with compressed history
						}

						lastMessageAt = Date.now()
						yield* this.processStreamChunk(chunk)
					}
				} catch (streamError) {
					if (streamError instanceof Error && streamError.message === "aborted") {
						throw new KoduError({ code: 1 })
					}
					throw streamError
				}
			}

			// If we've exhausted all retries
			throw new Error("Maximum retry attempts reached for context compression")
		} catch (error) {
			if (error instanceof Error && error.message === "aborted") {
				error = new KoduError({ code: 1 })
			}
			if (error instanceof AxiosError) {
				error = new KoduError({ code: 1 })
			}
			this.handleStreamError(error)
		} finally {
			// Update the UI with the request running state
			this.providerRef.deref()?.getWebviewManager().postMessageToWebview({
				type: "requestStatus",
				isRunning: false,
			})
			clearInterval(checkInactivity)
		}
	}

	/**
	 * Processes stream chunks from the API response
	 * @param chunk - SSE response chunk
	 */
	private async *processStreamChunk(chunk: koduSSEResponse): AsyncGenerator<koduSSEResponse> {
		switch (chunk.code) {
			case 0:
				break
			case 1:
				await this.handleFinalResponse(chunk)
				break
		}

		yield chunk
	}

	/**
	 * Handles the final response from the API
	 * @param chunk - Final response chunk
	 */
	private async handleFinalResponse(chunk: koduSSEResponse): Promise<void> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return
		}
		if (chunk.code !== 1) {
			return
		}
		const response = chunk?.body?.anthropic
		const { input_tokens, output_tokens } = response.usage
		const { cache_creation_input_tokens, cache_read_input_tokens } = response.usage as any

		// Update credits if provided
		if (chunk.body.internal.userCredits !== undefined) {
			await provider.getStateManager()?.updateKoduCredits(chunk.body.internal.userCredits)
		}

		// Track metrics
		const state = await provider.getState()
		const apiCost = calculateApiCost(
			this.getModelInfo(),
			input_tokens,
			output_tokens,
			cache_creation_input_tokens,
			cache_read_input_tokens
		)
		this.log("info", `API REQUEST FINISHED: ${apiCost} tokens used data:`, response)

		amplitudeTracker.taskRequest({
			taskId: state?.currentTaskId!,
			model: this.getModelId(),
			apiCost: apiCost,
			inputTokens: input_tokens,
			cacheReadTokens: cache_read_input_tokens,
			cacheWriteTokens: cache_creation_input_tokens,
			outputTokens: output_tokens,
			provider: this.getModelInfo().provider ?? "kodu",
		})
	}

	private async getCurrentPrompts() {
		const template =
			(await PromptStateManager.getInstance().getActivePromptContent()) ??
			PromptStateManager.getInstance().getDefaultPromptContent()

		return await buildPromptFromTemplate(template)
	}

	/**
	 * Handles stream errors
	 * @param error - Error from the stream
	 */
	private handleStreamError(error: unknown): never {
		if (error instanceof KoduError) {
			console.error("KODU API request failed", error)
			throw error
		}

		if (error instanceof AxiosError) {
			throw new KoduError({
				code: error.response?.status || 500,
			})
		}

		throw error
	}

	private getTaskText(str: string) {
		const [taskStartTag, taskEndTag] = ["<task>", "</task>"]
		const [start, end] = [str.indexOf(taskStartTag), str.indexOf(taskEndTag)]
		return str.slice(start + taskStartTag.length, end)
	}

	private log(status: "info" | "debug" | "error", message: string, ...args: any[]) {
		console[status](`[API Manager] ${message}`, ...args)
	}
}
