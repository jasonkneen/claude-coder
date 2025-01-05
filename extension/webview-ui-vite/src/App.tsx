import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useAtom } from "jotai"
import { useCallback, useMemo, useState } from "react"
import { useEvent } from "react-use"
import { ExtensionMessage } from "../../src/shared/messages/extension-message"
import ChatView from "./components/chat-view/chat-view"
import OutOfCreditDialog from "./components/dialogs/out-of-credit-dialog"
import HistoryView from "./components/history-view/history-view"
import McpView from "./components/mcp/McpView"
import SettingsPage from "./components/settings-view/settings-tabs"
import { normalizeApiConfiguration } from "./components/settings-view/utils"
import { TooltipProvider } from "./components/ui/tooltip"
import {
    ExtensionStateProvider,
    showPromptEditorAtom,
    showSettingsAtom,
    useExtensionState,
} from "./context/extension-state-context"

const queryClient = new QueryClient()

const AppContent = () => {
	const { apiConfiguration, user, currentTaskId } = useExtensionState()
	const [showSettings, setShowSettings] = useAtom(showSettingsAtom)
	const [showHistory, setShowHistory] = useState(false)
	const [showPromptEditor, setShowPromptEditor] = useAtom(showPromptEditorAtom)
	const [showMcp, setShowMcp] = useState(false)

	const handleMessage = useCallback((e: MessageEvent) => {
		const message: ExtensionMessage = e.data
		switch (message.type) {
			case "state": {
				// don't update showAnnouncement to false if shouldShowAnnouncement is false
				break
			}
			case "action":
				switch (message.action!) {
					case "mcpButtonClicked":
						setShowSettings(false)
						setShowHistory(false)
						setShowPromptEditor(false)
						setShowMcp(true)
						break
					case "settingsButtonTapped":						
						setShowSettings(true)
						setShowHistory(false)
						setShowMcp(false)
						break
					case "historyButtonTapped":
						setShowSettings(false)
						setShowHistory(true)
						setShowMcp(false)
						break
					case "chatButtonTapped":
						setShowSettings(false)
						setShowHistory(false)
						setShowPromptEditor(false)
						setShowMcp(false)
						break
					case "promptEditorButtonTapped":
						setShowSettings(false)
						setShowHistory(false)
						setShowPromptEditor(true)
						setShowMcp(false)
						break
				}
				break
		}
		// (react-use takes care of not registering the same listener multiple times even if this callback is updated.)
	}, [])

	useEvent("message", handleMessage)

	const { selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	const handleMcpClick = useCallback(() => {
		setShowMcp(true)
	}, [])

	return (
		<>
			{showSettings && <SettingsPage />}
			{showHistory && <HistoryView onDone={() => setShowHistory(false)} />}
			{showMcp && <McpView onDone={() => setShowMcp(false)} />}
			<ChatView
				showHistoryView={() => {
					setShowSettings(false)
					setShowHistory(true)
				}}
				isHidden={showSettings || showHistory || showMcp}
				selectedModelSupportsImages={selectedModelInfo.supportsImages}
				selectedModelSupportsPromptCache={selectedModelInfo.supportsPromptCache}
			/>
		</>
	)
}

const App = () => {
	return (
		<>
			{/* <DevTools /> */}

			<ExtensionStateProvider>
				<QueryClientProvider client={queryClient}>
					<TooltipProvider>
						<AppContent />
					</TooltipProvider>
				</QueryClientProvider>
				<OutOfCreditDialog />
				{/* </Popover> */}
			</ExtensionStateProvider>
		</>
	)
}

export default App
