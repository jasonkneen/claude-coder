import {
    CallToolResultSchema,
    Client,
    ListResourcesResultSchema,
    ListResourceTemplatesResultSchema,
    ListToolsResultSchema,
    ReadResourceResultSchema,
    StdioClientTransport,
    StdioServerParameters
} from "@modelcontextprotocol/sdk"
import chokidar, { FSWatcher } from "chokidar"
import delay from "delay"
import deepEqual from "fast-deep-equal"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import {
    McpResource,
    McpResourceResponse,
    McpResourceTemplate,
    McpServer,
    McpTool,
    McpToolCallResponse,
} from "../../shared/mcp"
import { fileExistsAtPath } from "../../utils/fs"
import { arePathsEqual } from "../../utils/path"
import { McpProvider } from "./McpProvider"

export type McpConnection = {
    server: McpServer
    client: Client
    transport: StdioClientTransport
}

const StdioConfigSchema = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
})

const McpSettingsSchema = z.object({
    mcpServers: z.record(StdioConfigSchema),
})

export class McpHub {
    private readonly providerRef: WeakRef<McpProvider>
    private readonly disposables: vscode.Disposable[] = []
    private settingsWatcher?: vscode.FileSystemWatcher
    private readonly fileWatchers: Map<string, FSWatcher> = new Map()
    private connections: McpConnection[] = []
    isConnecting: boolean = false

    constructor(provider: McpProvider) {
        this.providerRef = new WeakRef(provider)
        this.watchMcpSettingsFile()
        this.initializeMcpServers()
    }

    getServers(): McpServer[] {
        return this.connections.map((conn) => conn.server)
    }

    async getMcpServersPath(): Promise<string> {
        const provider = this.providerRef.deref()
        if (!provider) {
            throw new Error("Provider not available")
        }
        const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
        return mcpServersPath
    }

    public async getMcpSettingsFilePath(): Promise<string> {
        const provider = this.providerRef.deref()
        if (!provider) {
            throw new Error("Provider not available")
        }
        const mcpSettingsFilePath = path.join(
            await provider.ensureSettingsDirectoryExists(),
            "mcp-settings.json"
        )
        const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
        if (!fileExists) {
            await fs.writeFile(
                mcpSettingsFilePath,
                JSON.stringify({ mcpServers: {} }, null, 2)
            )
        }
        return mcpSettingsFilePath
    }

