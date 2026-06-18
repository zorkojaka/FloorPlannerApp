import React, { useState, useRef, useMemo, useEffect } from "react";
import { baseLib } from "./elements/library";
import { CONNECTION_META as CONN, SIDE_LABELS as SIDES, isDoor, orientation, serviceSides } from "./elements/model";
import { connectionPoint as connXY, nearestEdge, wallEdge } from "./engine/geometry";
import { generateLayoutPool } from "./engine/generator";
import { routeServices } from "./engine/routing";
import { checkFeasibility } from "./engine/feasibility";
import { initialPreferenceState, rankByPreference, recordPreference } from "./engine/preference";
import { nextPair, suggestedExplore } from "./engine/active";
import { measureGeneralization, measureInductionHoldout, measurePreferenceGain } from "./engine/metrics";
import { defaultChannels, effectiveWeight, learnChannelsFromPreference, rankByChannels, scoreCandidateChannels } from "./engine/channels";
import { applyInducedRules, induceRules, parseReferenceJson } from "./rules/induction";
import { clamp, uid } from "./shared/math";
import { loadJson, saveJson } from "./shared/storage";

/* =========================================================================
   ZAKLENJEN SISTEM - harmonika orehov
   O1 model elementa (zložljiv) · O2 postavitev (trda jedra / mehki halo) ·
   O5 instalacije · O9 indukcija pravil
   ========================================================================= */

/* =========================================================================
   DVA OBJEKTIVA na isti engine (Nadgradnja 4.0):
   · Workflow (uporabniški) — faza 0 šolanje + korak 1 elementi + korak 2
     omejitve + korak 3 generiranje/izbiranje
   · Orehe (razvojni/testni) — harmonika O1·O2·O5·O9 (testna miza)
   ========================================================================= */
export default function App(){
  const [library,setLibrary]=usePersistentState("floorplanner.library",baseLib);
  const [lens,setLens]=usePersistentState("floorplanner.lens","workflow");
  useEffect(()=>setLibrary(L=>normalizeLibraryText(L)),[setLibrary]);
  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="appHd">
        <span className="brand">◫ Layout Engine</span>
        <div className="lensTabs">
          <button className={lens==="workflow"?"on":""} onClick={()=>setLens("workflow")}>Workflow</button>
          <button className={lens==="orehe"?"on":""} onClick={()=>setLens("orehe")}>Orehe · testna miza</button>
        </div>
      </div>
      {lens==="workflow"
        ? <Workflow library={library} setLibrary={setLibrary}/>
        : <Orehe library={library} setLibrary={setLibrary}/>}
    </div>
  );
}

/* ===================== WORKFLOW (uporabniški pogled) ===================== */
function Workflow({library,setLibrary}){
  const [phase,setPhase]=usePersistentState("floorplanner.phase","korak2");
  const rp=useRoomProject(library);
  const phases=[
    {id:"faza0",tag:"0",title:"Šolanje",sub:"indukcija — napolni lečo znanja (občasno)"},
    {id:"korak1",tag:"1",title:"Elementi",sub:"knjižnica — priklopi, dimenzije, uporaba"},
    {id:"korak2",tag:"2",title:"Omejitve sobe",sub:"velikost, vrata, cone, fiksni elementi"},
    {id:"korak3",tag:"3",title:"Generiranje in izbiranje",sub:"variacije + A/B aktivno učenje"},
  ];
  return <div className="wf">
    <div className="phaseNav">
      {phases.map(p=>(
        <button key={p.id} className={"phaseBtn "+(phase===p.id?"on":"")+(p.id==="faza0"?" sep":"")} onClick={()=>setPhase(p.id)}>
          <span className="phaseTag">{p.tag}</span>
          <span className="phaseTtl"><b>{p.title}</b><i>{p.sub}</i></span>
        </button>
      ))}
    </div>
    {phase==="faza0" && <div className="phaseBody"><div className="phaseLead">Faza 0 — šolanje: vržeš noter primere dobre prakse, sistem izlušči znanje (envelope, prior kanalov). Zgodi se enkrat/občasno, ne pri vsakem projektu.</div><O9 library={library} setLibrary={setLibrary}/></div>}
    {phase==="korak1" && <div className="phaseBody"><O1 library={library} setLibrary={setLibrary}/></div>}
    {phase==="korak2" && <div className="phaseBody">
      <div className="phaseLead">Korak 2 — omejitve sobe: »tako je«. Velikost, vrata, prepovedane cone, fiksni elementi. Ta nabor je vmesnik, ki ga kasneje napolni engine za razporeditev sob.</div>
      <div className="grid2c">
        <ConstraintsPanel rp={rp} library={library}/>
        <StagePanel rp={rp} library={library}/>
      </div>
      <div className="phaseCta"><button className="ctaNext" onClick={()=>setPhase("korak3")}>Naprej → generiranje in izbiranje</button></div>
    </div>}
    {phase==="korak3" && <div className="phaseBody">
      <div className="phaseLead">Korak 3 — generiranje in izbiranje: engine vrže variacije, ti izbiraš boljše. A/B par izbere aktivno učenje (»Ugani kdo«) po informacijskem donosu.</div>
      <div className="grid2c wide">
        <StagePanel rp={rp} library={library}/>
        <ReviewPanel rp={rp}/>
      </div>
    </div>}
  </div>;
}

/* ===================== OREHE (razvojni/testni pogled) ===================== */
function Orehe({library,setLibrary}){
  const [open,setOpen]=useState("O2");
  const steps=[
    {id:"O1",title:"Model elementa",sub:"priklopi določajo orientacijo · clearance kot spekter",status:"deluje"},
    {id:"O2",title:"Postavitev v sobo",sub:"trda jedra se ne prekrivajo · halo se sme (s kaznijo)",status:"deluje"},
    {id:"O5",title:"Instalacije / routing",sub:"trase od priklopov do mokrega zidu · stene/tla",status:"deluje"},
    {id:"O9",title:"Indukcija pravil",sub:"strukturirane reference → Envelope pravila",status:"deluje"},
  ];
  return <>
    {steps.map(s=>(
      <section key={s.id} className={"step "+(open===s.id?"open":"")}>
        <button className="stepHd" onClick={()=>setOpen(open===s.id?"":s.id)}>
          <span className="stepTag">{s.id}</span>
          <span className="stepTtl"><b>{s.title}</b><i>{s.sub}</i></span>
          <span className={"stepStatus "+(s.status==="deluje"?"ok":"soon")}>{s.status}</span>
          <span className="chev">{open===s.id?"▾":"▸"}</span>
        </button>
        {open===s.id && <div className="stepBody">
          {s.id==="O1" && <O1 library={library} setLibrary={setLibrary}/>}
          {s.id==="O2" && <O2 library={library}/>}
          {s.id==="O5" && <Soon id={s.id}/>}
          {s.id==="O9" && <O9 library={library} setLibrary={setLibrary}/>}
        </div>}
      </section>
    ))}
  </>;
}

function normalizeLibraryText(library){
  const defaults=baseLib();
  let changed=false;
  const next=JSON.parse(JSON.stringify(library));
  for(const [key,def] of Object.entries(defaults)){
    if(!next[key]){next[key]=def;changed=true;continue;}
    for(const prop of ["z","h","usage","parapet"]){
      if(def[prop]!==undefined&&next[key][prop]===undefined){next[key][prop]=def[prop];changed=true;}
    }
  }
  if(next.toilet?.name==="WC skoljka"){next.toilet.name="WC školjka";changed=true;}
  return changed?next:library;
}

function normalizeChannels(channels){
  const defaults=defaultChannels();
  let changed=false;
  const byId=new Map(channels.map(c=>[c.id,c]));
  const next=defaults.map(def=>{
    const current=byId.get(def.id);
    if(!current){changed=true;return def;}
    const merged={...def,...current};
    if(current.name!==def.name){merged.name=def.name;changed=true;}
    return merged;
  });
  if(next.length!==channels.length) changed=true;
  return changed?next:channels;
}

