import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AmbientProvider } from './lib/AmbientContext.tsx'
import { BriefingProvider } from './lib/briefingProvider.tsx'
import { bootstrapSync } from './lib/sync.ts'

function start() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AmbientProvider>
        <BriefingProvider>
          <App />
        </BriefingProvider>
      </AmbientProvider>
    </StrictMode>,
  )
}

// Erst den Stand vom Server holen, dann rendern — sonst würden die Komponenten
// den alten localStorage lesen und die Übernahme nicht mitbekommen.
// bootstrapSync() gibt nach spätestens 3 Sekunden auf; ist kein Server da,
// startet die App danach ganz normal rein lokal.
void bootstrapSync().catch(() => {}).finally(start)
