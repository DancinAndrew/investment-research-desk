import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import {researchDevPlugin} from './scripts/research-dev-plugin.mjs'
export default defineConfig({plugins:[vue(),researchDevPlugin()],cacheDir:'.sites-runtime/vite-cache',server:{host:'127.0.0.1',fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.private/**','**/private-inputs/**','**/private-evidence/**']}},build:{sourcemap:false}})
