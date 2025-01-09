import * as vscode from "vscode"
import * as path from "path"
import { getCwd } from "../utils"
import delay from "delay"
import * as fs from "fs"

function getFreeColumn(): vscode.ViewColumn {
	const activeEditor = vscode.window.activeTextEditor
	if (!activeEditor) {
		return vscode.ViewColumn.One
	}

	switch (activeEditor.viewColumn) {
		case vscode.ViewColumn.One:
			return vscode.ViewColumn.Two
		case vscode.ViewColumn.Two:
			return vscode.ViewColumn.Three
		case vscode.ViewColumn.Three:
			return vscode.ViewColumn.Four
		case vscode.ViewColumn.Four:
			return vscode.ViewColumn.Five
		case vscode.ViewColumn.Five:
			return vscode.ViewColumn.Six
		case vscode.ViewColumn.Six:
			return vscode.ViewColumn.Seven
		case vscode.ViewColumn.Seven:
			return vscode.ViewColumn.Eight
		case vscode.ViewColumn.Eight:
			return vscode.ViewColumn.Nine
		default:
			return vscode.ViewColumn.One
	}
}

export class DiagnosticsHandler {
	private static instance: DiagnosticsHandler

	private constructor() {}

	public static getInstance(): DiagnosticsHandler {
		if (!DiagnosticsHandler.instance) {
			DiagnosticsHandler.instance = new DiagnosticsHandler()
		}
		return DiagnosticsHandler.instance
	}

	public async openFiles(paths: string[]): Promise<void> {
		for (const filePath of paths) {
			const fullPath = path.resolve(getCwd(), filePath)
			const uri = vscode.Uri.file(fullPath)
			const doc = await vscode.workspace.openTextDocument(uri)
		}
	}

	public async getDiagnostics(
		paths: string[],
		openDocs: boolean = false
	): Promise<{ key: string; errorString: string | null }[]> {
		return Promise.all(
			paths.map(async (filePath) => {
				try {
					const fullPath = path.resolve(getCwd(), filePath)
					const uri = vscode.Uri.file(fullPath)
					const viewColumn = vscode.window.activeTextEditor?.viewColumn
					if (openDocs) {
						const doc = await vscode.workspace.openTextDocument(uri)
						await vscode.window.showTextDocument(doc, {
							preview: false,
							preserveFocus: true,
							viewColumn,
						})
					}

					const diagnostics = vscode.languages.getDiagnostics(uri)
					const errors = diagnostics.filter((diag) => diag.severity === vscode.DiagnosticSeverity.Error)

					let errorString: string | null = null
					if (errors.length > 0) {
						errorString = await this.formatDiagnostics(uri, errors)
					}

					return { key: filePath, errorString }
				} catch (err) {
					return { key: filePath, errorString: null }
				}
			})
		)
	}

	private async formatDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): Promise<string> {
		const relativePath = vscode.workspace.asRelativePath(uri.fsPath).replace(/\\/g, "/")
		const fileContent = fs.readFileSync(uri.fsPath, "utf8")
		const lines = fileContent.split(/\r?\n/)

		const outputLines: string[] = []
		outputLines.push(`${relativePath}:`)

		const errorLines = diagnostics.map((d) => d.range.start.line + 1)
		const minLine = Math.max(Math.min(...errorLines) - 3, 1)
		const maxLine = Math.min(Math.max(...errorLines) + 3, lines.length)

		// Print each diagnostic in a simple one-line format with hover info
		for (const diagnostic of diagnostics) {
			const line = diagnostic.range.start.line + 1
			const column = diagnostic.range.start.character + 1
			const message = diagnostic.message.trim().replace(/\s+/g, " ")

			outputLines.push(`${line}:${column}: ${message}`)

			// Hover info
			const hoverInfo = await vscode.commands.executeCommand<vscode.Hover[]>(
				"vscode.executeHoverProvider",
				uri,
				diagnostic.range.start
			)
			if (hoverInfo && hoverInfo.length > 0) {
				const hoverLines: string[] = []
				for (const hover of hoverInfo) {
					for (const content of hover.contents) {
						let textValue: string = ""
						if (typeof content === "string") {
							textValue = content.trim()
						} else if ("value" in content) {
							if (content.value.trim().startsWith("```")) {
								textValue = content.value.trim()
							}
						}
						if (textValue) {
							hoverLines.push(textValue)
						}
					}
				}

				for (const hl of hoverLines) {
					outputLines.push(`  - Hover: ${hl}`)
				}
			}
		}

		// Print a single combined snippet at the end
		outputLines.push(`\nCode Snippet:`)
		outputLines.push(`...⋮...`)
		for (let i = minLine; i <= maxLine; i++) {
			const lineNumber = i.toString().padStart(2, " ")
			const prefix = errorLines.includes(i) ? "█" : "│"
			outputLines.push(` ${lineNumber}${prefix} ${lines[i - 1]}`)
		}
		outputLines.push(`...⋮...`)

		return outputLines.join("\n")
	}
}
