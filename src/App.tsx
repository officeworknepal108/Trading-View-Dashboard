import React, { useState } from 'react';
import { OandaProChart } from './components/OandaProChart';

export default function App() {
  const [terminalId, setTerminalId] = useState<'primary' | 'secondary'>('primary');
  return (
    <main className="h-screen w-screen overflow-hidden bg-slate-100 text-slate-900">
      <OandaProChart key={terminalId} terminalId={terminalId} onTerminalChange={setTerminalId} />
    </main>
  );
}
