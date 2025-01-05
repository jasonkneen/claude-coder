import * as path from "path"
import { DiffViewProvider } from "../../../../../integrations/editor/diff-view-provider"
import { ClaudeSayTool } from "../../../../../shared/ExtensionMessage"
import { fileExistsAtPath } from "../../../../../utils/path-helpers"
import { ToolResponse } from "../../../types"
import { formatToolResponse, getCwd, getReadablePath } from "../../../utils"
import { BaseAgentTool } from "../../base-agent.tool"
import { AgentToolOptions, AgentToolParams } from "../../types"
import { detectCodeOmission } from "./detect-code-omission"

export class WriteFileTool extends BaseAgentTool {
	protected params: AgentToolParams
	public diffViewProvider: DiffViewProvider
	private isProcessingFinalContent: boolean = false
	private lastUpdateTime: number = 0
	private readonly UPDATE_INTERVAL = 16
	private skipWriteAnimation: boolean = false
	private updateNumber: number = 0

	constructor(params: AgentToolParams, options: AgentToolOptions) {
		super(options)
		this.params = params
		this.diffViewProvider = new DiffViewProvider(getCwd(), this.koduDev)
		if (!!this.koduDev.getStateManager().skipWriteAnimation) {
			this.skipWriteAnimation = true
		}
	}

	override async execute() {
		const result = await this.processFileWrite()
		return result
	}

	/**
	 *
	 * @param relPath - relative path of the file
	 * @param acculmatedContent - the accumulated content to be written to the file
	 * @returns
	 */
	public async handlePartialUpdate(relPath: string, acculmatedContent: string): Promise<void> {
		// this might happen because the diff view are not instant.
		if (this.isProcessingFinalContent) {
			this.logger("Skipping partial update because the tool is processing the final content.", "warn")
			return
		}
		this.updateNumber++
		// if the user has skipped the write animation, we don't need to show the diff view until we reach the final state
		if (this.skipWriteAnimation) {
			await this.params.updateAsk(
				"tool",
				{
					tool: {
						tool: "write_to_file",
						content: acculmatedContent,
						path: relPath,
						ts: this.ts,
						approvalState: "loading",
					},
				},
				this.ts
			)
			return
		}

		const currentTime = Date.now()
		// don't push too many updates to the diff view provider to avoid performance issues
		if (currentTime - this.lastUpdateTime < this.UPDATE_INTERVAL) {
			return
		}

		if (!this.diffViewProvider.isDiffViewOpen() && this.updateNumber === 1) {
			try {
				// this actually opens the diff view but might take an extra few ms to be considered open requires interval check
				// it can take up to 300ms to open the diff view
				await this.diffViewProvider.open(relPath)
			} catch (e) {
				this.logger("Error opening diff view: " + e, "error")
				return
			}
		}
		await this.diffViewProvider.update(acculmatedContent, false)
		this.lastUpdateTime = currentTime
	}

	private async processFileWrite() {
		try {
			const { path: relPath, content } = this.params.input

			if (!relPath || !content) {
				throw new Error("Missing required parameters 'path' or 'content'")
			}
			// switch to final state asap
			this.isProcessingFinalContent = true

			// Show changes in diff view
			await this.showChangesInDiffView(relPath, content)

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

			if (response !== "yesButtonTapped") {
				await this.params.updateAsk(
					"tool",
					{
						tool: {
							tool: "write_to_file",
							content: content,
							approvalState: "rejected",
							path: relPath,
							ts: this.ts,
							userFeedback: text,
						},
					},
					this.ts
				)
				await this.diffViewProvider.revertChanges()

				if (response === "noButtonTapped") {
					// return formatToolResponse("Write operation cancelled by user.")
					// return this.toolResponse("rejected", "Write operation cancelled by user.")
					return this.toolResponse("rejected", "Write operation cancelled by user.")
				}
				// If not a yes or no, the user provided feedback (wrote in the input)
				await this.params.say("user_feedback", text ?? "The user denied this operation.", images)
				// return formatToolResponse(
				// 	`The user denied the write operation and provided the following feedback: ${text}`
				// )
				return this.toolResponse("feedback", text ?? "The user denied this operation.", images)
			}

			// Save changes and handle user edits
			const fileExists = await this.checkFileExists(relPath)
			const { userEdits, finalContent } = await this.diffViewProvider.saveChanges()
			this.koduDev.getStateManager().addErrorPath(relPath)

			// Final approval state
			await this.params.updateAsk(
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

			if (userEdits) {
				await this.params.say(
					"user_feedback_diff",
					JSON.stringify({
						tool: fileExists ? "editedExistingFile" : "newFileCreated",
						path: getReadablePath(getCwd(), relPath),
						diff: userEdits,
					} as ClaudeSayTool)
				)
				// return formatToolResponse(
				// 	`The user made the following updates to your content:\n\n${userEdits}\n\nThe updated content has been successfully saved to ${relPath.toPosix()}. (Note: you don't need to re-write the file with these changes.)`
				// )
				return this.toolResponse(
					"success",
					`The user made the following updates to your content:\n\n${userEdits}\n\nThe updated content has been successfully saved to ${relPath.toPosix()}. (Note: you don't need to re-write the file with these changes.)`
				)
			}

			// return formatToolResponse(
			// 	`The content was successfully saved to ${relPath.toPosix()}. Do not read the file again unless you forgot the content.`
			// )

			let toolMsg = `The content was successfully saved to ${relPath.toPosix()}. Do not read the file again unless you forgot the content.`
			if (detectCodeOmission(this.diffViewProvider.originalContent, finalContent)) {
				console.log(`Truncated content detected in ${relPath} at ${this.ts}`)
				toolMsg = `The content was successfully saved to ${relPath.toPosix()}, but it appears that some code may have been omitted. In caee you didn't write the entire content and included some placeholders or omitted critical parts, please try again with the full output of the code without any omissions / truncations anything similar to "remain", "remains", "unchanged", "rest", "previous", "existing", "..." should be avoided.
				You dont need to read the file again as the content has been updated to your previous tool request content.
				`
			}

			return this.toolResponse("success", toolMsg)
		} catch (error) {
			console.error("Error in processFileWrite:", error)
			this.params.updateAsk(
				"tool",
				{
					tool: {
						tool: "write_to_file",
						content: this.params.input.content ?? "",
						approvalState: "error",
						path: this.params.input.path ?? "",
						ts: this.ts,
						error: `Failed to write to file`,
					},
				},
				this.ts
			)

			// return formatToolResponse(
			// 	`Write to File Error With:${error instanceof Error ? error.message : String(error)}`
			// )
			return this.toolResponse(
				"error",
				`Write to File Error With:${error instanceof Error ? error.message : String(error)}`
			)
		} finally {
			this.isProcessingFinalContent = false
			this.diffViewProvider.isEditing = false
		}
	}

	private async showChangesInDiffView(relPath: string, content: string): Promise<void> {
		content = this.preprocessContent(content)
		if (!this.diffViewProvider.isDiffViewOpen()) {
			await this.diffViewProvider.open(relPath, true)
		}

		await this.diffViewProvider.update(content, true)
		await this.diffViewProvider.waitForPendingUpdates()
	}

	private async checkFileExists(relPath: string): Promise<boolean> {
		const absolutePath = path.resolve(getCwd(), relPath)
		return await fileExistsAtPath(absolutePath)
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
