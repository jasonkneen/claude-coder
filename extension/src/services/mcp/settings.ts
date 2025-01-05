import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"
import { fileExistsAtPath } from "../../utils/fs"

export const StdioConfigSchema = z.object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
})

export const McpSettingsSchema = z.object({
    mcpServers: z.record(StdioConfigSchema),
})

export type McpSettings = z.infer<typeof McpSettingsSchema>

export async function getMcpSettingsPath(settingsDir: string): Promise<string> {
    try {
        await fs.mkdir(settingsDir, { recursive: true })
    } catch (error) {
        console.error("Failed to create settings directory:", error)
        throw error
    }
    return path.join(settingsDir, "mcp-settings.json")
}

export async function loadMcpSettings(settingsPath: string): Promise<McpSettings> {
    try {
        if (await fileExistsAtPath(settingsPath)) {
            const content = await fs.readFile(settingsPath, "utf-8")
            const config = JSON.parse(content)
            const result = McpSettingsSchema.safeParse(config)
            if (!result.success) {
                vscode.window.showErrorMessage("Invalid MCP settings format")
                return { mcpServers: {} }
            }
            return result.data
        }
    } catch (error) {
        console.error("Failed to load MCP settings:", error)
        vscode.window.showErrorMessage("Failed to load MCP settings")
    }
    return { mcpServers: {} }
}

export async function saveMcpSettings(settingsPath: string, settings: McpSettings): Promise<void> {
    try {
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    } catch (error) {
        console.error("Failed to save MCP settings:", error)
        vscode.window.showErrorMessage("Failed to save MCP settings")
        throw error
    }
}

export async function ensureMcpSettingsFile(settingsPath: string): Promise<void> {
    try {
        const fileExists = await fileExistsAtPath(settingsPath)
        if (!fileExists) {
            await fs.writeFile(
                settingsPath,
                JSON.stringify(
                    {
                        mcpServers: {},
                    },
                    null,
                    2
                )
            )
        }
    } catch (error) {
        console.error("Failed to create MCP settings file:", error)
        vscode.window.showErrorMessage("Failed to create MCP settings file")
        throw error
    }
}

export async function discoverMcpServers(mcpServersDir: string): Promise<Record<string, unknown>> {
    try {
        const entries = await fs.readdir(mcpServersDir, { withFileTypes: true })
        const servers: Record<string, unknown> = {}

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const serverPath = path.join(mcpServersDir, entry.name)
                const configPath = path.join(serverPath, "config.json")

                if (await fileExistsAtPath(configPath)) {
                    try {
                        const content = await fs.readFile(configPath, "utf-8")
                        const config = JSON.parse(content)
                        if (StdioConfigSchema.safeParse(config).success) {
                            servers[entry.name] = config
                        }
                    } catch (error) {
                        console.error(`Failed to load config for server ${entry.name}:`, error)
                    }
                }
            }
        }

        return servers
    } catch (error) {
        console.error("Failed to discover MCP servers:", error)
        vscode.window.showErrorMessage("Failed to discover MCP servers")
        return {}
    }
}