import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"
import { McpHub } from "../../services/mcp/McpHub"

export class Provider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView
    private readonly mcpHub: McpHub

    public getMcpHub(): McpHub {
        return this.mcpHub
    }

    constructor(
        public readonly context: vscode.ExtensionContext
    ) {
        this.mcpHub = new McpHub(this)
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "dist"),
                vscode.Uri.joinPath(this.context.extensionUri, "webview-ui/dist"),
            ],
        }

        webviewView.webview.html = await this.getHtmlForWebview(webviewView.webview)

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case "mcpButtonClicked": {
                        await vscode.commands.executeCommand("kodu-claude-coder-main.mcpButtonClicked")
                        return
                    
                    break
                }
                case "openMcpSettings": {
                    const settingsDir = path.join(os.homedir(), "Library", "Application Support", "Cline")
                    try {
                        await vscode.workspace.fs.createDirectory(vscode.Uri.file(settingsDir))
                    } catch (error) {
                        console.error("Failed to create settings directory:", error)
                        return
                    }
                    const settingsPath = path.join(settingsDir, "mcp-settings.json")
                    const settingsUri = vscode.Uri.file(settingsPath)
                    
                    try {
                        await vscode.workspace.fs.stat(settingsUri)
                    } catch {
                        // File doesn't exist, create it with default content
                        const defaultContent = JSON.stringify({ mcpServers: {} }, null, 2)
                        await vscode.workspace.fs.writeFile(settingsUri, Buffer.from(defaultContent))
                    }
                    
                    const doc = await vscode.workspace.openTextDocument(settingsUri)
                    await vscode.window.showTextDocument(doc)
                    break
                }
                case "restartMcpServer": {
                    await vscode.commands.executeCommand("kodu-claude-coder-main.restartMcpServer", message.text)
                    break
                }
            }
        })
    }

    public async ensureMcpServersDirectoryExists(): Promise<string> {
        const mcpServersDir = path.join(os.homedir(), "Documents", "Cline", "MCP")
        try {
            await fs.mkdir(mcpServersDir, { recursive: true })
        } catch (error) {
            return "~/Documents/Cline/MCP" // in case creating a directory in documents fails for whatever reason (e.g. permissions)
        }
        return mcpServersDir
    }

    public async ensureSettingsDirectoryExists(): Promise<string> {
        const settingsDir = path.join(os.homedir(), "Library", "Application Support", "Cline")
        try {
            await fs.mkdir(settingsDir, { recursive: true })
        } catch (error) {
            console.error("Failed to create settings directory:", error)
            throw error
        }
        return settingsDir
    }

    public async postMessageToWebview(message: any): Promise<void> {
        if (this._view) {
            await this._view.webview.postMessage(message)
        }
    }

    private async getHtmlForWebview(webview: vscode.Webview): Promise<string> {
        const indexHtml = path.join(this.context.extensionPath, "webview-ui", "dist", "index.html")
        let html = await fs.readFile(indexHtml, "utf-8")

        // Update resource URIs
        html = html.replace(/src="([^"]*)"/g, (match, src) => {
            return `src="${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "webview-ui", "dist", src))}"`
        })

        return html
    }
}