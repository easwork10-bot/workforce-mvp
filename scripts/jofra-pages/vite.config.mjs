import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "/workforce-mvp").replace(/\/+$/, "");

if (!basePath.startsWith("/") || basePath === "/") {
  throw new Error("NEXT_PUBLIC_BASE_PATH must be a non-root absolute path.");
}

export default {
  root: projectRoot,
  base: `${basePath}/`,
  publicDir: false,
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${path.join(projectRoot, "src")}/`,
      },
      {
        find: /^next-intl$/,
        replacement: path.join(projectRoot, "scripts/jofra-pages/runtime.tsx"),
      },
      {
        find: /^next\/navigation$/,
        replacement: path.join(projectRoot, "scripts/jofra-pages/runtime.tsx"),
      },
      {
        find: /^next\/image$/,
        replacement: path.join(projectRoot, "scripts/jofra-pages/image.tsx"),
      },
    ],
  },
  define: {
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(basePath),
    "process.env.NEXT_PUBLIC_APP_URL": JSON.stringify(process.env.NEXT_PUBLIC_APP_URL ?? ""),
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  build: {
    outDir: path.join(projectRoot, "out"),
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: path.join(projectRoot, "scripts/jofra-pages/client.tsx"),
    },
  },
};
