import * as vscode from "vscode"
import { KoduDev } from "../agent/v1"
import { McpHub } from "../services/mcp/McpHub"
import { McpProvider } from "../services/mcp/McpProvider"
import { extensionName } from "../shared/constants"
import { HistoryItem } from "../shared/history-item"
import { ApiManager } from "./state/api-manager"
import { ExtensionStateManager } from "./state/extension-state-manager"
import { GlobalStateManager } from "./state/global-state-manager"
import { SecretStateManager } from "./state/secret-state-manager"
import { TaskManager } from "./state/task-manager"
import { WebviewManager } from "./webview/webview-manager"

export class ExtensionProvider implements vscode.WebviewViewProvider, McpProvider {
	public static readonly sideBarId = `${extensionName}.SidebarProvider`
	public static readonly tabPanelId = `${extensionName}.TabPanelProvider`
	private disposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private _koduDev?: KoduDev
	private mcpHub!: McpHub
	private stateManager!: ExtensionStateManager
	private webviewManager!: WebviewManager
	private secretStateManager!: SecretStateManager
	private taskManager!: TaskManager
	private globalStateManager!: GlobalStateManager
	private apiManager!: ApiManager

	constructor(readonly context: vscode.ExtensionContext, private readonly outputChannel: vscode.OutputChannel) {
		this.outputChannel.appendLine("ExtensionProvider instantiated")
		this.initialize()
	}

	private initialize(): void {
		// Initialize core services first
		this.globalStateManager = GlobalStateManager.getInstance(this.context)
		this.secretStateManager = SecretStateManager.getInstance(this.context)
		this.stateManager = new ExtensionStateManager(this)
		this.taskManager = new TaskManager(this)
		this.apiManager = ApiManager.getInstance(this)
		this.webviewManager = new WebviewManager(this)

		// Initialize MCP after implementing required methods
		this.mcpHub = new McpHub(this)
	}

	// McpProvider implementation
	async ensureMcpServersDirectoryExists(): Promise<string> {
		const serversPath = vscode.Uri.joinPath(this.context.globalStorageUri, 'mcp-servers').fsPath
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(serversPath))
		return serversPath
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const settingsPath = vscode.Uri.joinPath(this.context.globalStorageUri, 'mcp-settings').fsPath
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(settingsPath))
		return settingsPath
	}

	async postMessageToWebview(message: any): Promise<void> {
		await this.webviewManager.postMessageToWebview(message)
	}

	// WebviewViewProvider implementation
	resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
		this.outputChannel.appendLine("Resolving webview view")
		this.view = webviewView

		this.webviewManager.setupWebview(webviewView)

		webviewView.onDidDispose(
			async () => {
				await this.dispose()
			},
			null,
			this.disposables
		)

		vscode.workspace.onDidChangeConfiguration(
			(e) => {
				if (e && e.affectsConfiguration("workbench.colorTheme")) {
					this.webviewManager.postBaseStateToWebview()
				}
			},
			null,
			this.disposables
		)

		this.taskManager.clearTask()
		this.outputChannel.appendLine("Webview view resolved")
	}

	// KoduDev property accessors
	public get koduDev(): KoduDev | undefined {
		return this._koduDev
	}

	public set koduDev(value: KoduDev | undefined) {
		this._koduDev = value
	}

	// Initialization methods
	async initWithTask(task?: string, images?: string[], isDebug?: boolean): Promise<void> {
		await this.taskManager.clearTask()
		const state = await this.stateManager.getState()
		this.koduDev = new KoduDev({
			gitHandlerEnabled: state.gitHandlerEnabled,
			provider: this,
			apiConfiguration: { ...state.apiConfiguration, koduApiKey: state.apiConfiguration.koduApiKey },
			customInstructions: state.customInstructions,
			alwaysAllowReadOnly: state.alwaysAllowReadOnly,
			alwaysAllowWriteOnly: state.alwaysAllowWriteOnly,
			inlineEditOutputType: state.inlineEditOutputType,
			task,
			images,
			skipWriteAnimation: state.skipWriteAnimation,
			autoSummarize: state.autoSummarize,
			autoCloseTerminal: state.autoCloseTerminal,
			isDebug,
		})
	}

	async initWithHistoryItem(historyItem: HistoryItem): Promise<void> {
		await this.taskManager.clearTask()
		const state = await this.stateManager.getState()
		this.koduDev = new KoduDev({
			gitHandlerEnabled: state.gitHandlerEnabled,
			provider: this,
			apiConfiguration: { ...state.apiConfiguration, koduApiKey: state.apiConfiguration.koduApiKey },
			customInstructions: state.customInstructions,
			alwaysAllowReadOnly: state.alwaysAllowReadOnly,
			alwaysAllowWriteOnly: state.alwaysAllowWriteOnly,
			inlineEditOutputType: state.inlineEditOutputType,
			autoSummarize: state.autoSummarize,
			skipWriteAnimation: state.skipWriteAnimation,
			autoCloseTerminal: state.autoCloseTerminal,
			historyItem,
		})
	}

	async initWithNoTask(): Promise<void> {
		await this.taskManager.clearTask()
		const state = await this.stateManager.getState()
		this.koduDev = new KoduDev({
			gitHandlerEnabled: state.gitHandlerEnabled,
			provider: this,
			apiConfiguration: { ...state.apiConfiguration, koduApiKey: state.apiConfiguration.koduApiKey },
			customInstructions: state.customInstructions,
			alwaysAllowReadOnly: state.alwaysAllowReadOnly,
			alwaysAllowWriteOnly: state.alwaysAllowWriteOnly,
			inlineEditOutputType: state.inlineEditOutputType,
			skipWriteAnimation: state.skipWriteAnimation,
			autoCloseTerminal: state.autoCloseTerminal,
			autoSummarize: state.autoSummarize,
			noTask: true,
		})
	}

	// Cleanup
	async dispose(): Promise<void> {
		this.outputChannel.appendLine("Disposing ExtensionProvider...")
		await this.taskManager.clearTask()
		this.outputChannel.appendLine("Cleared task")
		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.outputChannel.appendLine("Disposed webview")
		}
		while (this.disposables.length) {
			const x = this.disposables.pop()
			if (x) {
				x.dispose()
			}
		}
		this.outputChannel.appendLine("Disposed all disposables")
	}

	// Getters
	getKoduDev(): KoduDev | undefined {
		return this.koduDev
	}

	getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	getStateManager(): ExtensionStateManager {
		return this.stateManager
	}

	getState() {
		return this.stateManager.getState()
	}

	getWebviewManager(): WebviewManager {
		return this.webviewManager
	}

	getTaskManager(): TaskManager {
		return this.taskManager
	}

	getSecretStateManager(): SecretStateManager {
		return this.secretStateManager
	}

	getGlobalStateManager(): GlobalStateManager {
		return this.globalStateManager
	}

	getApiManager(): ApiManager {
		return this.apiManager
	}

	getContext(): vscode.ExtensionContext {
		return this.context
	}

	getOutputChannel(): vscode.OutputChannel {
		return this.outputChannel
	}
}