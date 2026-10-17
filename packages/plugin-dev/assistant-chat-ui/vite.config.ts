import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.NEXT_PUBLIC_ASSISTANT_BASE_URL': 'undefined',
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: 'src/main.tsx',
      formats: ['iife'],
      name: 'AssistantChatUi',
      fileName: () => 'assistant-chat-ui.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: 'assistant-chat-ui.css',
      },
    },
  },
}));
