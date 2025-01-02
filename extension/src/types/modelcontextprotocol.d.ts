declare module '@modelcontextprotocol/sdk' {
    export class Client {
        constructor(
            info: { name: string; version: string },
            options: { capabilities: Record<string, unknown> }
        );
        connect(transport: StdioClientTransport): Promise<void>;
        close(): Promise<void>;
        request<T>(request: { method: string; params?: Record<string, unknown> }, schema: any): Promise<T>;
    }

    export class StdioClientTransport {
        constructor(params: StdioServerParameters & { stderr: 'pipe' });
        start(): Promise<void>;
        close(): Promise<void>;
        stderr?: NodeJS.ReadableStream;
        onerror?: (error: Error) => Promise<void>;
        onclose?: () => Promise<void>;
    }

    export interface StdioServerParameters {
        command: string;
        args?: string[];
        env?: Record<string, string>;
    }

    export interface ListToolsResponse {
        tools: Array<{
            name: string;
            description?: string;
            inputSchema?: object;
        }>;
    }

    export interface ListResourcesResponse {
        resources: Array<{
            uri: string;
            name: string;
            mimeType?: string;
            description?: string;
        }>;
    }

    export interface ListResourceTemplatesResponse {
        resourceTemplates: Array<{
            uriTemplate: string;
            name: string;
            description?: string;
            mimeType?: string;
        }>;
    }

    export interface ReadResourceResponse {
        _meta?: Record<string, any>;
        contents: Array<{
            uri: string;
            mimeType?: string;
            text?: string;
            blob?: string;
        }>;
    }

    export interface CallToolResponse {
        _meta?: Record<string, any>;
        content: Array<
            | {
                  type: "text";
                  text: string;
              }
            | {
                  type: "image";
                  data: string;
                  mimeType: string;
              }
            | {
                  type: "resource";
                  resource: {
                      uri: string;
                      mimeType?: string;
                      text?: string;
                      blob?: string;
                  };
              }
        >;
        isError?: boolean;
    }

    export const ListToolsResultSchema: { tools: Array<{
        name: string;
        description?: string;
        inputSchema?: object;
    }> };
    export const ListResourcesResultSchema: { resources: Array<{
        uri: string;
        name: string;
        mimeType?: string;
        description?: string;
    }> };
    export const ListResourceTemplatesResultSchema: { resourceTemplates: Array<{
        uriTemplate: string;
        name: string;
        description?: string;
        mimeType?: string;
    }> };
    export const CallToolResultSchema: {
        _meta?: Record<string, any>;
        content: Array<
            | {
                  type: "text";
                  text: string;
              }
            | {
                  type: "image";
                  data: string;
                  mimeType: string;
              }
            | {
                  type: "resource";
                  resource: {
                      uri: string;
                      mimeType?: string;
                      text?: string;
                      blob?: string;
                  };
              }
        >;
        isError?: boolean;
    };
    export const ReadResourceResultSchema: {
        _meta?: Record<string, any>;
        contents: Array<{
            uri: string;
            mimeType?: string;
            text?: string;
            blob?: string;
        }>;
    };
}