    private async watchMcpSettingsFile(): Promise<void> {
        const settingsPath = await this.getMcpSettingsFilePath()
        this.disposables.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (arePathsEqual(document.uri.fsPath, settingsPath)) {
                    const content = await fs.readFile(settingsPath, "utf-8")
                    const errorMessage =
                        "Invalid MCP settings format. Please ensure your settings follow the correct JSON format."
                    let config: unknown
                    try {
                        config = JSON.parse(content)
                    } catch (error) {
                        vscode.window.showErrorMessage(errorMessage)
                        return
                    }
                    const result = McpSettingsSchema.safeParse(config)
                    if (!result.success) {
                        vscode.window.showErrorMessage(errorMessage)
                        return
                    }
                    try {
                        vscode.window.showInformationMessage("Updating MCP servers...")
                        await this.updateServerConnections(result.data.mcpServers)
                        vscode.window.showInformationMessage("MCP servers updated")
                    } catch (error) {
                        console.error("Failed to process MCP settings change:", error)
                    }
                }
            })
        )
    }

    public async initializeMcpServers(): Promise<void> {
        try {
            // Get MCP servers directory
            const mcpServersDir = await this.getMcpServersPath()
            const entries = await fs.readdir(mcpServersDir, { withFileTypes: true })

            // Discover available servers
            const servers: Record<string, StdioServerParameters> = {}
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const serverPath = path.join(mcpServersDir, entry.name)
                    const configPath = path.join(serverPath, "config.json")

                    if (await fileExistsAtPath(configPath)) {
                        try {
                            const content = await fs.readFile(configPath, "utf-8")
                            const config = JSON.parse(content)
                            const result = StdioConfigSchema.safeParse(config)
                            if (result.success) {
                                servers[entry.name] = result.data
                            }
                        } catch (error) {
                            console.error(`Failed to load config for server ${entry.name}:`, error)
                            vscode.window.showErrorMessage(`Failed to load config for server ${entry.name}`)
                        }
                    }
                }
            }

            // Load user settings
            const settingsPath = await this.getMcpSettingsFilePath()
            const settingsContent = await fs.readFile(settingsPath, "utf-8")
            const settings = JSON.parse(settingsContent)
            const result = McpSettingsSchema.safeParse(settings)

            if (result.success) {
                // Merge discovered servers with user settings
                const mergedServers = { ...servers, ...result.data.mcpServers }
                await this.updateServerConnections(mergedServers)
            } else {
                // Use discovered servers if settings are invalid
                await this.updateServerConnections(servers)
                vscode.window.showWarningMessage("Invalid MCP settings format, using discovered servers only")
            }
        } catch (error) {
            console.error("Failed to initialize MCP servers:", error)
            vscode.window.showErrorMessage("Failed to initialize MCP servers")
        }
    }

    private async connectToServer(name: string, config: StdioServerParameters): Promise<void> {
        try {
            // Create client with proper version and capabilities
            const client = new Client(
                {
                    name: "Claude Coder",
                    version: this.providerRef.deref()?.context.extension?.packageJSON?.version ?? "1.0.0",
                },
                {
                    capabilities: {},
                }
            )

            // Create transport with proper configuration
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: {
                    ...config.env,
                    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
                },
                stderr: "pipe",
            })

            // Set up error handling
            transport.onerror = async (error: Error) => {
                console.error(`Transport error for "${name}":`, error)
                const connection = this.connections.find((conn) => conn.server.name === name)
                if (connection) {
                    connection.server.status = "disconnected"
                    connection.server.error = error.message
                    await this.notifyWebviewOfServerChanges()
                }
            }

            // Handle transport close
            transport.onclose = async () => {
                const connection = this.connections.find((conn) => conn.server.name === name)
                if (connection) {
                    connection.server.status = "disconnected"
                    await this.notifyWebviewOfServerChanges()
                }
            }

            // Create initial connection
            const connection: McpConnection = {
                server: {
                    name,
                    config: JSON.stringify(config),
                    status: "connecting",
                },
                client,
                transport,
            }

            // Remove existing connection if it exists
            await this.deleteConnection(name)
            this.connections.push(connection)

            // Start transport and connect client
            await transport.start()
            await client.connect(transport)
            connection.server.status = "connected"
            connection.server.error = ""

            // Set up file watcher for server updates
            this.setupFileWatcher(name, config)

            // Fetch server capabilities
            await Promise.all([
                this.fetchTools.call(this, connection),
                this.fetchResources.call(this, connection),
                this.fetchResourceTemplates.call(this, connection)
            ])

            // Notify UI of server changes
            await this.notifyWebviewOfServerChanges()
        } catch (error) {
            // Handle connection errors
            const connection = this.connections.find((conn) => conn.server.name === name)
            if (connection) {
                connection.server.status = "disconnected"
                connection.server.error = error instanceof Error ? error.message : String(error)
                await this.notifyWebviewOfServerChanges()
            }

            // Clean up failed connection
            await this.deleteConnection(name)
            throw error
        }
    }

    private async fetchServerCapabilities(serverName: string): Promise<void> {
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        if (!connection || connection.server.status !== "connected") {
            return
        }

        try {
            // Fetch server capabilities in parallel
            const [tools, resources, templates] = await Promise.all([
                connection.client.request(
                    { method: "tools/list" },
                    ListToolsResultSchema
                ) as Promise<{ tools: McpTool[] }>,
                connection.client.request(
                    { method: "resources/list" },
                    ListResourcesResultSchema
                ) as Promise<{ resources: McpResource[] }>,
                connection.client.request(
                    { method: "resources/templates/list" },
                    ListResourceTemplatesResultSchema
                ) as Promise<{ resourceTemplates: McpResourceTemplate[] }>
            ])

            // Update server capabilities if still connected
            if (connection.server.status === "connected") {
                connection.server.tools = tools.tools || []
                connection.server.resources = resources.resources || []
                connection.server.resourceTemplates = templates.resourceTemplates || []
                await this.notifyWebviewOfServerChanges()
            }
        } catch (error) {
            console.error(`Failed to fetch capabilities for ${serverName}:`, error)
            if (connection.server.status === "connected") {
                connection.server.error = error instanceof Error ? error.message : String(error)
                await this.notifyWebviewOfServerChanges()
            }
        }
    }

    async deleteConnection(name: string): Promise<void> {
        const connection = this.connections.find((conn) => conn.server.name === name)
        if (!connection) {
            return
        }

        // Remove file watcher
        const watcher = this.fileWatchers.get(name)
        if (watcher) {
            watcher.close()
            this.fileWatchers.delete(name)
        }

        try {
            // Close transport and client
            await Promise.all([
                connection.transport.close().catch(error => {
                    console.error(`Failed to close transport for ${name}:`, error)
                }),
                connection.client.close().catch(error => {
                    console.error(`Failed to close client for ${name}:`, error)
                })
            ])
        } finally {
            // Always remove connection from list
            this.connections = this.connections.filter((conn) => conn.server.name !== name)
            await this.notifyWebviewOfServerChanges()
        }
    }

    public async updateServerConnections(newServers: Record<string, unknown>): Promise<void> {
        this.isConnecting = true
        try {
            // Get current and new server names
            const currentNames = new Set(this.connections.map((conn) => conn.server.name))
            const newNames = new Set(Object.keys(newServers))

            // Remove deleted servers in parallel
            await Promise.all(
                Array.from(currentNames)
                    .filter(name => !newNames.has(name))
                    .map(async name => {
                        await this.deleteConnection(name)
                        console.log(`Deleted MCP server: ${name}`)
                    })
            )

            // Update or add servers in parallel
            await Promise.all(
                Object.entries(newServers).map(async ([name, config]) => {
                    const currentConnection = this.connections.find((conn) => conn.server.name === name)
                    const serverConfig = config as StdioServerParameters

                    // Validate server config
                    const result = StdioConfigSchema.safeParse(serverConfig)
                    if (!result.success) {
                        console.error(`Invalid config for server ${name}:`, result.error)
                        vscode.window.showErrorMessage(`Invalid config for server ${name}`)
                        return
                    }

                    try {
                        if (!currentConnection) {
                            // Add new server
                            await this.connectToServer(name, result.data)
                            console.log(`Connected to new MCP server: ${name}`)
                        } else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
                            // Update existing server with new config
                            await this.deleteConnection(name)
                            await this.connectToServer(name, result.data)
                            console.log(`Reconnected MCP server with updated config: ${name}`)
                        }
                    } catch (error) {
                        console.error(`Failed to connect to MCP server ${name}:`, error)
                        vscode.window.showErrorMessage(
                            `Failed to connect to MCP server ${name}: ${
                                error instanceof Error ? error.message : String(error)
                            }`
                        )
                    }
                })
            )
        } finally {
            await this.notifyWebviewOfServerChanges()
            this.isConnecting = false
        }
    }

    private async fetchTools(connection: McpConnection): Promise<void> {
        try {
            const response = await connection.client.request(
                { method: "tools/list" },
                ListToolsResultSchema
            ) as { tools: McpTool[] }
            if (connection.server.status === "connected") {
                connection.server.tools = response.tools || []
            }
        } catch (error) {
            console.error(`Failed to fetch tools:`, error)
            if (connection.server.status === "connected") {
                connection.server.error = error instanceof Error ? error.message : String(error)
            }
        }
    }

    private async fetchResources(connection: McpConnection): Promise<void> {
        try {
            const response = await connection.client.request(
                { method: "resources/list" },
                ListResourcesResultSchema
            ) as { resources: McpResource[] }
            if (connection.server.status === "connected") {
                connection.server.resources = response.resources || []
            }
        } catch (error) {
            console.error(`Failed to fetch resources:`, error)
            if (connection.server.status === "connected") {
                connection.server.error = error instanceof Error ? error.message : String(error)
            }
        }
    }

    private async fetchResourceTemplates(connection: McpConnection): Promise<void> {
        try {
            const response = await connection.client.request(
                { method: "resources/templates/list" },
                ListResourceTemplatesResultSchema
            ) as { resourceTemplates: McpResourceTemplate[] }
            if (connection.server.status === "connected") {
                connection.server.resourceTemplates = response.resourceTemplates || []
            }
        } catch (error) {
            console.error(`Failed to fetch resource templates:`, error)
            if (connection.server.status === "connected") {
                connection.server.error = error instanceof Error ? error.message : String(error)
            }
        }
    }

    private setupFileWatcher(name: string, config: StdioServerParameters): void {
        const filePath = config.args?.find((arg: string) => arg.includes("build/index.js"))
        if (filePath) {
            const watcher = chokidar.watch(filePath, {})

            watcher.on("change", () => {
                console.log(`Detected change in ${filePath}. Restarting server ${name}...`)
                this.restartConnection(name)
            })

            this.fileWatchers.set(name, watcher)
        }
    }

    private removeAllFileWatchers(): void {
        this.fileWatchers.forEach((watcher) => watcher.close())
        this.fileWatchers.clear()
    }

    public async restartConnection(serverName: string): Promise<void> {
        this.isConnecting = true
        const provider = this.providerRef.deref()
        if (!provider) {
            return
        }

        const connection = this.connections.find((conn) => conn.server.name === serverName)
        const config = connection?.server.config
        if (config) {
            vscode.window.showInformationMessage(`Restarting ${serverName} MCP server...`)
            connection.server.status = "connecting"
            connection.server.error = ""
            await this.notifyWebviewOfServerChanges()
            await delay(500)
            try {
                await this.deleteConnection(serverName)
                await this.connectToServer(serverName, JSON.parse(config))
                vscode.window.showInformationMessage(`${serverName} MCP server connected`)
            } catch (error) {
                console.error(`Failed to restart connection for ${serverName}:`, error)
                vscode.window.showErrorMessage(`Failed to connect to ${serverName} MCP server`)
            }
        }

        await this.notifyWebviewOfServerChanges()
        this.isConnecting = false
    }

    private async notifyWebviewOfServerChanges(): Promise<void> {
        const settingsPath = await this.getMcpSettingsFilePath()
        const content = await fs.readFile(settingsPath, "utf-8")
        const config = JSON.parse(content) as { mcpServers?: Record<string, unknown> }
        const serverOrder = Object.keys(config.mcpServers || {})
        await this.providerRef.deref()?.postMessageToWebview({
            type: "mcpServers",
            mcpServers: [...this.connections]
                .sort((a, b) => {
                    const indexA = serverOrder.indexOf(a.server.name)
                    const indexB = serverOrder.indexOf(b.server.name)
                    return indexA - indexB
                })
                .map((connection) => connection.server),
        })
    }

    async readResource(serverName: string, uri: string): Promise<McpResourceResponse> {
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        if (!connection) {
            throw new Error(`No connection found for server: ${serverName}`)
        }
        return await connection.client.request(
            {
                method: "resources/read",
                params: {
                    uri,
                },
            },
            ReadResourceResultSchema
        )
    }

    async callTool(
        serverName: string,
        toolName: string,
        toolArguments?: Record<string, unknown>
    ): Promise<McpToolCallResponse> {
        const connection = this.connections.find((conn) => conn.server.name === serverName)
        if (!connection) {
            throw new Error(
                `No connection found for server: ${serverName}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`
            )
        }
        return await connection.client.request(
            {
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: toolArguments,
                },
            },
            CallToolResultSchema
        )
    }

    async dispose(): Promise<void> {
        this.removeAllFileWatchers()
        for (const connection of this.connections) {
            try {
                await this.deleteConnection(connection.server.name)
            } catch (error) {
                console.error(`Failed to close connection for ${connection.server.name}:`, error)
            }
        }
        this.connections = []
        if (this.settingsWatcher) {
            this.settingsWatcher.dispose()
        }
        this.disposables.forEach((d) => d.dispose())
    }
}