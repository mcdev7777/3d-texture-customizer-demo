import { createRoot } from 'react-dom/client'
import App from './App'
import { hydrateCustomTexturesFromStorage } from './store/useCustomTextureStore'
import './styles/index.css'

async function bootstrap() {
  await hydrateCustomTexturesFromStorage()
  createRoot(document.getElementById('root')!).render(<App />)
}

void bootstrap()
