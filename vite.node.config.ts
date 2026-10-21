import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:'standalone',plugins:[react()],build:{outDir:'../dist-node',emptyOutDir:true}});
