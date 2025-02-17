import { ApiManager } from "../../../api/api-handler";
import { ExtensionProvider } from "../../../providers/extension-provider";
import { KoduAgentState, MainAgentOptions, FileVersion } from "../types";
import { ApiHistoryManager } from "./api-history-manager";
import { ClaudeMessagesManager } from "./claude-messages-manager";
import { IOManager } from "./io-manager";
import { SubAgentManager } from "./sub-agent-manager";
export declare class StateManager {
    private _state;
    private _apiManager;
    private _providerRef;
    private _alwaysAllowReadOnly;
    private _customInstructions?;
    private _alwaysAllowWriteOnly;
    private _terminalCompressionThreshold?;
    private _autoCloseTerminal?;
    private _skipWriteAnimation?;
    private _autoSummarize?;
    private _temporayPauseAutomaticMode;
    private _inlineEditOutputType?;
    private _gitHandlerEnabled;
    private _ioManager;
    private _subAgentManager;
    claudeMessagesManager: ClaudeMessagesManager;
    apiHistoryManager: ApiHistoryManager;
    constructor(options: MainAgentOptions, apiManager: ApiManager);
    get state(): KoduAgentState;
    get ioManager(): IOManager;
    get subAgentManager(): SubAgentManager;
    get autoCloseTerminal(): boolean | undefined;
    get customInstructions(): string | undefined;
    get taskId(): string;
    get temporayPauseAutomaticMode(): boolean;
    get apiManager(): ApiManager;
    get terminalCompressionThreshold(): number | undefined;
    set terminalCompressionThreshold(newValue: number | undefined);
    get autoSummarize(): boolean | undefined;
    get providerRef(): WeakRef<ExtensionProvider>;
    get alwaysAllowReadOnly(): boolean;
    get alwaysAllowWriteOnly(): boolean;
    get inlineEditOutputType(): "full" | "diff" | undefined;
    get skipWriteAnimation(): boolean | undefined;
    get gitHandlerEnabled(): boolean;
    /**
     * Instead of replacing _state entirely, we merge properties into the existing
     * _state object to keep all references stable.
     */
    setState(newState: KoduAgentState): void;
    setSkipWriteAnimation(newValue: boolean | undefined): void;
    setGitHandlerEnabled(newValue: boolean): void;
    get historyErrors(): KoduAgentState["historyErrors"] | undefined;
    set historyErrors(newErrors: KoduAgentState["historyErrors"]);
    setHistoryErrorsEntry(key: string, value: NonNullable<KoduAgentState["historyErrors"]>[string]): void;
    setAutoSummarize(newValue: boolean): void;
    setAutoCloseTerminal(newValue: boolean): void;
    setTerminalCompressionThresholdValue(newValue?: number): void;
    setApiManager(newApiManager: ApiManager): void;
    setProviderRef(newProviderRef: WeakRef<ExtensionProvider>): void;
    setCustomInstructions(newInstructions?: string): void;
    setAlwaysAllowReadOnly(newValue: boolean): void;
    setInlineEditOutputType(newValue?: "full" | "diff"): void;
    private updateAmplitudeSettings;
    private onEnterSuccesfulSubAgent;
    private onExitSubAgent;
    setAlwaysAllowWriteOnly(newValue: boolean): void;
    addErrorPath(errorPath: string): void;
    setTemporaryPauseAutomaticMode(newValue: boolean): Promise<void>;
    setTerminalCompressionThreshold(newValue?: number): void;
    saveFileVersion(file: FileVersion): Promise<void>;
    deleteFileVersion(file: FileVersion): Promise<void>;
    getFileVersions(relPath: string): Promise<FileVersion[]>;
    getFilesInTaskDirectory(): Promise<Record<string, FileVersion[]>>;
}
