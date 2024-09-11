import React, { useMemo, useState } from "react"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Virtuoso } from "react-virtuoso"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import HistoryItem from "./HistoryItem"

interface HistoryViewProps {
	onDone: () => void
}

const HistoryView: React.FC<HistoryViewProps> = ({ onDone }) => {
	const { taskHistory } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")

	const handleHistorySelect = (id: string) => {
		vscode.postMessage({ type: "showTaskWithId", text: id })
	}

	const handleDeleteHistoryItem = (id: string) => {
		vscode.postMessage({ type: "deleteTaskWithId", text: id })
	}

	const handleExportMd = (id: string) => {
		vscode.postMessage({ type: "exportTaskWithId", text: id })
	}

	const presentableTasks = useMemo(() => {
		return taskHistory.filter((item) => item.ts && item.task)
	}, [taskHistory])

	const taskHistorySearchResults = useMemo(() => {
		return presentableTasks.filter((item) => item.task.toLowerCase().includes(searchQuery.toLowerCase()))
	}, [presentableTasks, searchQuery])

	return (
		<>
			<style>
				{`
          .history-item:hover {
            background-color: var(--vscode-list-hoverBackground);
          }
          .delete-button {
            opacity: 0;
            pointer-events: none;
          }
          .history-item:hover .delete-button {
            opacity: 1;
            pointer-events: auto;
          }
        `}
			</style>
			<div
				className="text-start"
				style={{
					position: "fixed",
					top: 0,
					left: 0,
					right: 0,
					bottom: 0,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}>
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "10px 17px 10px 20px",
					}}>
					<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>History</h3>
					<VSCodeButton onClick={onDone}>Done</VSCodeButton>
				</div>
				<div style={{ padding: "5px 17px" }}>
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder="Search history..."
						value={searchQuery}
						onInput={(e) => setSearchQuery((e.target as HTMLInputElement)?.value)}>
						<div
							slot="start"
							className="codicon codicon-search"
							style={{ fontSize: 13, marginTop: 2.5, opacity: 0.8 }}></div>
						{searchQuery && (
							<VSCodeButton
								appearance="icon"
								aria-label="Clear search"
								onClick={() => setSearchQuery("")}
								slot="end">
								<span className="codicon codicon-close"></span>
							</VSCodeButton>
						)}
					</VSCodeTextField>
				</div>
				<div style={{ flexGrow: 1, overflowY: "auto", margin: 0 }}>
					{presentableTasks.length === 0 && (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
								alignItems: "center",
								height: "100%",
								fontStyle: "italic",
								color: "var(--vscode-descriptionForeground)",
								textAlign: "center",
								padding: "0px 10px",
							}}>
							<span
								className="codicon codicon-archive"
								style={{ fontSize: "50px", marginBottom: "15px" }}></span>
							<div>
								No history found,
								<br />
								start a new task to see it here...
							</div>
						</div>
					)}
					<Virtuoso
						style={{
							flexGrow: 1,
							overflowY: "scroll",
							scrollbarWidth: "none",
						}}
						data={taskHistorySearchResults}
						itemContent={(index, item) => (
							<HistoryItem
								item={item}
								index={index}
								totalItems={taskHistorySearchResults.length}
								searchQuery={searchQuery}
								onSelect={handleHistorySelect}
								onDelete={handleDeleteHistoryItem}
								onExport={handleExportMd}
							/>
						)}
					/>
				</div>
			</div>
		</>
	)
}

export default HistoryView