function usePersistentState(key,initial){
  const [value,setValue]=useState(()=>loadJson(typeof window==="undefined"?undefined:window.localStorage,key,typeof initial==="function"?initial():initial));
  useEffect(()=>saveJson(typeof window==="undefined"?undefined:window.localStorage,key,value),[key,value]);
  return [value,setValue];
}

function Soon({id}){
  const txt=id==="O5"
    ? "Routing instalacij je aktiven v O2 pogledu: trase tečejo od dejanskih priklopnih točk do mokrega zidu, z dolžinami, politiko talnih tras in označenimi križanji."
    : "Indukcija: AI prebere reference/IFC in izlušči pravila v ENVELOPE obliki (jedro/halo/nasičenje/zaupanje), ki zamenjajo ročno vpisane vrednosti iz O1. Steklena škatla pokaže sklepanje.";
  return <div className="soon">{txt}</div>;
}

const SAMPLE_REFS = JSON.stringify([
  {ref:"WC-ref-01",scope:"room-type",elementKey:"toilet",parameter:"clearance-front",value:650,note:"validated compact WC"},
  {ref:"WC-ref-02",scope:"room-type",elementKey:"toilet",parameter:"clearance-front",value:690,note:"renovation reference"},
  {ref:"WC-ref-03",scope:"room-type",elementKey:"toilet",parameter:"clearance-front",value:720,note:"new build reference"},
  {ref:"WC-ref-04",scope:"global",elementKey:"sink",parameter:"clearance-front",value:540,note:"small washroom"},
  {ref:"WC-ref-05",scope:"global",elementKey:"sink",parameter:"clearance-front",value:590,note:"staff WC"},
  {ref:"WC-ref-06",scope:"global",elementKey:"sink",parameter:"clearance-front",value:620,note:"visitor WC"}
],null,2);

function O9({library,setLibrary}){
  const [raw,setRaw]=usePersistentState("floorplanner.o9.references",SAMPLE_REFS);
  const [rules,setRules]=usePersistentState("floorplanner.o9.rules",[]);
  const [metrics,setMetrics]=usePersistentState("floorplanner.o9.metrics",null);
  const [err,setErr]=useState("");
  const run=()=>{
    try{
      const refs=parseReferenceJson(raw);
      setRules(induceRules(refs));
      setMetrics({induction:measureInductionHoldout(refs),generalization:measureGeneralization(refs)});
      setErr("");
    }catch(e){
      setErr(e.message||String(e));
      setRules([]);
      setMetrics(null);
    }
  };
  const apply=()=>setLibrary(L=>applyInducedRules(L,rules));
  return <div className="o9 grid3">
    <aside className="col">
      <div className="eyebrow">Reference JSON</div>
      <textarea className="refBox" value={raw} onChange={e=>setRaw(e.target.value)} spellCheck="false"/>
      <button className="regen" onClick={run}>Izlušči pravila</button>
      {rules.length>0&&<button className="regen" onClick={apply}>Uporabi v knjižnici</button>}
      {err&&<div className="warnNote">{err}</div>}
    </aside>
    <main className="cstage">
      <div className="legend mono"><span><i style={{background:"#e2553f"}}/>core</span><span><i style={{background:"#d9a23b"}}/>halo</span><span><i style={{background:"#5bbd8b"}}/>sat</span><span><i style={{background:"#16b3b3"}}/>conf</span></div>
      <div className="ruleStage">
        {rules.length===0?<div className="noRes">Vnesi strukturirane reference in izlušči Envelope pravila. Zamenjava referenc spremeni generacijo brez spremembe kode.</div>:
          <>
          {metrics&&<div className="ruleCard metricCard">
            <div className="rHead"><b>Merilne osi</b><span>MVP</span></div>
            <div className="envGrid">
              <span>indukcija <b>{Math.round(metrics.induction.score*100)}</b></span>
              <span>holdout <b>{metrics.induction.holdoutCount}</b></span>
              <span>posplošitev <b>{Math.round(metrics.generalization.score*100)}</b></span>
              <span>avg conf <b>{metrics.generalization.averageConfidence.toFixed(2)}</b></span>
            </div>
            <div className="ruleMeta">MAE {Math.round(metrics.induction.meanAbsoluteError)} mm · train {metrics.induction.trainCount}</div>
          </div>}
          {rules.map(r=><div key={r.id} className="ruleCard">
            <div className="rHead"><b>{library[r.elementKey]?.name||r.elementKey}</b><span>{r.parameter} · {r.envelope.scope}</span></div>
            <div className="envGrid">
              <span>core <b>{r.envelope.core}</b></span><span>halo <b>{r.envelope.halo}</b></span><span>sat <b>{r.envelope.sat}</b></span><span>conf <b>{r.envelope.conf.toFixed(2)}</b></span>
            </div>
            <div className="ruleMeta">n={r.count} · mean {Math.round(r.mean)} · variance {Math.round(r.variance)}</div>
            <div className="refs">{r.references.join(" · ")}</div>
          </div>)}
          </>}
      </div>
    </main>
    <aside className="col">
      <div className="eyebrow">Trenutna knjižnica</div>
      {Object.entries(library).filter(([k,e])=>!isDoor(e)).map(([k,e])=><div key={k} className="libRule">
        <b>{e.name}</b><span className="mono">{e.clear.core}/{e.clear.halo}/{e.clear.sat} · {e.clear.conf.toFixed(2)}</span><i>{e.clear.scope} · {e.source}</i>
      </div>)}
    </aside>
  </div>;
}

