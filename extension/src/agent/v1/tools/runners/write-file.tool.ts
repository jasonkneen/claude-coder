import * as path from "path"
import { ClaudeSayTool } from "../../../../shared/ExtensionMessage"
import { ToolResponse } from "../../types"
import { formatToolResponse, getCwd, getReadablePath } from "../../utils"
import { AgentToolOptions, AgentToolParams } from "../types"
import { BaseAgentTool } from "../base-agent.tool"
import { DiffViewProvider } from "../../../../integrations/editor/diff-view-provider"
import { fileExistsAtPath } from "../../../../utils/path-helpers"
import delay from "delay"
import pWaitFor from "p-wait-for"

export class WriteFileTool extends BaseAgentTool {
	protected params: AgentToolParams
	public diffViewProvider: DiffViewProvider
	private isProcessingFinalContent: boolean = false
	private lastUpdateLength: number = 0
	private lastUpdateTime: number = 0
	private readonly UPDATE_INTERVAL = 33 // Approximately 60 FPS
	private skipWriteAnimation: boolean = false

	constructor(params: AgentToolParams, options: AgentToolOptions) {
		super(options)
		this.params = params
		// Initialize DiffViewProvider without opening the diff editor
		this.diffViewProvider = new DiffViewProvider(getCwd(), this.koduDev, this.UPDATE_INTERVAL)
		// Set skipWriteAnimation based on state manager
		if (!!this.koduDev.getStateManager().skipWriteAnimation) {
			this.skipWriteAnimation = true
		}
	}

	override async execute(): Promise<ToolResponse> {
		// Perform initial ask without awaiting
		this.params.ask(
			"tool",
			{
				tool: {
					tool: "write_to_file",
					content: this.params.input.content ?? "",
					approvalState: "loading",
					path: this.params.input.path ?? "",
					ts: this.ts,
				},
			},
			this.ts
		)
		await pWaitFor(() => this.isFinal, { interval: 20 })

		const result = await this.processFileWrite()

		return result
	}

	private async processFileWrite(): Promise<ToolResponse> {
		try {
			const { path: relPath, content } = this.params.input

			if (!relPath || !content) {
				throw new Error("Missing required parameters 'path' or 'content'")
			}

			// Handle partial content if not final and skipWriteAnimation is false
			if (!this.params.isFinal && !this.skipWriteAnimation) {
				await this.handlePartialContent(relPath, content)
			} else if (!this.params.isFinal && this.skipWriteAnimation) {
				// Do nothing if skipWriteAnimation is true
			} else {
				// Handle final content we must confirm so we put skipWriteAnimation to false
				this.skipWriteAnimation = false
				await this.handlePartialContent(relPath, content)
				await this.handleFinalContentForConfirmation(relPath, content)
				this.isProcessingFinalContent = true
			}

			console.log("Asking for user approval")
			// Ask for user approval and await response
			const { response, text, images } = await this.params.ask(
				"tool",
				{
					tool: {
						tool: "write_to_file",
						content: content,
						approvalState: "pending",
						path: relPath,
						ts: this.ts,
					},
				},
				this.ts
			)
			console.log("User responded at:", Date.now())

			if (response !== "yesButtonTapped") {
				// Revert changes if user declines
				await this.diffViewProvider.revertChanges()
				this.params.ask(
					"tool",
					{
						tool: {
							tool: "write_to_file",
							content: this.params.input.content ?? "No content provided",
							approvalState: "rejected",
							path: relPath,
							ts: this.ts,
						},
					},
					this.ts
				)
				if (response === "noButtonTapped") {
					return formatToolResponse("Write operation cancelled by user.")
				}
				return formatToolResponse(text ?? "Write operation cancelled by user.", images)
			}

			// Proceed with final content handling
			const fileContent = await this.handleFinalContent(relPath, content)

			// Notify approval
			this.params.ask(
				"tool",
				{
					tool: {
						tool: "write_to_file",
						content: content,
						approvalState: "approved",
						path: relPath,
						ts: this.ts,
					},
				},
				this.ts
			)

			// Return success message
			return formatToolResponse(fileContent)
		} catch (error) {
			console.error("Error in processFileWrite:", error)
			return formatToolResponse(`Error: ${error.message}`)
		} finally {
			this.isProcessingFinalContent = false
			this.diffViewProvider.isEditing = false
		}
	}

