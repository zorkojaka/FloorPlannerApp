import LegacyLayoutEngine from './LegacyLayoutEngine.jsx';

// Stavba (Oreh 2) živi kot faza »projekt« znotraj tega engine-a (src/project + src/ifc).
// Stara demo pot src/building/ (A–E) je upokojena — vsa vrednost je prenesena na
// project hrbtenico (uvoz IFC/AI → indukcija → generator → A/B → oprema → cone/tokovi).
export function App() {
  return <LegacyLayoutEngine />;
}