/* ===================== O1 ===================== */
function O1({library,setLibrary}){
  const [sel,setSel]=useState("toilet"); const [selConn,setSelConn]=useState(null); const [drag,setDrag]=useState(null);
  const svgRef=useRef(null); const el=library[sel]; const ori=orientation(el); const ss=serviceSides(el);
  const patch=(u)=>setLibrary(L=>{const e=JSON.parse(JSON.stringify(L[sel]));u(e);e.source="user";return{...L,[sel]:e};});
  const patchN=(u)=>setLibrary(L=>{const e=JSON.parse(JSON.stringify(L[sel]));u(e);return{...L,[sel]:e};});
  const reset=()=>{setLibrary(L=>({...L,[sel]:baseLib()[sel]}));setSelConn(null);};
  const VB={x:-700,y:-700,w:2400,h:2400}; const R={x:-el.w/2,y:-el.d/2,w:el.w,h:el.d};
  const toSvg=(e)=>{const svg=svgRef.current;if(!svg)return null;const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const c=svg.getScreenCTM();if(!c)return null;const p=pt.matrixTransform(c.inverse());return{x:p.x,y:p.y};};
  const onMove=(e)=>{if(!drag)return;const p=toSvg(e);if(!p)return;const ne=nearestEdge(p.x,p.y,R);patch(el=>{const c=el.conns.find(c=>c.id===drag);if(c){c.side=ne.side;c.off=ne.off;}});};
  return (
   <div className="o1" onPointerMove={onMove} onPointerUp={()=>setDrag(null)} onPointerLeave={()=>setDrag(null)}>
    <div className="grid3">
      <aside className="col">
        <div className="eyebrow">Knjižnica</div>
        {Object.entries(library).filter(([k,e])=>!isDoor(e)).map(([k,e])=>(
          <button key={k} className={"litem "+(sel===k?"on":"")} onClick={()=>{setSel(k);setSelConn(null);}}>
            <span>{e.name}</span><span className={"src "+e.source}>{e.source==="user"?"uporabnik":"privzeto"}</span></button>))}
        <div className="hint">Vir <b>uporabnik</b> = trda lastnost.</div>
      </aside>
      <main className="cstage">
        <div className="legend mono"><span><i style={{background:"#d9a23b"}}/>jedro</span><span><i style={{background:"#d9a23b",opacity:.4}}/>halo</span>{Object.entries(CONN).map(([k,c])=><span key={k}><i style={{background:c.color}}/>{c.short}</span>)}</div>
        <div className="sheet">
          <svg ref={svgRef} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} style={{width:"100%",height:"100%"}}>
            <defs><pattern id="h2" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="70" stroke="#d9a23b" strokeWidth="11" opacity=".55"/></pattern>
            <pattern id="wall" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="60" stroke="#7c8794" strokeWidth="16"/></pattern></defs>
            {ss.map(s=>{const t=130;
              if(s==="back")return<rect key={s} x={R.x-60} y={R.y-t-30} width={R.w+120} height={t} fill="url(#wall)" stroke="#5a6675" strokeWidth="8"/>;
              if(s==="front")return<rect key={s} x={R.x-60} y={R.y+R.h+30} width={R.w+120} height={t} fill="url(#wall)" stroke="#5a6675" strokeWidth="8"/>;
              if(s==="left")return<rect key={s} x={R.x-t-30} y={R.y-60} width={t} height={R.h+120} fill="url(#wall)" stroke="#5a6675" strokeWidth="8"/>;
              return<rect key={s} x={R.x+R.w+30} y={R.y-60} width={t} height={R.h+120} fill="url(#wall)" stroke="#5a6675" strokeWidth="8"/>;})}
            {/* clearance spredaj */}
            {(()=>{const y0=R.y+R.h;return<g>
              <rect x={R.x} y={y0+el.clear.core} width={R.w} height={el.clear.halo-el.clear.core} fill="url(#h2)"/>
              <rect x={R.x} y={y0} width={R.w} height={el.clear.core} fill="#d9a23b" opacity=".16" stroke="#d9a23b" strokeWidth="18"/>
              <line x1={R.x-40} y1={y0+el.clear.sat} x2={R.x+R.w+40} y2={y0+el.clear.sat} stroke="#5bbd8b" strokeWidth="14" strokeDasharray="30 50"/>
            </g>;})()}
            <rect x={R.x} y={R.y} width={R.w} height={R.h} rx="26" fill="#eef1ec" stroke="#2b3138" strokeWidth="30"/>
            {ss.includes("back")&&<line x1={R.x} y1={R.y} x2={R.x+R.w} y2={R.y} stroke="#16b3b3" strokeWidth="46"/>}
            {ss.includes("front")&&<line x1={R.x} y1={R.y+R.h} x2={R.x+R.w} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="46"/>}
            {ss.includes("left")&&<line x1={R.x} y1={R.y} x2={R.x} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="46"/>}
            {ss.includes("right")&&<line x1={R.x+R.w} y1={R.y} x2={R.x+R.w} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="46"/>}
            <text x={0} y={0} fill="#5a6675" fontSize="120" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle" dy="42">{el.w}×{el.d}</text>
            {el.conns.map(c=>{const p=connXY(c,R);const col=CONN[c.type].color;
              return<g key={c.id} style={{cursor:"grab"}} onPointerDown={e=>{e.stopPropagation();setDrag(c.id);setSelConn(c.id);}}>
                {c.routesTo==="floor"&&<circle cx={p.x} cy={p.y} r="92" fill="none" stroke={col} strokeWidth="14" strokeDasharray="40 34"/>}
                <circle cx={p.x} cy={p.y} r="62" fill={col} stroke={selConn===c.id?"#fff":"#0e1116"} strokeWidth={selConn===c.id?14:8}/>
                <text x={p.x} y={p.y} fill="#fff" textAnchor="middle" dy="34" fontSize="62" fontWeight="700" fontFamily="ui-monospace,Menlo,monospace">{CONN[c.type].short}</text></g>;})}
          </svg>
        </div>
        <div className={"oriBar "+(ori.warn?"warn":"")}>{ori.warn?"⚠ ":""}{ori.txt}</div>
      </main>
      <aside className="col">
        <div className="eyebrow">Dimenzije</div>
        <Num label="Širina" v={el.w} set={v=>patch(e=>e.w=v)} min={250} max={2000} step={10}/>
        <Num label="Globina" v={el.d} set={v=>patch(e=>e.d=v)} min={250} max={2500} step={10}/>
        <Num label="Višina" v={el.h??0} set={v=>patch(e=>e.h=v)} min={0} max={3000} step={50}/>
        <Num label="Z odmik" v={el.z??0} set={v=>patch(e=>e.z=v)} min={0} max={2500} step={50}/>
        {el.kind==="window"&&<Num label="Parapet" v={el.parapet??900} set={v=>patch(e=>{e.parapet=v;e.z=v;})} min={0} max={1800} step={50}/>}
        <div className="eyebrow mt">Uporaba</div>
        <div className="rt3 wrap">{["none","standing","seated"].map(p=><button key={p} className={(el.usage?.posture||"none")===p?"on":""} onClick={()=>patch(e=>e.usage={posture:p,userAt:"front"})}>{p==="none"?"brez":p==="standing"?"stoje":"sede"}</button>)}</div>
        <div className="eyebrow mt">Priklopi</div>
        {el.conns.map(c=>(
          <div key={c.id} className={"conn "+(selConn===c.id?"on":"")} onClick={()=>setSelConn(c.id)}>
            <div className="connTop"><span className="cdot" style={{background:CONN[c.type].color}}/>
              <select value={c.type} onChange={e=>patch(el=>{el.conns.find(x=>x.id===c.id).type=e.target.value;})}>{Object.entries(CONN).map(([k,v])=><option key={k} value={k}>{v.name}</option>)}</select>
              <button className="del" onClick={ev=>{ev.stopPropagation();patch(el=>el.conns=el.conns.filter(x=>x.id!==c.id));}}>×</button></div>
            <div className="connRow"><span className="lbl">stran</span><div className="sideBtns">{Object.entries(SIDES).map(([k,v])=><button key={k} className={c.side===k?"on":""} onClick={()=>patch(el=>el.conns.find(x=>x.id===c.id).side=k)}>{v}</button>)}</div></div>
            <div className="connRow"><span className="lbl">vodi v</span><div className="rt"><button className={c.routesTo==="wall"?"on":""} onClick={()=>patch(el=>el.conns.find(x=>x.id===c.id).routesTo="wall")}>zid</button><button className={c.routesTo==="floor"?"on":""} onClick={()=>patch(el=>el.conns.find(x=>x.id===c.id).routesTo="floor")}>tla</button></div></div>
          </div>))}
        <button className="add" onClick={()=>patch(el=>el.conns.push({id:uid(),type:"electric",side:"back",off:0.5,routesTo:"wall"}))}>+ priklop</button>
        <div className="eyebrow mt">Clearance envelope</div>
        <Num label="Jedro (trdo)" v={el.clear.core} set={v=>patch(e=>e.clear.core=Math.min(v,e.clear.halo-10))} min={200} max={1200} step={10} c="#e2553f"/>
        <Num label="Halo (mehko)" v={el.clear.halo} set={v=>patch(e=>e.clear.halo=clamp(v,e.clear.core+10,e.clear.sat-10))} min={300} max={1500} step={10} c="#d9a23b"/>
        <button className="reset" onClick={reset}>↻ Ponastavi</button>
      </aside>
    </div>
   </div>);
}

