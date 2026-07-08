import { useState, type CSSProperties } from 'react';
import LegacyLayoutEngine from './LegacyLayoutEngine.jsx';
import BuildingPoC from './building/BuildingPoC';
import { loadJson, saveJson } from './shared/storage';

type Mode = 'room' | 'building';

export function App() {
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
  const [mode, setMode] = useState<Mode>(() => loadJson(storage, 'floorplanner.mode', 'room'));
  const switchMode = (next: Mode) => {
    saveJson(storage, 'floorplanner.mode', next);
    setMode(next);
  };
  return (
    <div>
      <div style={modeBarStyle}>
        <span style={{ color: '#7e8a96', fontSize: 12 }}>Engine:</span>
        <button style={modeBtnStyle(mode === 'room')} onClick={() => switchMode('room')}>
          Soba · oprema (Oreh 1)
        </button>
        <button style={modeBtnStyle(mode === 'building')} onClick={() => switchMode('building')}>
          Stavba · PoC gnezdenje (Oreh 2)
        </button>
      </div>
      {mode === 'room' ? <LegacyLayoutEngine /> : <BuildingPoC />}
    </div>
  );
}

const modeBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 18px',
  borderBottom: '1px solid #1d242d',
  background: '#0f1419',
};

function modeBtnStyle(on: boolean): CSSProperties {
  return {
    background: on ? '#122225' : '#161c23',
    border: `1px solid ${on ? '#16b3b3' : '#252e39'}`,
    borderRadius: 8,
    color: on ? '#e8eef4' : '#aab4bf',
    padding: '5px 12px',
    fontSize: 13,
    cursor: 'pointer',
  };
}
