import { GitBranchItem, GitLogItem } from "../../../shared/messages/extension-message";
export type GitCommitResult = {
    branch: string;
    commitHash: string;
    commitMessage?: string;
};
export declare class GitHandler {
    private repoPath;
    private readonly KODU_USER_NAME;
    private readonly KODU_USER_EMAIL;
    constructor(repoPath: string);
    private getCommitterInfo;
    private checkEnabled;
    init(): Promise<boolean>;
    private setupRepository;
    commitEverything(message: string): Promise<GitCommitResult>;
    commitOnFileWrite(path: string, commitMessage?: string): Promise<GitCommitResult>;
    private prepareForCommit;
    private commitWithMessage;
    private getCommitMessage;
    private getCommittedHash;
    static getLog(repoAbsolutePath: string): Promise<GitLogItem[]>;
    private static parseGitLogs;
    static getBranches(repoAbsolutePath: string): Promise<GitBranchItem[]>;
    static parseGitBranches(stdout: string): GitBranchItem[];
    checkoutTo(identifier: string): Promise<boolean>;
    getCurrentBranch(): Promise<string | null>;
    getCurrentCommit(): Promise<string | null>;
    createBranchAtCommit(branchName: string, commitHash: string): Promise<boolean>;
    resetHardTo(commitHash: string): Promise<boolean>;
    deleteBranch(branchName: string): Promise<boolean>;
    private isGitInstalled;
    private ensureDirectoryExists;
    private initializeRepository;
    private setGitConfig;
    private isRepositorySetup;
    private checkIsGitRepository;
    private getLocalConfigValue;
    private getGlobalConfigValue;
    static getFileContent(repoPath: string, filePath: string, commitHash: string): Promise<string | null>;
}
