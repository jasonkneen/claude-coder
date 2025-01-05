import * as vscode from "vscode"

export interface McpProvider {
    context: vscode.ExtensionContext
    ensureMcpServersDirectoryExists(): Promise<string>
    ensureSettingsDirectoryExists(): Promise<string>
    postMessageToWebview(message: any): Promise<void>
}