/* ===================== O2 — projekt sobe (skupno stanje) ===================== */
function useRoomProject(library){
  const [W,setW]=usePersistentState("floorplanner.project.W",1900),[D,setD]=usePersistentState("floorplanner.project.D",2200),[wet,setWet]=usePersistentState("floorplanner.project.wetWall","S");
  const [prog,setProg]=usePersistentState("floorplanner.project.program",()=>[{id:uid(),key:"door",w:800,dir:"auto",wall:"auto",hinge:"auto"},{id:uid(),key:"toilet"},{id:uid(),key:"sink"}]);
  const [soft,setSoft]=usePersistentState("floorplanner.project.soft",true);
  const [allowFloorRoutes,setAllowFloorRoutes]=usePersistentState("floorplanner.project.allowFloorRoutes",true);
  const [zones,setZones]=usePersistentState("floorplanner.project.zones",[]);
  const setZone=(id,patch)=>setZones(Z=>Z.map(z=>z.id===id?{...z,...patch}:z));
  const [pool,setPool]=useState([]); const [idx,setIdx]=useState(0); const [seed,setSeed]=useState(0);
  const [pref,setPref]=usePersistentState("floorplanner.preference",initialPreferenceState);
  const [channels,setChannels]=usePersistentState("floorplanner.channels",defaultChannels);
  useEffect(()=>setChannels(C=>normalizeChannels(C)),[setChannels]);
  const cfg=useMemo(()=>({W,D,wetWall:wet,minAisle:800}),[W,D,wet]);
  const feasibility=useMemo(()=>checkFeasibility(library,prog,cfg,zones),[library,prog,cfg,zones]);

  useEffect(()=>{
    if(!feasibility.feasible){setPool([]);setIdx(0);return;}
    setPool(generateLayoutPool({library, program:prog, cfg, soft, zones}));
    setIdx(0);
  },[library,prog,W,D,wet,soft,zones,seed,cfg,feasibility]);

  const cornerEls=prog.filter(p=>{const e=library[p.key];return e&&!isDoor(e)&&serviceSides(e).length>1;});
  const hasDoor=prog.some(p=>isDoor(library[p.key]));
  const best=pool[idx];
  const [explore,setExplore]=usePersistentState("floorplanner.explore",0.7);
  const abPair=useMemo(()=>nextPair(pool,channels,cfg,explore),[pool,channels,cfg,explore]);
  const optionA=abPair?.a, optionB=abPair?.b;
  const bestChannelScores=best?scoreCandidateChannels(best,channels,cfg):null;
  const routing=useMemo(()=>best?routeServices(best.placed,cfg,{allowFloorRoutes}):null,[best,cfg,allowFloorRoutes]);
  const choosePreference=(selected,rejected)=>setPref(prev=>{
    const next=recordPreference(prev,selected,rejected);
    const learnedChannels=learnChannelsFromPreference(channels,selected,rejected,cfg);
    setChannels(learnedChannels);
    setPool(P=>rankByChannels(rankByPreference(P,next.weights),learnedChannels,cfg));
    setIdx(0);
    return next;
  });
  const setChannel=(id,patch)=>setChannels(C=>C.map(c=>c.id===id?{...c,...patch}:c));
  const setInst=(id,patch)=>setProg(P=>P.map(p=>p.id===id?{...p,...patch}:p));
  return {W,setW,D,setD,wet,setWet,prog,setProg,setInst,soft,setSoft,allowFloorRoutes,setAllowFloorRoutes,zones,setZones,setZone,
    pool,idx,setIdx,seed,setSeed,pref,channels,setChannel,cfg,feasibility,cornerEls,hasDoor,best,explore,setExplore,
    abPair,optionA,optionB,bestChannelScores,routing,choosePreference};
}

// O2 v pogledu orehov (testna miza): vse troje hkrati, kot prej.
function O2({library}){
  const rp=useRoomProject(library);
  return <div className="o2"><div className="grid3">
    <ConstraintsPanel rp={rp} library={library}/>
    <StagePanel rp={rp} library={library}/>
    <ReviewPanel rp={rp}/>
  </div></div>;
}

/* ===== Korak 2 — omejitve sobe (leva polovica nekdanjega O2) ===== */
function ConstraintsPanel({rp,library}){
  const {W,setW,D,setD,wet,setWet,prog,setProg,setInst,soft,setSoft,allowFloorRoutes,setAllowFloorRoutes,zones,setZones,setZone,hasDoor,cornerEls,feasibility,setSeed}=rp;
  return (
    <aside className="col">
      <div className="eyebrow">Prostor</div>
      <Num label="Širina" v={W} set={setW} min={1200} max={5000} step={50}/>
      <Num label="Globina" v={D} set={setD} min={1400} max={5000} step={50}/>
      <div className="wp"><span>Mokri zid</span><div className="rt wgrid">{["N","E","S","W"].map(w=><button key={w} className={wet===w?"on":""} onClick={()=>setWet(w)}>{({N:"sever",E:"vzhod",S:"jug",W:"zahod"})[w]}</button>)}</div></div>
      <div className="eyebrow mt">Program</div>
      <div className="addRow">{Object.entries(library).map(([k,e])=><button key={k} onClick={()=>setProg(p=>[...p,{id:uid(),key:k,...(isDoor(e)?{w:800,dir:"auto",wall:"auto",hinge:"auto"}:{})}])}>+ {e.name}</button>)}</div>
      <div className="progList">{prog.map(p=>{const e=library[p.key];const door=isDoor(e);
        return <div key={p.id} className={"pItem "+(door?"door":"")}>
          <div className="pTop"><span>{e.name}{door?` (${p.w})`:""}</span><button onClick={()=>setProg(P=>P.filter(x=>x.id!==p.id))}>×</button></div>
          {door && <div className="dCfg">
            <div className="dRow"><span>širina</span><div className="rt3">{[700,800,900].map(w=><button key={w} className={p.w===w?"on":""} onClick={()=>setInst(p.id,{w})}>{w}</button>)}</div></div>
            <div className="dRow"><span>smer</span><div className="rt3">{[["auto","auto"],["inward","Noter"],["outward","Ven"]].map(([v,l])=><button key={v} className={p.dir===v?"on":""} onClick={()=>setInst(p.id,{dir:v})}>{l}</button>)}</div></div>
            <div className="dRow"><span>tečaj</span><div className="rt3">{[["auto","auto"],[0,"Levo"],[1,"Desno"]].map(([v,l])=><button key={String(v)} className={p.hinge===v?"on":""} onClick={()=>setInst(p.id,{hinge:v})}>{l}</button>)}</div></div>
            <div className="dRow"><span>zid</span><div className="rt3 wrap">{[["auto","auto"],["N","S"],["E","V"],["S","J"],["W","Z"]].map(([v,l])=><button key={v} className={p.wall===v?"on":""} onClick={()=>setInst(p.id,{wall:v})}>{l}</button>)}</div></div>
            <div className="dRow"><span>poz.</span><div className="rt3"><button className={p.fixedPos?"on":""} onClick={()=>setInst(p.id,{fixedPos:!p.fixedPos})}>{p.fixedPos?"fiksna":"prosta"}</button></div></div>
            {p.fixedPos && <input type="range" min="0" max="1" step="0.02" value={p.fpos??0.5} onChange={e=>setInst(p.id,{fpos:+e.target.value})} style={{width:"100%",marginTop:2,accentColor:"#5aa9e6"}}/>}
          </div>}
        </div>;})}</div>
      {!hasDoor && <div className="warnNote">⚠ Soba rabi vsaj ena vrata. Dodaj jih, sicer ni veljavne rešitve.</div>}
      {cornerEls.length>0 && <div className="warnNote">Kotni elementi rabijo vogalno postavitev - pride kasneje.</div>}
      {!feasibility.feasible && <div className="warnNote"><b>Predhodna izvedljivost</b><br/>{feasibility.reasons.map((r,i)=><span key={i}>{r}<br/></span>)}</div>}
      <div className="eyebrow mt">Realne omejitve sobe</div>
      <button className="add" onClick={()=>setZones(z=>[...z,{id:uid(),x:Math.round(W*0.4),y:Math.round(D*0.35),w:600,h:600}])}>+ prepovedana cona</button>
      {zones.map(z=>(
        <div key={z.id} className="zone">
          <div className="zTop"><span>prepovedana cona</span><button onClick={()=>setZones(Z=>Z.filter(x=>x.id!==z.id))}>×</button></div>
          <div className="zGrid">
            <ZNum label="x" v={z.x} set={v=>setZone(z.id,{x:v})} max={W}/>
            <ZNum label="y" v={z.y} set={v=>setZone(z.id,{y:v})} max={D}/>
            <ZNum label="š" v={z.w} set={v=>setZone(z.id,{w:v})} max={W}/>
            <ZNum label="g" v={z.h} set={v=>setZone(z.id,{h:v})} max={D}/>
          </div>
        </div>
      ))}
      <div className="ifaceNote">Vmesnik omejitev: zdaj jih vnašaš ti (steber, okno, obstoječa vrata). Kasneje jih engine za razporeditev sob napolni sam - kje so vrata, koliko m².</div>
      <label className="softTgl"><input type="checkbox" checked={soft} onChange={e=>setSoft(e.target.checked)}/> <span>Mehka pravila: halo se sme upogniti</span></label>
      <div className="softNote">{soft?"Halo se sme prekriti (kazen). Lok vrat ostane TRDO pravilo - vanj nikoli.":"Strogo: vsako prekrivanje halo = zavrnitev."}</div>
      <label className="softTgl"><input type="checkbox" checked={allowFloorRoutes} onChange={e=>setAllowFloorRoutes(e.target.checked)}/> <span>O5: talne trase dovoljene</span></label>
      <div className="softNote">{allowFloorRoutes?"Priklopi, ki vodijo v tla, se lahko trasirajo po plošči.":"Talne trase ostanejo vidne, vendar so označene kot blokirane."}</div>
      <button className="regen" onClick={()=>setSeed(s=>s+1)}>↻ Generiraj</button>
    </aside>
  );
}

