import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import vsDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus"
import DynamicTextArea from "react-textarea-autosize"
import { useEvent, useMeasure, useMount } from "react-use"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ClaudeAsk, ClaudeSayTool, ExtensionMessage } from "../../../src/shared/ExtensionMessage"
import { combineApiRequests } from "../../../src/shared/combineApiRequests"
import { combineCommandSequences, COMMAND_STDIN_STRING } from "../../../src/shared/combineCommandSequences"
import { getApiMetrics } from "../../../src/shared/getApiMetrics"
import { useExtensionState } from "../context/ExtensionStateContext"
import { getSyntaxHighlighterStyleFromTheme } from "../utils/getSyntaxHighlighterStyleFromTheme"
import { vscode } from "../utils/vscode"
import Announcement from "./Announcement"
import ChatRow from "./ChatRow"
import HistoryPreview from "./HistoryPreview"
import TaskHeader from "./TaskHeader"
import Thumbnails from "./Thumbnails"
import KoduPromo from "./KoduPromo"
import AbortAutomode from "./AbortAutomode"

interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	selectedModelSupportsImages: boolean
	selectedModelSupportsPromptCache: boolean
	hideAnnouncement: () => void
	showHistoryView: () => void
}

const MAX_IMAGES_PER_MESSAGE = 20 // Anthropic limits to 20 images

