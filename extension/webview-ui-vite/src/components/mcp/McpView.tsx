import { VSCodeButton, VSCodeLink, VSCodePanels, VSCodePanelTab, VSCodePanelView } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import { useExtensionState } from "../../context/extension-state-context"
import { McpServer, McpTool } from "../../types/mcp"
import { vscode } from "../../utils/vscode"
import styles from "./McpView.module.css"

type McpViewProps = {
    onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
    const { mcpServers: servers } = useExtensionState()

    const handleOpenSettings = useCallback(() => {
        vscode.postMessage({ 
            type: "openMcpConfigFile"
        })
    }, [])

    return (
        <div className={styles.mcpContainer}>
            <div className={styles.header}>
                <h3 className={styles.title}>MCP Servers</h3>
                <VSCodeButton onClick={onDone}>Done</VSCodeButton>
            </div>

            <div className={styles.content}>
                <div className={styles.description}>
                    The{" "}
                    <VSCodeLink href="https://github.com/modelcontextprotocol" style={{ display: "inline" }}>
                        Model Context Protocol
                    </VSCodeLink>{" "}
                    enables communication with locally running MCP servers that provide additional tools and resources
                    to extend capabilities.
                </div>

                {/* Server List */}
                {servers?.length > 0 && (
                    <div className={styles.serverList}>
                        {servers.map((server: McpServer) => (
                            <ServerRow key={server.name} server={server} />
                        ))}
                    </div>
                )}

                {/* Edit Settings Button */}
                <div className={styles.settingsButton}>
                    <VSCodeButton
                        appearance="secondary"
                        style={{ width: "100%" }}
                        onClick={handleOpenSettings}>
                        <span className="codicon codicon-edit" style={{ marginRight: "6px" }}></span>
                        Edit MCP Settings
                    </VSCodeButton>
                </div>

                {/* Bottom padding */}
                <div className={styles.bottomPadding} />
            </div>
        </div>
    )
}

// Server Row Component
const ServerRow = ({ server }: { server: McpServer }) => {
    const [isExpanded, setIsExpanded] = useState(false)

    const getStatusColor = () => {
        switch (server.status) {
            case "connected":
                return "var(--vscode-testing-iconPassed)"
            case "connecting":
                return "var(--vscode-charts-yellow)"
            case "disconnected":
                return "var(--vscode-testing-iconFailed)"
        }
    }

    const handleRowClick = () => {
        if (!server.error) {
            setIsExpanded(!isExpanded)
        }
    }

    const handleRestart = () => {
        vscode.postMessage({
            type: "openExternalLink",
            url: `command:kodu-claude-coder-main.restartMcpServer?${encodeURIComponent(JSON.stringify([server.name]))}`
        })
    }

    return (
        <div style={{ marginBottom: "10px" }}>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "8px",
                    background: "var(--vscode-textCodeBlock-background)",
                    cursor: server.error ? "default" : "pointer",
                    borderRadius: isExpanded || server.error ? "4px 4px 0 0" : "4px",
                }}
                onClick={handleRowClick}>
                {!server.error && (
                    <span
                        className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
                        style={{ marginRight: "8px" }}
                    />
                )}
                <span style={{ flex: 1 }}>{server.name}</span>
                <div
                    style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        background: getStatusColor(),
                        marginLeft: "8px",
                    }}
                />
            </div>

            {server.error ? (
                <div
                    style={{
                        fontSize: "13px",
                        background: "var(--vscode-textCodeBlock-background)",
                        borderRadius: "0 0 4px 4px",
                        width: "100%",
                    }}>
                    <div
                        style={{
                            color: "var(--vscode-testing-iconFailed)",
                            marginBottom: "8px",
                            padding: "0 10px",
                            overflowWrap: "break-word",
                            wordBreak: "break-word",
                        }}>
                        {server.error}
                    </div>
                    <VSCodeButton
                        appearance="secondary"
                        onClick={handleRestart}
                        disabled={server.status === "connecting"}
                        style={{ width: "calc(100% - 20px)", margin: "0 10px 10px 10px" }}>
                        {server.status === "connecting" ? "Retrying..." : "Retry Connection"}
                    </VSCodeButton>
                </div>
            ) : (
                isExpanded && (
                    <div
                        style={{
                            background: "var(--vscode-textCodeBlock-background)",
                            padding: "0 10px 10px 10px",
                            fontSize: "13px",
                            borderRadius: "0 0 4px 4px",
                        }}>
                        <VSCodePanels>
                            <VSCodePanelTab id="tools">Tools ({server.tools?.length || 0})</VSCodePanelTab>
                            <VSCodePanelTab id="resources">
                                Resources (
                                {[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
                            </VSCodePanelTab>

                            <VSCodePanelView id="tools-view">
                                {server.tools && server.tools.length > 0 ? (
                                    <div
                                        style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                                        {server.tools.map((tool: McpTool) => (
                                            <div key={tool.name}>
                                                <div style={{ fontWeight: "bold" }}>{tool.name}</div>
                                                {tool.description && (
                                                    <div style={{ color: "var(--vscode-descriptionForeground)" }}>
                                                        {tool.description}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ padding: "10px 0", color: "var(--vscode-descriptionForeground)" }}>
                                        No tools found
                                    </div>
                                )}
                            </VSCodePanelView>

                            <VSCodePanelView id="resources-view">
                                {(server.resources && server.resources.length > 0) ||
                                (server.resourceTemplates && server.resourceTemplates.length > 0) ? (
                                    <div
                                        style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                                        {[...(server.resourceTemplates || []), ...(server.resources || [])].map(
                                            (item) => (
                                                <div key={"uriTemplate" in item ? item.uriTemplate : item.uri}>
                                                    <div style={{ fontWeight: "bold" }}>
                                                        {"uriTemplate" in item ? item.uriTemplate : item.uri}
                                                    </div>
                                                    {item.description && (
                                                        <div style={{ color: "var(--vscode-descriptionForeground)" }}>
                                                            {item.description}
                                                        </div>
                                                    )}
                                                </div>
                                            ),
                                        )}
                                    </div>
                                ) : (
                                    <div style={{ padding: "10px 0", color: "var(--vscode-descriptionForeground)" }}>
                                        No resources found
                                    </div>
                                )}
                            </VSCodePanelView>
                        </VSCodePanels>

                        <VSCodeButton
                            appearance="secondary"
                            onClick={handleRestart}
                            disabled={server.status === "connecting"}
                            style={{ width: "calc(100% - 14px)", margin: "0 7px 3px 7px" }}>
                            {server.status === "connecting" ? "Restarting..." : "Restart Server"}
                        </VSCodeButton>
                    </div>
                )
            )}
        </div>
    )
}

export default McpView