declare global {
    function acquireVsCodeApi(): {
        postMessage(message: unknown): void
        getState(): unknown
        setState(state: unknown): void
    }
}

class VSCodeAPIWrapper {
    private readonly vsCodeApi: ReturnType<typeof acquireVsCodeApi>

    constructor() {
        this.vsCodeApi = acquireVsCodeApi()
    }

    public postMessage(message: unknown) {
        this.vsCodeApi.postMessage(message)
    }

    public getState(): unknown {
        return this.vsCodeApi.getState()
    }

    public setState(state: unknown): void {
        this.vsCodeApi.setState(state)
    }
}

export const vscode = new VSCodeAPIWrapper()