/* ===== Korak 3 (a) — oder z razporeditvijo in poolom ===== */
function StagePanel({rp}){
  const {best,cfg,zones,routing,feasibility,hasDoor,soft,pool,idx,setIdx}=rp;
  return (
    <main className="cstage">
      <div className="legend mono"><span><i style={{background:"#2b3138"}}/>oprema</span><span><i style={{background:"#e2553f"}}/>jedro</span><span><i style={{background:"#d9a23b",opacity:.5}}/>halo</span><span><i style={{background:"#c0392b"}}/>halo prekrit</span><span><i style={{background:"#5aa9e6"}}/>lok vrat</span><span><i style={{background:"#16b3b3"}}/>mokri zid</span><span><i style={{background:"#3f86c9"}}/>O5 zid</span><span><i style={{background:"#d9a23b"}}/>O5 tla</span></div>
      <div className="sheet">{best? <O2Plan cand={best} cfg={cfg} zones={zones} routing={routing}/> : <div className="noRes">{!feasibility.feasible?<>Brief ni izvedljiv:<br/>{feasibility.reasons.join(" · ")}</>:!hasDoor?"Dodaj vrata - soba brez vrat nima veljavne rešitve.":soft?"Ni veljavne razporeditve ob teh omejitvah. Povečaj prostor ali zrahljaj zahteve.":"V strogem načinu ni rešitve - vklopi mehka pravila."}</div>}</div>
      <div className="poolBar">{pool.length>0 && <><span className="mono">{pool.length} veljavnih</span>{pool.slice(0,8).map((c,i)=><button key={i} className={"thumb "+(idx===i?"on":"")} onClick={()=>setIdx(i)}><span className="mono">{(c.ev.score*100|0)}</span></button>)}</>}</div>
    </main>
  );
}

/* ===== Korak 3 (b) — preverba, instalacije, A/B aktivno učenje, kanali ===== */
function ReviewPanel({rp}){
  const {best,cfg,routing,optionA,optionB,abPair,explore,setExplore,pref,channels,setChannel,bestChannelScores,choosePreference}=rp;
  return (
    <aside className="col">
      {best? <>
        <div className="eyebrow">Preverba pravil · ocena <span className="mono">{(best.ev.score*100|0)}</span></div>
        <div className="check ok2">✓ trda jedra se ne prekrivajo</div>
        <div className="check ok2">✓ lok vrat prost (P-01)</div>
        <div className="check ok2">✓ prehod {Math.round(best.ev.aisle)} mm ≥ {cfg.minAisle}</div>
        <div className="eyebrow mt">Mehke kazni (halo)</div>
        {best.ev.overlaps.length>0 ? best.ev.overlaps.map((o,i)=>(
          <div key={i} className="soft2"><span className="sw"/>{o.a} ↔ {o.b}<br/><span className="mono">{(o.area/1e6).toFixed(2)} m² → dovoljeno, kaznovano</span></div>
        )) : <div className="soft2 none">brez prekrivanj halo - čista razporeditev</div>}
        <div className="eyebrow mt">Instalacije</div>
        <div className="drain"><span className="mono">{((routing?.totalLength||0)/1000).toFixed(2)} m</span> skupne trase<br/><i>O5 računa od dejanske priklopne točke</i></div>
        {routing?.blockedCount>0 && <div className="warnNote">{routing.blockedCount} talnih tras je blokiranih po politiki plošče.</div>}
        {routing?.floorCrossingCount>0 && <div className="warnNote">{routing.floorCrossingCount} talnih tras ima križanje.</div>}
        <div className="routeList">{routing?.routes.map(r=><div key={r.id} className={"routeItem "+r.via+(r.blocked?" blocked":"")}>
          <span>{r.fixtureName} · {CONN[r.connection.type].short} · {r.via==="floor"?"tla":"zid"}</span>
          <b className="mono">{(r.length/1000).toFixed(2)} m</b>
        </div>)}</div>
        <div className="eyebrow mt">A/B preference · aktivno učenje</div>
        {optionA&&optionB ? <div className="abBox">
          <div className="abBtns">
            <button onClick={()=>choosePreference(optionA,optionB)}>A <span className="mono">{(optionA.ev.score*100|0)}</span></button>
            <button onClick={()=>choosePreference(optionB,optionA)}>B <span className="mono">{(optionB.ev.score*100|0)}</span></button>
          </div>
          <div className="exploreRow">
            <span>raziskovanje <b className="mono">{Math.round(explore*100)}</b> · izkoriščanje <b className="mono">{Math.round((1-explore)*100)}</b></span>
            <input type="range" min="0" max="1" step="0.05" value={explore} onChange={e=>setExplore(+e.target.value)} style={{width:"100%",accentColor:"#5aa9e6"}}/>
            <span className="abHint">{explore>0.66?"Ugani kdo: par, ki najbolj prepolovi negotovost":explore<0.34?"izkoriščanje: kaže najboljši par":"mešano: informativno + kvaliteta"} · donos para <b className="mono">{(abPair.info*100|0)}</b></span>
            <button className="microBtn" onClick={()=>setExplore(suggestedExplore(pref.comparisons))}>predlagaj ({Math.round(suggestedExplore(pref.comparisons)*100)})</button>
          </div>
          <div className="prefBars">
            <span>halo <b className="mono">{Math.round(pref.weights.halo*100)}</b></span>
            <span>odtok <b className="mono">{Math.round(pref.weights.drain*100)}</b></span>
          </div>
          <div className="prefBars"><span>donos <b className="mono">{Math.round(measurePreferenceGain(pref)*100)}</b></span><span>stabilnost <b className="mono">{pref.stableStreak}</b></span></div>
          <div className={pref.converged?"conv on":"conv"}>{pref.converged?`konvergenca po ${pref.comparisons} primerjavah`:`${pref.comparisons} primerjav · signal ${pref.dominantSignal}`}</div>
        </div> : <div className="soft2 none">Za A/B sta potrebni vsaj dve veljavni rešitvi.</div>}
        <div className="eyebrow mt">Testna miza kanalov</div>
        <div className="channelBench">
          {channels.map(ch=>{
            const score=bestChannelScores?.scores.find(s=>s.channelId===ch.id);
            return <div key={ch.id} className={"channelCard "+(!ch.enabled?"off":"")}>
              <div className="chTop"><label><input type="checkbox" checked={ch.enabled} onChange={e=>setChannel(ch.id,{enabled:e.target.checked})}/> {ch.name}</label><span>{ch.family}</span></div>
              <div className="chScope"><button className={ch.scope==="global"?"on":""} onClick={()=>setChannel(ch.id,{scope:"global"})}>global</button><button className={ch.scope==="room-type"?"on":""} onClick={()=>setChannel(ch.id,{scope:"room-type"})}>room</button></div>
              <label className="chSlider">prior <input type="range" min="0" max="1" step="0.01" value={ch.prior} onChange={e=>setChannel(ch.id,{prior:+e.target.value})}/><b className="mono">{Math.round(ch.prior*100)}</b></label>
              <label className="chSlider">zaup. <input type="range" min="0" max="1" step="0.01" value={ch.confidence} onChange={e=>setChannel(ch.id,{confidence:+e.target.value})}/><b className="mono">{Math.round(ch.confidence*100)}</b></label>
              <div className="chBars">
                <span style={{"--w":`${ch.prior*100}%`}}>prior</span>
                <span style={{"--w":`${ch.learned*100}%`}}>learned</span>
                <span style={{"--w":`${effectiveWeight(ch)*100}%`}}>eff</span>
              </div>
              <div className="chScore">score <b className="mono">{score?Math.round(score.value*100):"-"}</b></div>
            </div>
          })}
        </div>
      </> : <div className="noRes2">Ni veljavne rešitve za te zahteve.</div>}
    </aside>
  );
}

