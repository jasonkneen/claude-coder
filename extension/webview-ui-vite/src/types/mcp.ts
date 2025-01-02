export interface McpTool {
    name: string
    description?: string
}

export interface McpResource {
    uri: string
    description?: string
}

export interface McpResourceTemplate {
    uriTemplate: string
    description?: string
}

export interface McpServer {
    name: string
    status: "connected" | "connecting" | "disconnected"
    error?: string
    tools?: McpTool[]
    resources?: McpResource[]
    resourceTemplates?: McpResourceTemplate[]
}