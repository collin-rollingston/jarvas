import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
});