	public async handlePartialContent(relPath: string, newContent: string): Promise<void> {
		if (this.isProcessingFinalContent) {
			console.log("Skipping partial update as final content is being processed")
			return
		}

		if (this.skipWriteAnimation) {
			console.log("Skipping write animation for partial content")
			return
		}

		const currentTime = Date.now()

		if (!this.diffViewProvider.isDiffViewOpen()) {
			try {
				await this.diffViewProvider.open(relPath)
				this.lastUpdateLength = 0
				this.lastUpdateTime = currentTime
			} catch (e) {
				console.error("Error opening file: ", e)
			}
		}

		// Check if enough time has passed since the last update
		if (currentTime - this.lastUpdateTime < this.UPDATE_INTERVAL) {
			return
		}

		// Perform the update
		await this.diffViewProvider.update(newContent, false)
		this.lastUpdateTime = currentTime
	}

	private async handleFinalContentForConfirmation(relPath: string, newContent: string): Promise<void> {
		console.log(`Handling final content for confirmation: ${relPath}`)
		newContent = this.preprocessContent(newContent)
		if (!this.diffViewProvider.isEditing) {
			await this.diffViewProvider.open(relPath)
		}
		await this.diffViewProvider.update(newContent, true)
	}

	public async handleFinalContent(relPath: string, newContent: string): Promise<string> {
		this.koduDev.getStateManager().addErrorPath(relPath)
		const fileExists = await this.checkFileExists(relPath)
		const { userEdits } = await this.diffViewProvider.saveChanges()
		await delay(150)
		this.params.ask(
			"tool",
			{
				tool: {
					tool: "write_to_file",
					content: newContent,
					approvalState: "approved",
					ts: this.ts,
					path: relPath,
				},
			},
			this.ts
		)

		if (userEdits) {
			await this.params.say(
				"user_feedback_diff",
				JSON.stringify({
					tool: fileExists ? "editedExistingFile" : "newFileCreated",
					path: getReadablePath(getCwd(), relPath),
					diff: userEdits,
				} as ClaudeSayTool)
			)
			console.log(`User edits detected: ${userEdits}`)
		}

		let response: string
		if (userEdits) {
			response = `The user made the following updates to your content:\n\n${userEdits}\n\nThe updated content, which includes both your original modifications and the user's additional edits, has been successfully saved to ${relPath.toPosix()}. (Note this does not mean you need to re-write the file with the user's changes, as they have already been applied to the file.)`
		} else {
			response = `The content was successfully saved to ${relPath.toPosix()}.
			Do not read the file again unless you forgot the file content, (the current content is the one you sent in <content>...</content>).`
		}

		return response
	}

	private async checkFileExists(relPath: string): Promise<boolean> {
		const absolutePath = path.resolve(getCwd(), relPath)
		const fileExists = await fileExistsAtPath(absolutePath)
		return fileExists
	}

	override async abortToolExecution(): Promise<void> {
		console.log("Aborting WriteFileTool execution")
		await this.diffViewProvider.revertChanges()
	}

	private preprocessContent(content: string): string {
		content = content.trim()
		if (content.startsWith("```")) {
			content = content.split("\n").slice(1).join("\n").trim()
		}
		if (content.endsWith("```")) {
			content = content.split("\n").slice(0, -1).join("\n").trim()
		}

		return content.replace(/>/g, ">").replace(/</g, "<").replace(/"/g, '"')
	}
}