function O2Plan({cand,cfg,zones,routing}){ const {W,D,wetWall}=cfg; const PAD=900; const we=wallEdge(wetWall,W,D);
  return <svg viewBox={`${-PAD} ${-PAD} ${W+PAD*2} ${D+PAD*2}`} style={{width:"100%",height:"100%"}}>
    <defs><pattern id="hh" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="80" stroke="#d9a23b" strokeWidth="12" opacity=".5"/></pattern>
    <pattern id="nogo" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="70" stroke="#e2553f" strokeWidth="16" opacity=".55"/></pattern></defs>
    <rect x="0" y="0" width={W} height={D} fill="#f6f7f3" stroke="#2b3138" strokeWidth="110"/>
    <g fontFamily="ui-monospace,Menlo,monospace" fontSize="150" fill="#aab4bf" opacity=".65" textAnchor="middle">
      <text x={W/2} y={-300}>S</text>
      <text x={W+360} y={D/2} dy="52">V</text>
      <text x={W/2} y={D+420}>J</text>
      <text x={-360} y={D/2} dy="52">Z</text>
    </g>
    <line {...we} stroke="#16b3b3" strokeWidth="130"/>
    {(routing?.routes||[]).map(r=><g key={r.id}>
      <line x1={r.from.x} y1={r.from.y} x2={r.to.x} y2={r.to.y} stroke={r.blocked?"#e2553f":r.via==="floor"?"#d9a23b":"#3f86c9"} strokeWidth="22" strokeDasharray={r.via==="floor"?"60 42":"none"} opacity=".88"/>
      {r.crossesFloorRoute&&<circle cx={(r.from.x+r.to.x)/2} cy={(r.from.y+r.to.y)/2} r="54" fill="#d9a23b" stroke="#2b3138" strokeWidth="12"/>}
      <circle cx={r.from.x} cy={r.from.y} r="42" fill={CONN[r.connection.type].color} stroke="#0e1116" strokeWidth="9"/>
    </g>)}
    {(zones||[]).map((z,i)=><g key={"z"+i}><rect x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#nogo)" stroke="#e2553f" strokeWidth="16" strokeDasharray="70 50"/>
      <text x={z.x+z.w/2} y={z.y+z.h/2} fill="#b03a2e" fontSize="95" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle" dy="34">ne</text></g>)}
    {cand.placed.filter(p=>p.kind!=="door").map((p,i)=><rect key={"s"+i} x={p.soft.x} y={p.soft.y} width={p.soft.w} height={p.soft.h} fill="url(#hh)" stroke="#d9a23b" strokeWidth="14" strokeDasharray="50 50" opacity=".8"/>)}
    {cand.ev.overlaps.map((o,i)=>o.box&&<rect key={"o"+i} x={o.box.x} y={o.box.y} width={o.box.w} height={o.box.h} fill="#c0392b" opacity=".34"/>)}
    {cand.placed.filter(p=>p.kind!=="door").map((p,i)=><rect key={"h"+i} x={p.hard.x} y={p.hard.y} width={p.hard.w} height={p.hard.h} fill="#e2553f" opacity=".14" stroke="#e2553f" strokeWidth="20"/>)}
    {cand.placed.filter(p=>p.kind!=="door").map((p,i)=><g key={"f"+i}><rect x={p.foot.x} y={p.foot.y} width={p.foot.w} height={p.foot.h} rx="26" fill="#dfe6df" stroke="#2b3138" strokeWidth="30"/>
      <text x={p.foot.x+p.foot.w/2} y={p.foot.y+p.foot.h/2} fill="#3a444f" fontSize="115" fontFamily="ui-sans-serif,system-ui" textAnchor="middle" dy="40">{p.name}</text></g>)}
    {cand.placed.filter(p=>p.kind==="door").map((p,i)=><Door key={"d"+i} p={p} W={W} D={D}/>)}
  </svg>;
}

function Door({p,W,D}){
  const lw=(p.wall==="N"||p.wall==="S")?p.foot.w:p.foot.h;
  const norm={S:[0,-1],N:[0,1],W:[1,0],E:[-1,0]}[p.wall];   // v sobo
  const along={S:[1,0],N:[1,0],W:[0,1],E:[0,1]}[p.wall];     // vzdolz zidu
  let sx,sy;
  if(p.wall==="S"){sx=p.foot.x;sy=D;} else if(p.wall==="N"){sx=p.foot.x;sy=0;}
  else if(p.wall==="W"){sx=0;sy=p.foot.y;} else {sx=W;sy=p.foot.y;}
  const sgn=p.dir==="outward"?-1:1;
  const hs=p.hinge?1:0;
  const Hx=sx+along[0]*lw*hs,     Hy=sy+along[1]*lw*hs;       // tecaj (fiksen)
  const Jx=sx+along[0]*lw*(1-hs), Jy=sy+along[1]*lw*(1-hs);   // zaprti podboj
  const Tx=Hx+norm[0]*lw*sgn,     Ty=Hy+norm[1]*lw*sgn;       // odprto krilo (90°)
  // sweep iz dejanskega kota: lok od T do J okoli H, krajša pot (90°)
  const aT=Math.atan2(Ty-Hy,Tx-Hx), aJ=Math.atan2(Jy-Hy,Jx-Hx);
  let d=aJ-aT; while(d<=-Math.PI)d+=2*Math.PI; while(d>Math.PI)d-=2*Math.PI;
  const sweep=d>0?1:0;
  let gap;
  if(p.wall==="S")gap={x:p.foot.x,y:D-70,w:lw,h:140}; else if(p.wall==="N")gap={x:p.foot.x,y:-70,w:lw,h:140};
  else if(p.wall==="W")gap={x:-70,y:p.foot.y,w:140,h:lw}; else gap={x:W-70,y:p.foot.y,w:140,h:lw};
  return <g>
    <rect x={gap.x} y={gap.y} width={gap.w} height={gap.h} fill="#f6f7f3"/>
    {p.swing && <path d={`M${Hx} ${Hy} L${Tx} ${Ty} A${lw} ${lw} 0 0 ${sweep} ${Jx} ${Jy} Z`} fill="#5aa9e6" opacity=".12"/>}
    <path d={`M${Tx} ${Ty} A${lw} ${lw} 0 0 ${sweep} ${Jx} ${Jy}`} fill="none" stroke="#5aa9e6" strokeWidth="22" strokeDasharray="60 50"/>
    <line x1={Hx} y1={Hy} x2={Tx} y2={Ty} stroke="#3a78b0" strokeWidth="40"/>
    <circle cx={Hx} cy={Hy} r="36" fill="#3a78b0"/>
  </g>;
}



/* ===================== mali gradniki ===================== */
function ZNum({label,v,set,max}){ return <label className="znum"><span>{label}</span><input type="range" min="0" max={max} step="50" value={v} onChange={e=>set(+e.target.value)}/><b className="mono">{v}</b></label>; }
function Num({label,v,set,min,max,step,c}){ return <div className="num"><div className="fhd"><span>{label}</span><span className="mono" style={c?{color:c}:{}}>{v}{label.match(/Širina|Globina|Višina|Z odmik|Parapet|Jedro|Halo/)?" mm":""}</span></div><input type="range" min={min} max={max} step={step} value={v} onChange={e=>set(+e.target.value)} style={c?{accentColor:c}:{}}/></div>; }

const CSS=`
.app{--bg:#0f1419;--panel:#161c23;--p2:#1b222b;--bd:#252e39;--tx:#d7dee6;--mut:#7c8794;--cy:#16b3b3;
 font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--tx);background:var(--bg);min-height:100%;padding:14px}
.app *{box-sizing:border-box}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.eyebrow{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);margin-bottom:11px}.mt{margin-top:20px}
.appHd{display:flex;justify-content:space-between;align-items:center;padding:4px 6px 16px}
.brand{font-size:15px;font-weight:600;color:var(--cy)}.bcrumb{font-size:11.5px;color:var(--mut)}
.step{background:var(--panel);border:1px solid var(--bd);border-radius:12px;margin-bottom:10px;overflow:hidden}
.step.open{border-color:#2f3a47}
.stepHd{width:100%;display:flex;align-items:center;gap:13px;padding:15px 18px;background:none;border:none;color:var(--tx);cursor:pointer;text-align:left}
.step.open .stepHd{border-bottom:1px solid var(--bd)}
.stepTag{width:32px;height:32px;border:1.5px solid var(--cy);border-radius:8px;display:grid;place-items:center;color:var(--cy);font-weight:700;font-size:12px;flex:none}
.stepTtl{flex:1;display:flex;flex-direction:column;gap:2px}.stepTtl b{font-size:14px;font-weight:600}.stepTtl i{font-size:11.5px;color:var(--mut);font-style:normal}
.stepStatus{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;padding:4px 9px;border-radius:6px}
.stepStatus.ok{background:#13282a;color:#5fd6d6;border:1px solid #1f4444}.stepStatus.soon{background:#2a1a10;color:#d9a23b;border:1px solid #5a4420}
.chev{color:var(--mut);font-size:12px;width:14px}
.stepBody{padding:0}
.soon{padding:26px 22px;color:var(--mut);font-size:13px;line-height:1.6;max-width:760px}

.grid3{display:grid;grid-template-columns:230px 1fr 256px;gap:1px;background:var(--bd)}
@media(max-width:1080px){.grid3{grid-template-columns:1fr}}
.col{background:var(--panel);padding:16px 15px}
.cstage{background:var(--bg);display:flex;flex-direction:column;min-height:480px}
.legend{display:flex;gap:13px;flex-wrap:wrap;padding:12px 16px;font-size:10.5px;color:var(--mut)}
.legend span{display:flex;gap:5px;align-items:center}.legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
.sheet{flex:1;margin:0 16px;background:#f6f7f3;border-radius:11px;border:1px solid var(--bd);overflow:hidden;min-height:360px;touch-action:none;display:flex;align-items:center;justify-content:center}
.noRes,.noRes2{color:var(--mut);font-size:13px;padding:30px;text-align:center;line-height:1.6}.noRes2{padding:14px}
.num{margin-bottom:12px}.fhd{display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:6px}.fhd .mono{color:var(--cy)}
input[type=range]{width:100%;accent-color:var(--cy);height:4px}
.litem{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--p2);border:1px solid var(--bd);color:var(--tx);padding:10px 11px;border-radius:8px;font-size:12px;cursor:pointer;margin-bottom:7px}
.litem.on{border-color:var(--cy);background:#0e2626}
.src{font-size:9px;text-transform:uppercase;padding:3px 6px;border-radius:5px;background:#232b35;color:var(--mut)}.src.user{background:#0e2626;color:var(--cy)}
.hint{font-size:11px;color:var(--mut);line-height:1.5;margin-top:12px}.hint b{color:var(--cy)}
.conn{background:var(--p2);border:1px solid var(--bd);border-radius:9px;padding:9px;margin-bottom:8px;cursor:pointer}.conn.on{border-color:var(--cy)}
.connTop{display:flex;align-items:center;gap:7px;margin-bottom:8px}.cdot{width:11px;height:11px;border-radius:50%;flex:none}
.connTop select{flex:1;background:var(--bg);border:1px solid var(--bd);color:var(--tx);border-radius:6px;padding:5px;font-size:11px}
.del{width:22px;height:22px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--mut);cursor:pointer}
.connRow{display:flex;align-items:center;gap:7px;margin-top:5px}.connRow .lbl,.wp span{font-size:10px;color:var(--mut);width:42px;flex:none;text-transform:uppercase}
.sideBtns{display:flex;gap:3px;flex:1}.sideBtns button{flex:1;background:var(--bg);border:1px solid var(--bd);color:var(--mut);padding:5px 1px;border-radius:5px;font-size:10px;cursor:pointer}.sideBtns button.on{border-color:var(--cy);color:var(--cy)}
.rt{display:flex;gap:4px}.rt button{background:var(--bg);border:1px solid var(--bd);color:var(--mut);padding:5px 11px;border-radius:6px;font-size:11px;cursor:pointer}.rt button.on{border-color:var(--cy);color:var(--cy)}
.wgrid{flex-wrap:wrap}.wgrid button{flex:1;min-width:42px}
.wp{margin-bottom:6px}.wp>span{display:block;margin-bottom:6px}
.add,.regen,.reset{width:100%;border-radius:8px;font-size:12px;cursor:pointer;padding:9px}
.add{background:var(--bg);border:1px dashed var(--bd);color:var(--mut);margin-top:2px}.add:hover{border-color:var(--cy);color:var(--cy)}
.reset,.regen{background:var(--p2);border:1px solid var(--bd);color:var(--tx);margin-top:14px}.reset:hover,.regen:hover{border-color:var(--cy)}
.oriBar{margin:12px 16px;padding:11px 14px;border-radius:9px;background:#0e2626;border:1px solid #16494933;color:#7fdede;font-size:12px;line-height:1.45}.oriBar.warn{background:#2a1410;border-color:#5a2a22;color:#f08a78}
.addRow{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}.addRow button{background:var(--bg);border:1px solid var(--bd);color:var(--mut);padding:7px;border-radius:7px;font-size:11.5px;cursor:pointer;text-align:left}.addRow button:hover{border-color:var(--cy);color:var(--cy)}
.progList{display:flex;flex-direction:column;gap:5px}.pItem{display:flex;flex-direction:column;background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:7px 10px;font-size:12px}.pItem button{background:none;border:none;color:var(--mut);cursor:pointer;font-size:15px}
.pItem.door{border-color:#2f4a63}
.pTop{display:flex;justify-content:space-between;align-items:center}
.dCfg{display:flex;flex-direction:column;gap:5px;margin-top:8px;border-top:1px solid var(--bd);padding-top:8px}
.dRow{display:flex;align-items:center;gap:7px}.dRow>span{font-size:9.5px;color:var(--mut);width:36px;flex:none;text-transform:uppercase}
.rt3{display:flex;gap:3px;flex:1;flex-wrap:wrap}.rt3 button{flex:1;min-width:30px;background:var(--bg);border:1px solid var(--bd);color:var(--mut);padding:5px 2px;border-radius:5px;font-size:10px;cursor:pointer}.rt3 button.on{border-color:#5aa9e6;color:#7fb8e6}
.rt3.wrap button{min-width:24px}
.warnNote{font-size:10.5px;color:#d9a23b;background:#2a1a10;border:1px solid #5a4420;border-radius:7px;padding:9px;margin-top:10px;line-height:1.4}
.zone{background:var(--p2);border:1px solid #4a2a26;border-radius:7px;padding:8px 10px;margin-top:7px}
.zTop{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#e08070}.zTop button{background:none;border:none;color:var(--mut);cursor:pointer;font-size:15px}
.zGrid{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:6px}
.znum{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--mut)}.znum>span{width:10px}.znum input{flex:1;accent-color:#e2553f;height:3px}.znum b{width:34px;text-align:right;font-size:10px;color:var(--tx)}
.ifaceNote{font-size:10.5px;color:#7fb8e6;background:#0e1e2e;border:1px solid #234a63;border-radius:7px;padding:10px;margin-top:12px;line-height:1.5}
.softTgl{display:flex;gap:8px;align-items:center;font-size:12px;cursor:pointer;margin-top:16px}
.softNote{font-size:10.5px;color:var(--mut);margin-top:6px;line-height:1.45}
.poolBar{display:flex;gap:7px;align-items:center;padding:12px 16px;flex-wrap:wrap}.poolBar .mono{font-size:11px;color:var(--mut);margin-right:4px}
.thumb{width:34px;height:30px;border-radius:7px;border:1px solid var(--bd);background:var(--p2);color:var(--mut);cursor:pointer;font-size:11px}.thumb.on{border-color:var(--cy);color:var(--cy)}
.check{font-size:12px;padding:8px 11px;border-radius:7px;margin-bottom:6px;background:#13282a;color:#7fdede;border:1px solid #1f4444}
.soft2{font-size:11.5px;background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:9px 11px;margin-bottom:6px;line-height:1.5;position:relative;padding-left:24px}
.soft2 .sw{position:absolute;left:9px;top:11px;width:9px;height:9px;border-radius:2px;background:#c0392b}.soft2.none{padding-left:11px;color:var(--mut)}
.soft2 .mono{color:var(--mut)}
.drain{font-size:11.5px;line-height:1.5;color:var(--tx)}.drain .mono{color:var(--cy);font-size:14px}.drain i{color:var(--mut);font-size:10.5px}
.routeList{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.routeItem{display:flex;justify-content:space-between;gap:8px;align-items:center;background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:8px 9px;font-size:11px;color:var(--tx)}
.routeItem.wall{border-color:#244662}.routeItem.floor{border-color:#5a4420}.routeItem.blocked{border-color:#7a3028;color:#f08a78}
.routeItem b{color:var(--cy);font-size:10.5px;white-space:nowrap}
.abBox{background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
.abBtns{display:grid;grid-template-columns:1fr 1fr;gap:7px}.abBtns button{border:1px solid var(--bd);background:var(--bg);color:var(--tx);border-radius:7px;padding:8px;cursor:pointer;font-size:12px}.abBtns button:hover{border-color:var(--cy);color:var(--cy)}
.prefBars{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10.5px;color:var(--mut)}.prefBars span{background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:6px}.prefBars b{color:var(--cy);float:right}
.conv{font-size:10.5px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:7px;background:var(--bg)}.conv.on{color:#7fdede;border-color:#1f4444;background:#13282a}
.channelBench{display:flex;flex-direction:column;gap:8px}
.channelCard{background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:9px;display:flex;flex-direction:column;gap:7px}.channelCard.off{opacity:.52}
.chTop{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px}.chTop label{display:flex;align-items:center;gap:6px;color:var(--tx)}.chTop span{font-size:9px;color:var(--mut);text-transform:uppercase}
.chScope{display:grid;grid-template-columns:1fr 1fr;gap:5px}.chScope button{background:var(--bg);border:1px solid var(--bd);color:var(--mut);border-radius:6px;padding:5px;font-size:10px;cursor:pointer}.chScope button.on{border-color:var(--cy);color:var(--cy)}
.chSlider{display:grid;grid-template-columns:38px 1fr 28px;gap:6px;align-items:center;font-size:10px;color:var(--mut)}.chSlider input{height:3px}.chSlider b{color:var(--cy);text-align:right}
.chBars{display:grid;gap:4px}.chBars span{position:relative;overflow:hidden;background:var(--bg);border:1px solid var(--bd);border-radius:5px;padding:4px 6px;font-size:9.5px;color:var(--mut)}.chBars span:before{content:"";position:absolute;inset:0 auto 0 0;width:var(--w);background:#16b3b333}.chBars span{z-index:0}.chBars span::after{content:"";position:relative}
.chScore{font-size:10px;color:var(--mut)}.chScore b{float:right;color:var(--cy)}
.refBox{width:100%;min-height:420px;resize:vertical;background:var(--bg);border:1px solid var(--bd);border-radius:8px;color:var(--tx);font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:10.5px;line-height:1.45;padding:10px}
.ruleStage{flex:1;margin:0 16px 16px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;align-content:start}
.ruleCard{background:var(--panel);border:1px solid var(--bd);border-radius:8px;padding:12px}.rHead{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}.rHead b{font-size:13px}.rHead span{font-size:10px;color:var(--mut)}
.metricCard{border-color:#1f4444;background:#13282a}
.envGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.envGrid span{background:var(--bg);border:1px solid var(--bd);border-radius:6px;padding:7px;font-size:10.5px;color:var(--mut)}.envGrid b{float:right;color:var(--cy)}
.ruleMeta,.refs{font-size:10.5px;color:var(--mut);line-height:1.45;margin-top:9px}.refs{color:#7fb8e6}
.libRule{background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:9px;margin-bottom:7px;display:flex;flex-direction:column;gap:4px}.libRule b{font-size:12px}.libRule span{color:var(--cy);font-size:11px}.libRule i{color:var(--mut);font-size:10px;font-style:normal}

/* 4.0 — dva objektiva + faze workflowa */
.lensTabs{display:flex;gap:4px;background:var(--p2);border:1px solid var(--bd);border-radius:9px;padding:3px}
.lensTabs button{background:none;border:none;color:var(--mut);padding:6px 14px;border-radius:7px;font-size:12px;cursor:pointer}
.lensTabs button.on{background:#0e2626;color:var(--cy)}
.wf{display:flex;flex-direction:column;gap:10px}
.phaseNav{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:760px){.phaseNav{grid-template-columns:1fr 1fr}}
.phaseBtn{display:flex;align-items:center;gap:10px;text-align:left;background:var(--panel);border:1px solid var(--bd);border-radius:11px;padding:11px 13px;cursor:pointer;color:var(--tx)}
.phaseBtn.on{border-color:var(--cy);background:#0e1f1f}
.phaseBtn.sep{border-style:dashed}
.phaseTag{width:28px;height:28px;border:1.5px solid var(--cy);border-radius:8px;display:grid;place-items:center;color:var(--cy);font-weight:700;font-size:12px;flex:none}
.phaseTtl{display:flex;flex-direction:column;gap:2px;min-width:0}.phaseTtl b{font-size:13px}.phaseTtl i{font-size:10.5px;color:var(--mut);font-style:normal;line-height:1.3}
.phaseBody{background:var(--panel);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.phaseLead{padding:14px 18px;font-size:12px;line-height:1.55;color:#9fb0bd;border-bottom:1px solid var(--bd);background:var(--p2)}
.grid2c{display:grid;grid-template-columns:240px 1fr;gap:1px;background:var(--bd)}
.grid2c.wide{grid-template-columns:1fr 290px}
@media(max-width:1080px){.grid2c,.grid2c.wide{grid-template-columns:1fr}}
.phaseCta{display:flex;justify-content:flex-end;padding:14px 18px;background:var(--panel)}
.ctaNext{background:#0e2626;border:1px solid #1f4444;color:var(--cy);border-radius:8px;padding:9px 18px;font-size:12.5px;cursor:pointer}.ctaNext:hover{border-color:var(--cy)}
`;





