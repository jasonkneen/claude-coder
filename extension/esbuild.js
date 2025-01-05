const esbuild = require("esbuild")
const path = require("path")

const isWatch = process.argv.includes("--watch")
const isProduction = process.argv.includes("--production")

const options = {
    entryPoints: ["./src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node16",
    sourcemap: !isProduction,
    minify: isProduction,
    mainFields: ["module", "main"],
    resolveExtensions: [".ts", ".js"],
    plugins: [
        {
            name: "mcp-sdk-resolver",
            setup(build) {
                // Handle @modelcontextprotocol/sdk imports
                build.onResolve({ filter: /^@modelcontextprotocol\/sdk/ }, args => {
                    const sdkPath = require.resolve("@modelcontextprotocol/sdk")
                    return { path: sdkPath }
                })
            }
        }
    ],
    define: {
        "process.env.NODE_ENV": isProduction ? '"production"' : '"development"',
    },
}

if (isWatch) {
    const context = await esbuild.context(options)
    await context.watch()
    console.log("[watch] build finished")
} else {
    const result = await esbuild.build(options)
    console.log("[build] build finished")
    if (result.errors.length > 0) {
        console.error(result.errors)
        process.exit(1)
    }
}