import React, { createContext, useContext, useState } from "react"
import { McpServer } from "../../../src/shared/mcp"

type ExtensionState = {
    mcpServers: McpServer[]
}

const ExtensionStateContext = createContext<ExtensionState>({
    mcpServers: [],
})

export const useExtensionState = () => useContext(ExtensionStateContext)

export const ExtensionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [mcpServers, setMcpServers] = useState<McpServer[]>([])

    React.useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data
            switch (message.type) {
                case "mcpServers": {
                    setMcpServers(message.mcpServers ?? [])
                    break
                }
            }
        }

        window.addEventListener("message", handleMessage)
        return () => window.removeEventListener("message", handleMessage)
    }, [])

    return (
        <ExtensionStateContext.Provider
            value={{
                mcpServers,
            }}>
            {children}
        </ExtensionStateContext.Provider>
    )
}