const ChatView = ({
	isHidden,
	showAnnouncement,
	selectedModelSupportsImages,
	selectedModelSupportsPromptCache,
	hideAnnouncement,
	showHistoryView,
}: ChatViewProps) => {
	const {
		version,
		claudeMessages: messages,
		taskHistory,
		themeName: vscodeThemeName,
		alwaysAllowWriteOnly,
		uriScheme,
		shouldShowKoduPromo,
		user,
	} = useExtensionState()

	//const task = messages.length > 0 ? (messages[0].say === "task" ? messages[0] : undefined) : undefined) : undefined
	const task = messages.length > 0 ? messages[0] : undefined // leaving this less safe version here since if the first message is not a task, then the extension is in a bad state and needs to be debugged (see ClaudeDev.abort)
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	// has to be after api_req_finished are all reduced into api_req_started messages
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [textAreaDisabled, setTextAreaDisabled] = useState(false)
	const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
	const [textAreaContainerRef, { height: textAreaContainerHeight }] = useMeasure<HTMLDivElement>()
	const [selectedImages, setSelectedImages] = useState<string[]>([])
	const [thumbnailsHeight, setThumbnailsHeight] = useState(0)

	// we need to hold on to the ask because useEffect > lastMessage will always let us know when an ask comes in and handle it, but by the time handleMessage is called, the last message might not be the ask anymore (it could be a say that followed)
	const [claudeAsk, setClaudeAsk] = useState<ClaudeAsk | undefined>(undefined)
	const [isAbortingRequest, setIsAbortingRequest] = useState(false)

	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [syntaxHighlighterStyle, setSyntaxHighlighterStyle] = useState(vsDarkPlus)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

	const toggleRowExpansion = (ts: number) => {
		setExpandedRows((prev) => ({
			...prev,
			[ts]: !prev[ts],
		}))
	}
	const handleSendStdin = (text: string) => {
		if (claudeAsk === "command_output") {
			vscode.postMessage({
				type: "askResponse",
				askResponse: "messageResponse",
				text: COMMAND_STDIN_STRING + text,
			})
			setClaudeAsk(undefined)
			// don't need to disable since extension relinquishes control back immediately
			// setTextAreaDisabled(true)
			// setEnableButtons(false)
		}
	}
	useEffect(() => {
		if (!vscodeThemeName) return
		const theme = getSyntaxHighlighterStyleFromTheme(vscodeThemeName)
		if (theme) {
			setSyntaxHighlighterStyle(theme)
		}
	}, [vscodeThemeName])

	useEffect(() => {
		// if last message is an ask, show user ask UI

		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted

		const lastMessage = messages.at(-1)
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					switch (lastMessage.ask) {
						case "request_limit_reached":
							setTextAreaDisabled(true)
							setClaudeAsk("request_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText("Proceed")
							setSecondaryButtonText("Start New Task")
							break
						case "api_req_failed":
							setTextAreaDisabled(true)
							setClaudeAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText("Retry")
							setSecondaryButtonText("Start New Task")
							break
						case "followup":
							setTextAreaDisabled(false)
							setClaudeAsk("followup")
							setEnableButtons(false)
							// setPrimaryButtonText(undefined)
							// setSecondaryButtonText(undefined)
							break
						case "tool":
							setTextAreaDisabled(false)
							setClaudeAsk("tool")
							setEnableButtons(true)
							const tool = JSON.parse(lastMessage.text || "{}") as ClaudeSayTool
							switch (tool.tool) {
								case "editedExistingFile":
									setPrimaryButtonText("Save")
									setSecondaryButtonText("Reject")
									break
								case "newFileCreated":
									setPrimaryButtonText("Create")
									setSecondaryButtonText("Reject")
									break
								default:
									setPrimaryButtonText("Approve")
									setSecondaryButtonText("Reject")
									break
							}
							break
						case "command":
							setTextAreaDisabled(false)
							setClaudeAsk("command")
							setEnableButtons(true)
							setPrimaryButtonText("Run Command")
							setSecondaryButtonText("Reject")
							break
						case "command_output":
							setTextAreaDisabled(false)
							setClaudeAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText("Exit Command")
							setSecondaryButtonText(undefined)
							break
						case "completion_result":
							// extension waiting for feedback. but we can just present a new task button
							setTextAreaDisabled(false)
							setClaudeAsk("completion_result")
							setEnableButtons(true)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setTextAreaDisabled(false)
							setClaudeAsk("resume_task")
							setEnableButtons(true)
							setPrimaryButtonText("Resume Task")
							setSecondaryButtonText(undefined)
							break
						case "resume_completed_task":
							setTextAreaDisabled(false)
							setClaudeAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText("Start New Task")
							setSecondaryButtonText(undefined)
							break
					}
					break
				case "say":
					// don't want to reset since there could be a "say" after an "ask" while ask is waiting for response
					switch (lastMessage.say) {
						case "abort_automode":
							setTextAreaDisabled(false)
							setClaudeAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "api_req_started":
							if (messages.at(-2)?.ask === "command_output") {
								// if the last ask is a command_output, and we receive an api_req_started, then that means the command has finished and we don't need input from the user anymore (in every other case, the user has to interact with input field or buttons to continue, which does the following automatically)
								setInputValue("")
								setTextAreaDisabled(true)
								setSelectedImages([])
								setClaudeAsk(undefined)
								setEnableButtons(false)
							}
							break
						case "error":
							setIsAbortingRequest(false)
							setTextAreaDisabled(false)
							setClaudeAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "task":
						case "api_req_finished":
						case "text":
						case "command_output":
						case "completion_result":
						case "tool":
							break
					}
					break
			}
		} else {
			// this would get called after sending the first message, so we have to watch messages.length instead
			// No messages, so user has to submit a task
			// setTextAreaDisabled(false)
			// setClaudeAsk(undefined)
			// setPrimaryButtonText(undefined)
			// setSecondaryButtonText(undefined)
		}
	}, [messages])

	useEffect(() => {
		if (messages.length === 0) {
			setTextAreaDisabled(false)
			setClaudeAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	const handleSendMessage = () => {
		console.log(`Sending message: ${inputValue}`)
		const text = inputValue.trim()
		console.log(`Sending message: ${text}`)
		console.log(`Selected images: ${selectedImages}`)
		console.log(`Claude ask: ${JSON.stringify(claudeAsk)}`)

		if (text || selectedImages.length > 0) {
			if (messages.length === 0) {
				vscode.postMessage({ type: "newTask", text, images: selectedImages })
			} else if (claudeAsk) {
				switch (claudeAsk) {
					case "followup":
					case "tool":
					case "command": // user can provide feedback to a tool or command use
					case "command_output": // user can send input to command stdin
					case "completion_result": // if this happens then the user has feedback for the completion result
					case "resume_task":
					case "api_req_failed":
					case "resume_completed_task":
						console.log(`Sending askResponse: messageResponse`)
						vscode.postMessage({
							type: "askResponse",
							askResponse: "messageResponse",
							text,
							images: selectedImages,
						})
						break
					// there is no other case that a textfield should be enabled
				}
			} else if (!claudeAsk) {
				// if there is no ask, then the user is sending a message to Claude
				vscode.postMessage({
					type: "askResponse",
					askResponse: "messageResponse",
					text,
					images: selectedImages,
				})
			}
			setInputValue("")
			setTextAreaDisabled(true)
			setSelectedImages([])
			setClaudeAsk(undefined)
			setEnableButtons(false)
			// setPrimaryButtonText(undefined)
			// setSecondaryButtonText(undefined)
		}
	}

	/*
	This logic depends on the useEffect[messages] above to set claudeAsk, after which buttons are shown and we then send an askResponse to the extension.
	*/
	const handlePrimaryButtonClick = () => {
		switch (claudeAsk) {
			case "api_req_failed":
			case "request_limit_reached":
			case "command":
			case "command_output":
			case "tool":
			case "resume_task":
				vscode.postMessage({ type: "askResponse", askResponse: "yesButtonTapped" })
				break
			case "completion_result":
			case "resume_completed_task":
				// extension waiting for feedback. but we can just present a new task button
				startNewTask()
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}

	const handleSecondaryButtonClick = () => {
		switch (claudeAsk) {
			case "request_limit_reached":
			case "api_req_failed":
				startNewTask()
				break
			case "command":
			case "tool":
				// responds to the API with a "This operation failed" and lets it try again
				vscode.postMessage({ type: "askResponse", askResponse: "noButtonTapped" })
				break
		}
		setTextAreaDisabled(true)
		setClaudeAsk(undefined)
		setEnableButtons(false)
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		const isComposing = event.nativeEvent?.isComposing ?? false
		if (event.key === "Enter" && !event.shiftKey && !isComposing) {
			event.preventDefault()
			handleSendMessage()
		}
	}

	const handleTaskCloseButtonClick = () => {
		startNewTask()
	}

	const startNewTask = () => {
		vscode.postMessage({ type: "clearTask" })
	}

	const selectImages = () => {
		vscode.postMessage({ type: "selectImages" })
	}

	const handlePaste = async (e: React.ClipboardEvent) => {
		const items = e.clipboardData.items
		const acceptedTypes = ["png", "jpeg", "webp"] // supported by anthropic and openrouter (jpg is just a file extension but the image will be recognized as jpeg)
		const imageItems = Array.from(items).filter((item) => {
			const [type, subtype] = item.type.split("/")
			return type === "image" && acceptedTypes.includes(subtype)
		})
		if (!shouldDisableImages && imageItems.length > 0) {
			e.preventDefault()
			const imagePromises = imageItems.map((item) => {
				return new Promise<string | null>((resolve) => {
					const blob = item.getAsFile()
					if (!blob) {
						resolve(null)
						return
					}
					const reader = new FileReader()
					reader.onloadend = () => {
						if (reader.error) {
							console.error("Error reading file:", reader.error)
							resolve(null)
						} else {
							const result = reader.result
							resolve(typeof result === "string" ? result : null)
						}
					}
					reader.readAsDataURL(blob)
				})
			})
			const imageDataArray = await Promise.all(imagePromises)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)
			//.map((dataUrl) => dataUrl.split(",")[1]) // strip the mime type prefix, sharp doesn't need it
			if (dataUrls.length > 0) {
				setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
			} else {
				console.warn("No valid images were processed")
			}
		}
	}

	useEffect(() => {
		if (selectedImages.length === 0) {
			setThumbnailsHeight(0)
		}
	}, [selectedImages])

	const handleThumbnailsHeightChange = useCallback((height: number) => {
		setThumbnailsHeight(height)
	}, [])

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data
			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !textAreaDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
					}
					break
				case "selectedImages":
					const newImages = message.images ?? []
					if (newImages.length > 0) {
						setSelectedImages((prevImages) =>
							[...prevImages, ...newImages].slice(0, MAX_IMAGES_PER_MESSAGE)
						)
					}
					break
			}
			// textAreaRef.current is not explicitly required here since react gaurantees that ref will be stable across re-renders, and we're not using its value but its reference.
		},
		[isHidden, textAreaDisabled, enableButtons]
	)

	useEvent("message", handleMessage)

	useMount(() => {
		// NOTE: the vscode window needs to be focused for this to work
		textAreaRef.current?.focus()
	})

	useEffect(() => {
		const timer = setTimeout(() => {
			if (!isHidden && !textAreaDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		}, 50)
		return () => {
			clearTimeout(timer)
		}
	}, [isHidden, textAreaDisabled, enableButtons])

	const visibleMessages = useMemo(() => {
		return modifiedMessages.filter((message) => {
			switch (message.ask) {
				case "completion_result":
					// don't show a chat row for a completion_result ask without text. This specific type of message only occurs if Claude wants to execute a command as part of its completion result, in which case we interject the completion_result tool with the execute_command tool.
					if (message.text === "") {
						return false
					}
					break
				case "api_req_failed": // this message is used to update the latest api_req_started that the request failed
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished": // combineApiRequests removes this from modifiedMessages anyways
				case "api_req_retried": // this message is used to update the latest api_req_started that the request was retried
					return false
				case "text":
					// Sometimes Claude returns an empty text message, we don't want to render these. (We also use a say text for user messages, so in case they just sent images we still render that)
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
						return false
					}
					break
			}
			return true
		})
	}, [modifiedMessages])

	useEffect(() => {
		// We use a setTimeout to ensure new content is rendered before scrolling to the bottom. virtuoso's followOutput would scroll to the bottom before the new content could render.
		const timer = setTimeout(() => {
			// TODO: we can use virtuoso's isAtBottom to prevent scrolling if user is scrolled up, and show a 'scroll to bottom' button for better UX
			// NOTE: scroll to bottom may not work if you use margin, see virtuoso's troubleshooting
			virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" })
		}, 50)

		return () => clearTimeout(timer)
	}, [visibleMessages])

	const placeholderText = useMemo(() => {
		const text = task ? "Type a message..." : "Type your task here..."
		return text
	}, [task])

	const isCompletionResult = useMemo(() => {
		return messages.at(-1)?.ask === "completion_result" || messages.at(-1)?.say === "completion_result"
	}, [messages])

	const isRequestRunning = useMemo(() => {
		return messages.at(-1)?.say === "api_req_started" || messages.at(-1)?.say === "api_req_retried"
	}, [messages])

	const showAbortAutomode = useMemo(() => {
		if (!alwaysAllowWriteOnly) return false
		const lastMessage = messages.at(-1)
		const isAbortCompleted = lastMessage?.say === "abort_automode"
		const isCompleted =
			lastMessage?.say === "completion_result" ||
			lastMessage?.ask === "resume_completed_task" ||
			lastMessage?.ask === "resume_task"
		const isLastMessageApiRequest = lastMessage?.say === "api_req_started" || lastMessage?.say === "api_req_retried"
		const isLastMessageCommand = lastMessage?.ask === "command_output" || lastMessage?.ask === "command"
		const isLastMessageTool = lastMessage?.ask === "tool"
		if (isCompleted || isAbortCompleted) return false
		return isLastMessageApiRequest || isLastMessageCommand || isLastMessageTool
	}, [alwaysAllowWriteOnly, messages])

	const shouldDisableImages =
		!selectedModelSupportsImages || textAreaDisabled || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: isHidden ? "none" : "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}>
			{task ? (
				<TaskHeader
					task={task}
					tokensIn={apiMetrics.totalTokensIn}
					tokensOut={apiMetrics.totalTokensOut}
					doesModelSupportPromptCache={selectedModelSupportsPromptCache}
					cacheWrites={apiMetrics.totalCacheWrites}
					cacheReads={apiMetrics.totalCacheReads}
					totalCost={apiMetrics.totalCost}
					onClose={handleTaskCloseButtonClick}
					isHidden={isHidden}
					koduCredits={user?.credits ?? 0}
					vscodeUriScheme={uriScheme}
				/>
			) : (
				<>
					{showAnnouncement && (
						<Announcement
							version={version}
							hideAnnouncement={hideAnnouncement}
							vscodeUriScheme={uriScheme}
						/>
					)}
					{!showAnnouncement && shouldShowKoduPromo && (
						<KoduPromo style={{ margin: "10px 15px -10px 15px" }} />
					)}
					<div style={{ padding: "0 20px", flexGrow: taskHistory.length > 0 ? undefined : 1 }}>
						<h2>What can I do for you?</h2>
						<p>
							Thanks to{" "}
							<VSCodeLink
								href="https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf"
								style={{ display: "inline" }}>
								Claude 3.5 Sonnet's agentic coding capabilities,
							</VSCodeLink>{" "}
							I can handle complex software development tasks step-by-step. With tools that let me create
							& edit files, explore complex projects, and execute terminal commands (after you grant
							permission), I can assist you in ways that go beyond simple code completion or tech support.
						</p>
					</div>
					{taskHistory.length > 0 && <HistoryPreview showHistoryView={showHistoryView} />}
				</>
			)}
			{task && (
				<>
					<Virtuoso
						ref={virtuosoRef}
						className="scrollable"
						style={{
							flexGrow: 1,
							overflowY: "scroll",
						}}
						increaseViewportBy={{ top: 0, bottom: Number.MAX_SAFE_INTEGER }}
						data={visibleMessages}
						itemContent={(index, message) => (
							<ChatRow
								key={message.ts}
								handleSendStdin={handleSendStdin}
								message={message}
								syntaxHighlighterStyle={syntaxHighlighterStyle}
								isExpanded={expandedRows[message.ts] || false}
								onToggleExpand={() => toggleRowExpansion(message.ts)}
								lastModifiedMessage={modifiedMessages.at(-1)}
								isLast={index === visibleMessages.length - 1}
							/>
						)}
					/>
					{isRequestRunning && (
						<VSCodeButton
							disabled={isAbortingRequest}
							onClick={() => {
								setIsAbortingRequest(true)
								vscode.postMessage({ type: "cancelCurrentRequest" })
							}}>
							{isAbortingRequest ? "Aborting..." : "Abort Request"}
						</VSCodeButton>
					)}
					{alwaysAllowWriteOnly && <AbortAutomode isVisible={!!showAbortAutomode} />}
					{!alwaysAllowWriteOnly && (
						<div
							style={{
								opacity:
									!alwaysAllowWriteOnly && (primaryButtonText || secondaryButtonText)
										? enableButtons
											? 1
											: 0.5
										: 0,
								display: "flex",
								padding: "10px 15px 0px 15px",
							}}>
							{primaryButtonText && (
								<VSCodeButton
									appearance="primary"
									disabled={!enableButtons}
									style={{
										flex: secondaryButtonText ? 1 : 2,
										marginRight: secondaryButtonText ? "6px" : "0",
									}}
									onClick={handlePrimaryButtonClick}>
									{primaryButtonText}
								</VSCodeButton>
							)}
							{secondaryButtonText && (
								<VSCodeButton
									appearance="secondary"
									disabled={!enableButtons}
									style={{ flex: 1, marginLeft: "6px" }}
									onClick={handleSecondaryButtonClick}>
									{secondaryButtonText}
								</VSCodeButton>
							)}
						</div>
					)}
				</>
			)}

			<div
				style={{
					padding: "10px 15px",
					opacity: textAreaDisabled ? 0.5 : 1,
					position: "relative",
					display: "flex",
				}}>
				{!isTextAreaFocused && (
					<div
						style={{
							position: "absolute",
							inset: "10px 15px",
							border: "1px solid var(--vscode-input-border)",
							borderRadius: 2,
							pointerEvents: "none",
						}}
					/>
				)}
				<DynamicTextArea
					ref={textAreaRef}
					value={inputValue}
					disabled={textAreaDisabled}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onFocus={() => setIsTextAreaFocused(true)}
					onBlur={() => setIsTextAreaFocused(false)}
					onPaste={handlePaste}
					onHeightChange={() =>
						virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "auto" })
					}
					placeholder={placeholderText}
					maxRows={10}
					autoFocus={true}
					style={{
						width: "100%",
						boxSizing: "border-box",
						backgroundColor: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						borderRadius: 2,
						fontFamily: "var(--vscode-font-family)",
						fontSize: "var(--vscode-editor-font-size)",
						lineHeight: "var(--vscode-editor-line-height)",
						resize: "none",
						overflow: "hidden",
						borderTop: "9px solid transparent",
						borderBottom: `${thumbnailsHeight + 9}px solid transparent`,
						borderRight: "54px solid transparent",
						borderLeft: "9px solid transparent",
						padding: 0,
						cursor: textAreaDisabled ? "not-allowed" : undefined,
						flex: 1,
					}}
				/>
				{selectedImages.length > 0 && (
					<Thumbnails
						images={selectedImages}
						setImages={setSelectedImages}
						onHeightChange={handleThumbnailsHeightChange}
						style={{
							position: "absolute",
							paddingTop: 4,
							bottom: 14,
							left: 22,
							right: 67,
						}}
					/>
				)}
				<div
					style={{
						position: "absolute",
						right: 20,
						bottom: 14.5,
						display: "flex",
						alignItems: "flex-end",
						height: "calc(100% - 20px)",
					}}>
					<VSCodeButton
						disabled={shouldDisableImages}
						appearance="icon"
						aria-label="Attach Images"
						onClick={selectImages}
						style={{ marginRight: "2px" }}>
						<span
							className="codicon codicon-device-camera"
							style={{ fontSize: 18.5, marginLeft: -2, marginBottom: 0.5 }}></span>
					</VSCodeButton>
					<VSCodeButton
						disabled={textAreaDisabled}
						appearance="icon"
						aria-label="Send Message"
						onClick={handleSendMessage}>
						<span className="codicon codicon-send" style={{ fontSize: 16.5, marginTop: 2 }}></span>
					</VSCodeButton>
				</div>
			</div>
		</div>
	)
}

export default ChatView
