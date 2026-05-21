import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };
export default defineConfig({
    plugins: [react(), tailwindcss(), crx({ manifest: manifest })],
    build: {
        target: "esnext",
        rollupOptions: {
            output: {
                chunkFileNames: "assets/chunk-[hash].js",
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        hmr: { port: 5173 },
    },
});
