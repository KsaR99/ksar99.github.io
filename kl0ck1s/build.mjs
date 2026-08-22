import * as esbuild from "esbuild";
import {existsSync} from "node:fs";

const isWatch = process.argv.includes("--watch");

const entry = ["scripts/app/main.ts", "scripts/app/main.js"].find(existsSync);
if (!entry) {
    throw new Error("Could not find scripts/app/main.ts or scripts/app/main.js");
}

const options = {
    entryPoints: [entry],
    outfile: "scripts/kl0ck1s.js",
    bundle: true,
    format: "esm",
    target: "es2025",
    platform: "browser",
    sourcemap: true,
    minify: !isWatch,
    legalComments: "none",
    logLevel: "info",
};

if (isWatch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();

    const cssCtx = await esbuild.context({
        entryPoints: ["styles/index.css"],
        outfile: "styles/kl0ck1s.css",
        bundle: true,
        minify: false,
        legalComments: "none",
        logLevel: "info",
    });
    await cssCtx.watch();

    console.log(`Watching ${entry} and styles/index.css (with imported CSS modules)...`);
} else {
    await esbuild.build(options);

    await esbuild.build({
        entryPoints: ["styles/index.css"],
        outfile: "styles/kl0ck1s.css",
        bundle: true,
        minify: !isWatch,
        legalComments: "none",
        logLevel: "info",
    });

    console.log(`Bundled ${entry} -> ${options.outfile}`);
    console.log("Bundled styles/index.css -> styles/kl0ck1s.css");
}
