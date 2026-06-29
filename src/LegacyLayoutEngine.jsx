import React, { useState, useRef, useMemo, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { baseLib } from "./elements/library";
import { CONNECTION_META as CONN, SIDE_LABELS as SIDES, MEDIA_PROFILE, connectionZ, isDoor, orientation, serviceSides } from "./elements/model";
import { connectionPoint as connXY, nearestEdge, wallEdge, doorSwing } from "./engine/geometry";
import { generateLayoutPool, searchLayouts } from "./engine/generator";
import { routeServices, placedConnectionPoint, projectToWetWall } from "./engine/routing";
import { checkFeasibility } from "./engine/feasibility";
import { initialPreferenceState, rankByPreference, recordPreference } from "./engine/preference";
import { nextPair, suggestedExplore } from "./engine/active";
import { buildFreeGrid, findPath } from "./engine/freespace";
import { buildElevation } from "./engine/elevation";
import { elementBox, humanUsageBox } from "./engine/volume";
import { doorInteriorPoint, usagePoint } from "./engine/evaluator";
import { measureGeneralization, measureInductionHoldout, measurePreferenceGain } from "./engine/metrics";
import { defaultChannels, effectiveWeight, learnChannelsFromPreference, rankByChannels, scoreCandidateChannels } from "./engine/channels";
import { applyInducedRules, induceRules, parseReferenceJson } from "./rules/induction";
import { clamp, uid } from "./shared/math";
import { loadJson, saveJson } from "./shared/storage";
import { ACCESSIBLE_BATHROOM_REFS, CLASSIC_BATHROOM_REFS } from "./training/classicBathroomRefs";
import { generateFloorLayoutPool } from "./project/floorGenerator";
import { estimateProjectArea } from "./project/roomTypes";
import { floorSignals, initialFloorPreferenceState, rankFloorLayouts, recordFloorPreference, scoreFloorLayout } from "./project/floorPreference";
import { roomConstraintsFromPlacedRoom } from "./project/roomAdapter";
import { extractFloorStrategyObservations, induceFloorStrategyProfile, rankFloorLayoutsByProfile, scoreFloorLayoutByProfile } from "./ifc/floorStrategy";
import { IFC_REFERENCE_SETS } from "./training/ifcReferenceSets";
import { projectTrainingFromIfcSummary } from "./project/projectTraining";

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
  const [phase,setPhase]=usePersistentState("floorplanner.phase","projekt");
  const [setupLeftPct,setSetupLeftPct]=usePersistentState("floorplanner.setupLeftPct",42);
  const setupGridRef=useRef(null);
  const rp=useRoomProject(library);
  const beginSetupResize=(ev)=>{
    ev.preventDefault();
    const grid=setupGridRef.current;
    if(!grid) return;
    const rect=grid.getBoundingClientRect();
    const move=(e)=>{
      const x=e.clientX??e.touches?.[0]?.clientX;
      if(x==null) return;
      setSetupLeftPct(clamp(((x-rect.left)/rect.width)*100,28,62));
    };
    const done=()=>{
      window.removeEventListener("pointermove",move);
      window.removeEventListener("pointerup",done);
    };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",done);
    move(ev);
  };
  const phases=[
    {id:"faza0",tag:"0",title:"Šolanje",sub:"indukcija — napolni lečo znanja (občasno)"},
    {id:"projekt",tag:"P",title:"Projekt",sub:"sobe + hodniki — A/B izbor etaže"},
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
    {phase==="faza0" && <div className="phaseBody"><div className="phaseLead">Faza 0 — šolanje: vržeš noter primere dobre prakse, sistem izlušči znanje (envelope, prior kanalov). Zgodi se enkrat/občasno, ne pri vsakem projektu.</div><O9 library={library} setLibrary={setLibrary} onOpenProject={()=>setPhase("projekt")}/></div>}
    {phase==="projekt" && <ProjectWorkflow onContinue={(room)=>{if(room)rp.applyRoomConstraints(roomConstraintsFromPlacedRoom(room));setPhase("korak2");}}/>}
    {phase==="korak1" && <div className="phaseBody"><O1 library={library} setLibrary={setLibrary}/></div>}
    {phase==="korak2" && <div className="phaseBody">
      <div className="phaseLead">Korak 2 — omejitve sobe: »tako je«. Velikost, vrata, prepovedane cone, fiksni elementi. Ta nabor je vmesnik, ki ga kasneje napolni engine za razporeditev sob.</div>
      <div ref={setupGridRef} className="grid2c setupGrid resizableSetup" style={{"--setup-left":`${setupLeftPct}%`}}>
        <ConstraintsPanel rp={rp} library={library}/>
        <button className="colResize" onPointerDown={beginSetupResize} title="Povleci za širino risbe" aria-label="Nastavi širino stolpcev"><span/></button>
        <StagePanel rp={rp} library={library}/>
      </div>
      <div className="phaseCta"><button className="ctaNext" onClick={()=>setPhase("korak3")}>Naprej → generiranje in izbiranje</button></div>
    </div>}
    {phase==="korak3" && <div className="phaseBody">
      <div className="phaseLead">Korak 3 — generiranje in izbiranje: engine vrže variacije, ti izbiraš boljše. A/B par izbere aktivno učenje (»Ugani kdo«) po informacijskem donosu.</div>
      <div className="grid2c wide">
        <ABStagePanel rp={rp}/>
        <ReviewPanel rp={rp} showAB={false} showBench={false}/>
      </div>
    </div>}
  </div>;
}

const DEFAULT_PROJECT = {
  id:"demo-project",
  name:"Demo etaža",
  boundary:{area:80,width:10,depth:8},
  entrances:[{id:"entry-1",wall:"S",position:0.5,width:1.2}],
  corridorPolicy:{minWidth:1.2,mainWidth:1.8,sideWidth:1.2},
  rooms:[
    {id:"wc-men",type:"wc",wcKind:"male",count:1},
    {id:"wc-women",type:"wc",wcKind:"female",count:1},
    {id:"office",type:"office",count:2,workstations:1},
    {id:"corridor",type:"corridor",count:1}
  ]
};

function ProjectWorkflow({onContinue}){
  const [brief,setBrief]=usePersistentState("floorplanner.project.brief",DEFAULT_PROJECT);
  const [pref,setPref]=usePersistentState("floorplanner.project.preference",initialFloorPreferenceState);
  const [strategyProfile,setStrategyProfile]=usePersistentState("floorplanner.project.strategyProfile",null);
  const [pairIndex,setPairIndex]=usePersistentState("floorplanner.project.pairIndex",0);
  const [selectedRoomId,setSelectedRoomId]=usePersistentState("floorplanner.project.selectedRoomId",null);
  const updateBoundary=(patch)=>setBrief(b=>({...b,boundary:{...b.boundary,...patch}}));
  const updateRoom=(type,patch)=>setBrief(b=>({...b,rooms:b.rooms.map(r=>r.type===type?{...r,...patch}:r)}));
  const upsertRoom=(id,type,patch)=>setBrief(b=>{
    const rooms=b.rooms||[];
    const exists=rooms.some(r=>r.id===id);
    return {...b,rooms:exists?rooms.map(r=>r.id===id?{...r,...patch}:r):[...rooms,{id,type,count:0,...patch}]};
  });
  const projectRoom=(id,type,wcKind)=>{
    const rooms=brief.rooms||[];
    return rooms.find(r=>r.id===id)||rooms.find(r=>r.type===type&&r.wcKind===wcKind)||rooms.find(r=>type==="wc"&&wcKind==="unisex"&&r.type==="wc"&&!r.wcKind)||{id,type,wcKind,count:0};
  };
  const corridorPolicy=brief.corridorPolicy||{minWidth:1.2,mainWidth:1.8,sideWidth:1.2};
  const updateCorridorPolicy=(patch)=>setBrief(b=>{
    const next={...(b.corridorPolicy||corridorPolicy),...patch};
    next.minWidth=round1(next.minWidth);
    next.mainWidth=Math.max(next.minWidth,round1(next.mainWidth));
    next.sideWidth=Math.max(next.minWidth,Math.min(next.mainWidth,round1(next.sideWidth)));
    return {...b,corridorPolicy:next};
  });
  const entrances=brief.entrances?.length?brief.entrances:[{id:"entry-1",wall:"S",position:0.5,width:1.2}];
  const setEntrance=(id,patch)=>setBrief(b=>({...b,entrances:entrances.map(e=>e.id===id?{...e,...patch}:e)}));
  const addEntrance=()=>setBrief(b=>({...b,entrances:[...entrances,{id:uid(),wall:"S",position:0.5,width:1.2}]}));
  const removeEntrance=(id)=>setBrief(b=>({...b,entrances:entrances.filter(e=>e.id!==id)}));
  const pool=useMemo(()=>generateFloorLayoutPool(brief),[brief]);
  const ranked=useMemo(()=>strategyProfile?rankFloorLayoutsByProfile(pool,strategyProfile):rankFloorLayouts(pool,pref.weights),[pool,pref.weights,strategyProfile]);
  const champion=strategyProfile?ranked[0]:(ranked.find(l=>l.id===pref.championId)||ranked[0]);
  const challengers=ranked.filter(l=>!champion||l.id!==champion.id);
  const challenger=challengers[pairIndex%Math.max(1,challengers.length)]||ranked[1]||champion;
  const pair=[champion,challenger].filter(Boolean);
  const chooseFloor=(winner,loser)=>{
    if(!winner||!loser) return;
    setPref(p=>recordFloorPreference(p,winner,loser));
    setPairIndex(i=>i+1);
  };
  const equalFloor=()=>setPairIndex(i=>i+1);
  const summary=estimateProjectArea(brief);
  const selectedRoom=champion?.rooms.find(r=>r.id===selectedRoomId)||champion?.rooms[0];
  const maleWc=projectRoom("wc-men","wc","male");
  const femaleWc=projectRoom("wc-women","wc","female");
  const unisexWc=projectRoom("wc-unisex","wc","unisex");
  return <div className="phaseBody">
    <div className="phaseLead">Projekt — najprej razporedimo sobe in hodnike v dano kvadraturo. To je vmesni A/B korak: izbereš boljši tloris etaže, sistem pa se uči preference pred notranjo razporeditvijo sob.</div>
    <div className="projectGrid">
      <aside className="col projectInputs">
        <div className="eyebrow">Okvir etaže</div>
        <ProjectNum label="Površina" unit="m²" v={brief.boundary.area} set={v=>updateBoundary({area:v,width:brief.boundary.width,depth:round1(v/Math.max(brief.boundary.width||1,1))})} min={20} max={2500} step={5}/>
        <ProjectNum label="Širina" unit="m" v={brief.boundary.width} set={v=>updateBoundary({width:v,area:round1(v*(brief.boundary.depth||1))})} min={4} max={120} step={0.5}/>
        <ProjectNum label="Globina" unit="m" v={brief.boundary.depth} set={v=>updateBoundary({depth:v,area:round1((brief.boundary.width||1)*v)})} min={4} max={80} step={0.5}/>
        <div className="eyebrow mt">Glavni vhodi</div>
        <div className="entranceList">
          {entrances.map((entry,i)=><div key={entry.id} className="entranceItem">
            <div className="zTop"><span>vhod {i+1}</span><button onClick={()=>removeEntrance(entry.id)} disabled={entrances.length<=1}>×</button></div>
            <div className="dRow"><span>zid</span><div className="rt3 wrap">{[["N","S"],["E","V"],["S","J"],["W","Z"]].map(([v,l])=><button key={v} className={entry.wall===v?"on":""} onClick={()=>setEntrance(entry.id,{wall:v})}>{l}</button>)}</div></div>
            <ProjectNum label="Pozicija" unit="%" v={Math.round((entry.position??0.5)*100)} set={v=>setEntrance(entry.id,{position:clamp(v/100,0,1)})} min={0} max={100} step={5}/>
            <ProjectNum label="Širina" unit="m" v={entry.width??1.2} set={v=>setEntrance(entry.id,{width:v})} min={0.8} max={3} step={0.1}/>
          </div>)}
        </div>
        <button className="add" onClick={addEntrance}>+ vhod</button>
        <div className="eyebrow mt">Širine hodnikov</div>
        <ProjectNum label="Minimalna" unit="m" v={corridorPolicy.minWidth} set={v=>updateCorridorPolicy({minWidth:v})} min={0.9} max={3} step={0.1}/>
        <ProjectNum label="Glavni hodnik" unit="m" v={corridorPolicy.mainWidth} set={v=>updateCorridorPolicy({mainWidth:v})} min={0.9} max={4} step={0.1}/>
        <ProjectNum label="Stranski hodnik" unit="m" v={corridorPolicy.sideWidth} set={v=>updateCorridorPolicy({sideWidth:v})} min={0.9} max={4} step={0.1}/>
        <div className="softNote">Glavni hodnik je širša hrbtenica; stranski hodniki povežejo vhode do nje. Kasneje te širine induciramo iz IFC referenc.</div>
        <div className="eyebrow mt">Dokaz učenja</div>
        <div className="presetRow">
          <button onClick={()=>{setStrategyProfile(makeStrategyProfile("central"));setPairIndex(0);}}>Centralni WC</button>
          <button onClick={()=>{setStrategyProfile(makeStrategyProfile("dispersed"));setPairIndex(0);}}>Razpršeni WC</button>
        </div>
        {strategyProfile&&<div className="softNote">Aktiven profil: <b>{strategyProfile.name}</b> · cluster {Math.round(strategyProfile.preferClusteredWc*100)} · spread {Math.round(strategyProfile.preferSpreadWc*100)} · križni hodniki {Math.round(strategyProfile.preferInternalCorridors*100)}</div>}
        <div className="eyebrow mt">Program sob</div>
        <ProjectNum label="Moški WC" unit="" v={maleWc.count??0} set={v=>upsertRoom(maleWc.id,"wc",{wcKind:"male",count:Math.round(v)})} min={0} max={30} step={1}/>
        <ProjectNum label="Ženski WC" unit="" v={femaleWc.count??0} set={v=>upsertRoom(femaleWc.id,"wc",{wcKind:"female",count:Math.round(v)})} min={0} max={30} step={1}/>
        <ProjectNum label="Unisex WC" unit="" v={unisexWc.count??0} set={v=>upsertRoom(unisexWc.id,"wc",{wcKind:"unisex",count:Math.round(v)})} min={0} max={30} step={1}/>
        <ProjectNum label="Pisarne" unit="" v={brief.rooms.find(r=>r.type==="office")?.count??0} set={v=>updateRoom("office",{count:Math.round(v)})} min={0} max={100} step={1}/>
        <ProjectNum label="Mest / pisarno" unit="" v={brief.rooms.find(r=>r.type==="office")?.workstations??1} set={v=>updateRoom("office",{workstations:Math.round(v)})} min={1} max={8} step={1}/>
        <div className="metricStack">
          <span>program <b>{summary.roomArea.toFixed(1)} m²</b></span>
          <span>hodnik ocena <b>{summary.corridorArea.toFixed(1)} m²</b></span>
          <span>skupaj <b>{summary.totalArea.toFixed(1)} m²</b></span>
          <span className={summary.fitsBoundary?"ok":"bad"}>{summary.fitsBoundary?"gre v kvadraturo":"presega kvadraturo"} <b>{summary.remainingArea.toFixed(1)} m²</b></span>
        </div>
      </aside>
      <main className="projectStage">
        <div className="floorProgress">
          <span>Kandidati <b className="mono">{pool.length}</b></span>
          <span>Primerjave <b className="mono">{pref.comparisons}</b></span>
          <span>Prvak <b className="mono">{champion?.id||"-"}</b></span>
        </div>
        <div className="floorBest">
          <div className="floorHead"><b>Trenutno najboljša etaža</b><span>{champion?.variant}</span></div>
          {champion&&<FloorSvg layout={champion}/>}
        </div>
        <div className="floorPair">
          {pair.map((layout,i)=><div key={layout.id} className="floorCard">
            <div className="floorHead"><b>{i===0?"A":"B"} · score {((strategyProfile?scoreFloorLayoutByProfile(layout,strategyProfile):scoreFloorLayout(layout,pref.weights))*100).toFixed(0)}</b><span>{layout.variant}</span></div>
            <FloorSvg layout={layout}/>
            <FloorSignals layout={layout}/>
          </div>)}
        </div>
        <div className="abChoiceBtns floorBtns">
          <button onClick={()=>chooseFloor(pair[0],pair[1])}>A je boljša</button>
          <button onClick={equalFloor}>enakovredni</button>
          <button onClick={()=>chooseFloor(pair[1],pair[0])}>B je boljša</button>
          <button className="champStay" onClick={()=>{setPairIndex(i=>i+1)}}>trenutna ostane</button>
        </div>
      </main>
      <aside className="col projectExplain">
        <div className="eyebrow">Kaj se uči</div>
        <div className="metricStack">
          {Object.entries(pref.weights).map(([k,v])=><span key={k}>{floorWeightLabel(k)} <b>{Math.round(v*100)}</b></span>)}
        </div>
        <div className="softNote">To je isti princip kot A/B pri notranji postavitvi, samo da izbiraš razporeditev sob. Naslednji korak bo, da izbrani kandidat napolni posamezne sobe z opremo.</div>
        <div className="eyebrow mt">Soba za notranjost</div>
        <div className="roomPick">
          {(champion?.rooms||[]).map(room=><button key={room.id} className={selectedRoom?.id===room.id?"on":""} onClick={()=>setSelectedRoomId(room.id)}>
            <b>{room.name}</b><span>{room.w.toFixed(1)}×{room.d.toFixed(1)} m</span>
          </button>)}
        </div>
        <button className="regen" onClick={()=>onContinue(selectedRoom)}>Naprej → notranjost izbrane sobe</button>
      </aside>
    </div>
  </div>;
}

function FloorSvg({layout}){
  const W=layout.boundary.width, D=layout.boundary.depth;
  const pad=clamp(Math.max(W,D)*0.04,0.6,2);
  const fontSize=clamp(Math.max(W,D)*0.018,0.28,1.1);
  const strokeWidth=clamp(Math.max(W,D)*0.0018,0.025,0.08);
  const vb=`0 0 ${W+pad*2} ${D+pad*2}`;
  const rooms=[...layout.rooms,layout.corridor,...(layout.corridorLinks||[])];
  return <svg className="floorSvg" viewBox={vb} role="img">
    <rect x={pad} y={pad} width={W} height={D} fill="#f6f7f3" stroke="#2b3138" strokeWidth={strokeWidth}/>
    {rooms.map(r=><g key={r.id}>
      <rect x={pad+r.x} y={pad+r.y} width={r.w} height={r.d} fill={roomColor(r.type)} stroke={r.type==="corridor"?"#8a6d19":"#22313a"} strokeWidth={r.type==="corridor"?strokeWidth*1.5:strokeWidth}/>
      <text x={pad+r.x+r.w/2} y={pad+r.y+r.d/2} textAnchor="middle" dominantBaseline="middle" fontSize={roomLabelSize(r,fontSize)} fontWeight={r.type==="wc"?"700":"400"} fill="#10161b">{roomLabel(r)}</text>
      {r.doorToCorridor&&<rect x={pad+r.x+r.w/2-0.35} y={pad+r.y-strokeWidth} width="0.7" height={strokeWidth*2} fill="#e2553f"/>}
    </g>)}
    {(layout.entrances||[]).map(e=><EntranceMark key={e.id} entry={e} pad={pad} W={W} D={D}/>)}
  </svg>;
}

function EntranceMark({entry,pad,W,D}){
  const width=Math.min(entry.width||1.2,entry.wall==="N"||entry.wall==="S"?W:D);
  const pos=clamp(entry.position??0.5,0,1);
  const horizontal=entry.wall==="N"||entry.wall==="S";
  const x=entry.wall==="W"?pad-0.08:entry.wall==="E"?pad+W-0.02:pad+pos*W-width/2;
  const y=entry.wall==="S"?pad-0.08:entry.wall==="N"?pad+D-0.02:pad+pos*D-width/2;
  return <g>
    <rect x={x} y={y} width={horizontal?width:0.1} height={horizontal?0.1:width} fill="#e2553f"/>
    <circle cx={horizontal?x+width/2:x+0.05} cy={horizontal?y+0.05:y+width/2} r="0.18" fill="#e2553f"/>
  </g>;
}

function FloorSignals({layout}){
  const s=floorSignals(layout);
  return <div className="floorSignals">
    {Object.entries(s).map(([k,v])=><span key={k}>{floorWeightLabel(k)} <b>{Math.round(v*100)}</b></span>)}
    {layout.warnings.map(w=><span key={w} className="bad">{w}</span>)}
  </div>;
}

function roomColor(type){return type==="corridor"?"#d6b652":type==="wc"?"#7fdede":"#9fc8f0";}
function roomLabel(room){
  if(room.type==="wc"&&room.wcKind==="male") return "♂";
  if(room.type==="wc"&&room.wcKind==="female") return "♀";
  if(room.type==="wc") return "WC";
  return room.name;
}
function roomLabelSize(room,fontSize){
  return room.type==="wc"?fontSize*1.8:fontSize;
}
function floorWeightLabel(key){return ({compactness:"izraba",corridorEfficiency:"hodnik",wetGrouping:"mokri sklop",officeFrontage:"pisarne/okna"})[key]||key;}
function round1(v){return Math.round(v*10)/10;}
function makeStrategyProfile(kind){
  const plan=kind==="dispersed"
    ? strategyPlan("dispersed-reference",[0,9000,18000,27000],2)
    : strategyPlan("central-reference",[0,700,1300,1900],0);
  return induceFloorStrategyProfile(kind==="dispersed"?"razpršeni WC reference":"centralni WC reference",extractFloorStrategyObservations(plan));
}
function strategyPlan(sourceId,wcOffsets,sideCorridors){
  return {sourceId,name:sourceId,corridors:[
    {sourceId:"main",name:"Main corridor",role:"main",width:sideCorridors>0?2200:1800},
    ...Array.from({length:sideCorridors},(_,i)=>({sourceId:`side-${i+1}`,name:`Side ${i+1}`,role:"side",width:1300}))
  ],rooms:wcOffsets.map((offset,index)=>({sourceId:`wc-${index+1}`,name:`WC ${index+1}`,roomType:"wc",w:2000,d:2400,elements:[{sourceId:`toilet-${index+1}`,name:"Toilet",elementKey:"toilet",x:offset,y:0,w:400,d:600,facing:"N"}]}))};
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

function O9({library,setLibrary,onOpenProject}){
  const [raw,setRaw]=usePersistentState("floorplanner.o9.references",SAMPLE_REFS);
  const [rules,setRules]=usePersistentState("floorplanner.o9.rules",[]);
  const [metrics,setMetrics]=usePersistentState("floorplanner.o9.metrics",null);
  const [trainingStatus,setTrainingStatus]=useState("");
  const [err,setErr]=useState("");
  const loadPreset=(items)=>setRaw(JSON.stringify(items,null,2));
  const applyProjectTraining=(summary)=>{
    const training=projectTrainingFromIfcSummary(summary);
    saveJson(typeof window==="undefined"?undefined:window.localStorage,"floorplanner.project.brief",training.brief);
    saveJson(typeof window==="undefined"?undefined:window.localStorage,"floorplanner.project.strategyProfile",training.profile);
    saveJson(typeof window==="undefined"?undefined:window.localStorage,"floorplanner.project.pairIndex",0);
    setTrainingStatus(`${training.name}: ${training.evidence.rooms} sob, ${training.evidence.wc} WC, ${training.evidence.office} pisarn, hodnik ${training.evidence.mainCorridorMm} mm`);
    onOpenProject?.();
  };
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
      <div className="eyebrow">IFC učne reference</div>
      <div className="ifcTrainingList">
        {IFC_REFERENCE_SETS.map(summary=>{
          const training=projectTrainingFromIfcSummary(summary);
          return <div key={summary.id} className="ifcTrainingCard">
            <div className="rHead"><b>{summary.name}</b><span>{summary.spaces} IfcSpace</span></div>
            <div className="envGrid">
              <span>sob <b>{training.evidence.rooms}</b></span>
              <span>WC <b>{training.evidence.wc}</b></span>
              <span>pisarne <b>{training.evidence.office}</b></span>
              <span>hodnik <b>{training.evidence.mainCorridorMm} mm</b></span>
            </div>
            <div className="ruleMeta">vrata {summary.entityCounts.IfcDoor||0} · okna {summary.entityCounts.IfcWindow||0} · file {summary.file}</div>
            <button className="regen" onClick={()=>applyProjectTraining(summary)}>Uporabi v projektu</button>
          </div>;
        })}
      </div>
      {trainingStatus&&<div className="softNote">Uporabljeno: {trainingStatus}</div>}
      <div className="eyebrow">Reference JSON</div>
      <div className="presetRow">
        <button onClick={()=>loadPreset(CLASSIC_BATHROOM_REFS)}>Naloži klasične kopalnice</button>
        <button onClick={()=>loadPreset([...CLASSIC_BATHROOM_REFS,...ACCESSIBLE_BATHROOM_REFS])}>+ dostopni primeri</button>
      </div>
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
function ElementMini({el}){
  const R={x:20,y:22,w:72,h:54};
  return <svg viewBox="0 0 112 96" className="elementMini" aria-hidden="true">
    <rect x={R.x} y={R.y} width={R.w} height={R.h} rx="5" fill="#eef1ec" stroke="#2b3138" strokeWidth="4"/>
    <rect x={R.x} y={R.y+R.h} width={R.w} height="14" fill="#d9a23b" opacity=".22"/>
    <line x1={R.x} y1={R.y+R.h+Math.min(18,el.clear.core/45)} x2={R.x+R.w} y2={R.y+R.h+Math.min(18,el.clear.core/45)} stroke="#e2553f" strokeWidth="3"/>
    {serviceSides(el).map(side=>{
      if(side==="back")return <line key={side} x1={R.x} y1={R.y} x2={R.x+R.w} y2={R.y} stroke="#16b3b3" strokeWidth="5"/>;
      if(side==="front")return <line key={side} x1={R.x} y1={R.y+R.h} x2={R.x+R.w} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="5"/>;
      if(side==="left")return <line key={side} x1={R.x} y1={R.y} x2={R.x} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="5"/>;
      return <line key={side} x1={R.x+R.w} y1={R.y} x2={R.x+R.w} y2={R.y+R.h} stroke="#16b3b3" strokeWidth="5"/>;
    })}
    {el.conns.map(c=>{const p=connXY(c,R);return <circle key={c.id} cx={p.x} cy={p.y} r="7" fill={CONN[c.type].color} stroke="#0e1116" strokeWidth="2"/>;})}
  </svg>;
}

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
    <div className="elementCards">
      {Object.entries(library).filter(([,e])=>!isDoor(e)).map(([k,e])=>(
        <button key={k} className={"elementCard "+(sel===k?"on":"")} onClick={()=>{setSel(k);setSelConn(null);}}>
          <ElementMini el={e}/>
          <span className="ecMain"><b>{e.name}</b><i>{e.w}×{e.d}×{e.h??0} mm</i></span>
          <span className={"src "+e.source}>{e.source==="user"?"uporabnik":"privzeto"}</span>
          <span className="ecMeta mono">jedro {e.clear.core} · halo {e.clear.halo}</span>
        </button>
      ))}
    </div>
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
            <div className="connRow"><span className="lbl">višina z</span><input className="zrange" type="range" min="0" max={Math.max(el.h||2000,500)} step="10" value={connectionZ(el,c)} onChange={e=>patch(el=>{el.conns.find(x=>x.id===c.id).z=+e.target.value;})}/><b className="mono">{connectionZ(el,c)}{c.z===undefined?" (sredina)":""}</b></div>
            <div className={"mediaRule "+(MEDIA_PROFILE[c.type].gravity?"grav":"free")}>{MEDIA_PROFILE[c.type].gravity?"⬇ ":"→ "}{MEDIA_PROFILE[c.type].rule}</div>
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
  const [pathMin,setPathMin]=usePersistentState("floorplanner.pathMin",600);   // trdo: pod njo razporeditev ni veljavna
  const [pathWant,setPathWant]=usePersistentState("floorplanner.pathWant",900); // mehko: udobje/srečanje, vpliva na oceno
  const [showPaths,setShowPaths]=usePersistentState("floorplanner.showPaths",true);
  const [pool,setPool]=useState([]); const [idx,setIdx]=useState(0); const [seed,setSeed]=useState(0);
  const [pref,setPref]=usePersistentState("floorplanner.preference",initialPreferenceState);
  const [channels,setChannels]=usePersistentState("floorplanner.channels",defaultChannels);
  useEffect(()=>setChannels(C=>normalizeChannels(C)),[setChannels]);
  const cfg=useMemo(()=>({W,D,wetWall:wet,minAisle:800}),[W,D,wet]);
  // ločen cfg za rangiranje: nosi želeno širino (bere jo kanal path-comfort).
  // Generiranje uporablja `cfg` brez pathWant → mehka želena NE regenerira bazena.
  const scoreCfg=useMemo(()=>({...cfg,pathWant}),[cfg,pathWant]);
  const feasibility=useMemo(()=>checkFeasibility(library,prog,cfg,zones),[library,prog,cfg,zones]);
  // izid iskanja: loči DOKAZANO nemožnost (infeasible) od NISEM NAŠEL (not-found)
  const [search,setSearch]=useState({status:'found',reasons:[],attempts:0,expanded:false});
  const [extraSamples,setExtraSamples]=useState(0); // ročna razširitev iskanja

  useEffect(()=>{
    const res=searchLayouts({library, program:prog, cfg, soft, zones, minPathWidth:pathMin, samples:extraSamples>0?extraSamples:undefined});
    setPool(res.candidates);
    setSearch({status:res.status,reasons:res.reasons,attempts:res.attempts,expanded:res.expanded});
    setIdx(0);
  },[library,prog,W,D,wet,soft,zones,seed,cfg,feasibility,pathMin,extraSamples]);
  const expandSearch=()=>setExtraSamples(s=>(s>0?s:700)*3); // razširi iskanje (več poskusov)

  const cornerEls=prog.filter(p=>{const e=library[p.key];return e&&!isDoor(e)&&serviceSides(e).length>1;});
  const hasDoor=prog.some(p=>isDoor(library[p.key]));
  // ŽIVO rangiranje po testni mizi: bazen razvrsti po preferenci + kanalih sproti,
  // zato izklop kanala / premik priorja / drsnik zaupanja takoj spremenijo, kateri
  // je "best" in vrstni red sličic — kanali dejansko vplivajo, ne le rišejo.
  const ranked=useMemo(()=>rankByChannels(rankByPreference(pool,pref.weights),channels,scoreCfg),[pool,channels,pref.weights,scoreCfg]);
  const [championKey,setChampionKey]=useState(null);
  const [championEvents,setChampionEvents]=useState([]);
  const champion=useMemo(()=>ranked.find(c=>candidateKey(c)===championKey)||ranked[0], [ranked,championKey]);
  const best=champion;
  useEffect(()=>{if(ranked.length>0&&!championKey)setChampionKey(candidateKey(ranked[0]));},[ranked,championKey]);
  const [explore,setExplore]=usePersistentState("floorplanner.explore",0.7);
  const [dismissedPairs,setDismissedPairs]=useState([]);
  const exploitPair=useMemo(()=>champion?championPair(champion,ranked,dismissedPairs):null,[champion,ranked,dismissedPairs]);
  const explorePair=useMemo(()=>nextUndismissedInfoPair(ranked,channels,scoreCfg,dismissedPairs),[ranked,channels,scoreCfg,dismissedPairs]);
  const abPair=useMemo(()=>{
    if(explore>=0.95)return explorePair;
    if(explore<=0.05)return exploitPair;
    const useExplore=((pref.comparisons+1)%10)/10<explore;
    return useExplore?explorePair||exploitPair:exploitPair||explorePair;
  },[explore,explorePair,exploitPair,pref.comparisons]);
  const optionA=abPair?.a, optionB=abPair?.b;
  const bestChannelScores=best?scoreCandidateChannels(best,channels,scoreCfg):null;
  const routing=useMemo(()=>best?routeServices(best.placed,cfg,{allowFloorRoutes}):null,[best,cfg,allowFloorRoutes]);
  // Poti so trak širine = minimalna (trdo). Trasa od vrat do uporabne točke vsakega
  // elementa; najožja točka in mesto blokade so del rezultata (steklena škatla).
  const paths=useMemo(()=>{
    if(!best) return [];
    const fixtures=best.placed.filter(p=>p.kind!=="door");
    const door=best.placed.find(p=>p.kind==="door");
    if(!door||fixtures.length===0) return [];
    const grid=buildFreeGrid(W,D,fixtures.map(elementBox));
    const entry=doorInteriorPoint(door);
    return fixtures.map(f=>({name:f.name,...findPath(grid,entry,usagePoint(f),pathMin)}));
  },[best,W,D,pathMin]);
  // Želena širina (mehko): udobje — koliko najožja pot presega želeno. Vpliva le
  // na to oceno, ne na veljavnost.
  const comfort=useMemo(()=>{
    const reach=paths.filter(p=>p.reachable);
    if(reach.length===0) return null;
    const minW=Math.min(...reach.map(p=>p.minWidth));
    return {minWidth:minW, allOk:reach.length===paths.length, ratio:Math.max(0,Math.min(1,minW/Math.max(pathWant,1)))};
  },[paths,pathWant]);
  const choosePreference=(selected,rejected,mode="choice")=>{
    const selectedKey=candidateKey(selected), championBefore=champion?candidateKey(champion):null;
    const challengerWon=championBefore&&selectedKey!==championBefore;
    setDismissedPairs(P=>[...P,pairKey(selected,rejected)]);
    if(challengerWon) setChampionKey(selectedKey);
    setChampionEvents(E=>[...E.slice(-7),{changed:Boolean(challengerWon),mode}]);
    setPref(prev=>{
      const next=recordPreference(prev,selected,rejected);
      // učenje posodobi LEARNED (ne prior); živo rangiranje (ranked memo) takoj prevzame
      setChannels(C=>learnChannelsFromPreference(C,selected,rejected,scoreCfg));
      setIdx(0);
      return next;
    });
  };
  const chooseChampionStays=(challenger)=>{
    if(!champion||!challenger)return;
    choosePreference(champion,challenger,"champion-stays");
  };
  const chooseEqualPreference=(a,b)=>{
    setDismissedPairs(P=>[...P,pairKey(a,b)]);
    setChampionEvents(E=>[...E.slice(-7),{changed:false,mode:"equal"}]);
    setChannels(C=>C.map(ch=>({...ch,learned:ch.learned*0.98+0.5*0.02})));
    setPref(prev=>({...prev,comparisons:prev.comparisons+1,stableStreak:prev.stableStreak+1,converged:prev.stableStreak+1>=5,dominantSignal:"mixed"}));
  };
  const setChannel=(id,patch)=>setChannels(C=>C.map(c=>c.id===id?{...c,...patch}:c));
  const setInst=(id,patch)=>setProg(P=>P.map(p=>p.id===id?{...p,...patch}:p));
  const applyRoomConstraints=(rc)=>{
    setW(rc.W); setD(rc.D); setWet(rc.wetWall); setProg([...rc.doors,...rc.fixtures]); setZones(rc.zones||[]);
    setAllowFloorRoutes(Boolean(rc.routingPolicy?.floorAllowed)); setSeed(s=>s+1);
  };
  return {W,setW,D,setD,wet,setWet,prog,setProg,setInst,soft,setSoft,allowFloorRoutes,setAllowFloorRoutes,zones,setZones,setZone,
    pool:ranked,idx,setIdx,seed,setSeed,pref,channels,setChannel,cfg,feasibility,cornerEls,hasDoor,best,championKey,championEvents,explore,setExplore,
    abPair,optionA,optionB,bestChannelScores,routing,choosePreference,chooseEqualPreference,chooseChampionStays,
    pathMin,setPathMin,pathWant,setPathWant,showPaths,setShowPaths,paths,comfort,search,expandSearch,applyRoomConstraints};
}

function candidateKey(candidate){
  return candidate.placed.map(p=>`${p.name}:${p.wall}:${Math.round(p.foot.x)}:${Math.round(p.foot.y)}:${p.kind==="door"?p.dir:""}`).join("|");
}

function pairKey(a,b){
  return [candidateKey(a),candidateKey(b)].sort().join("::");
}

function championPair(champion,pool,dismissedPairs){
  const challenger=pool.find(c=>candidateKey(c)!==candidateKey(champion)&&!dismissedPairs.includes(pairKey(champion,c)));
  return challenger?{a:champion,b:challenger,info:0,quality:(champion.ev.score+challenger.ev.score)/2,mode:"prvak vs izzivalka"}:null;
}

function nextUndismissedInfoPair(pool,channels,cfg,dismissedPairs){
  let candidates=pool;
  for(let attempt=0;attempt<Math.max(1,pool.length-1);attempt++){
    const pair=nextPair(candidates,channels,cfg,1);
    if(!pair)return null;
    if(!dismissedPairs.includes(pairKey(pair.a,pair.b)))return {...pair,mode:"raziskovanje"};
    candidates=candidates.filter(c=>candidateKey(c)!==candidateKey(pair.b));
    if(candidates.length<2)break;
  }
  return nextPair(pool,channels,cfg,1);
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
  const {W,setW,D,setD,wet,setWet,prog,setProg,setInst,soft,setSoft,allowFloorRoutes,setAllowFloorRoutes,zones,setZones,setZone,hasDoor,cornerEls,feasibility,setSeed,pathMin,setPathMin,pathWant,setPathWant,showPaths,setShowPaths,paths,comfort}=rp;
  const openings=prog.filter(p=>{const e=library[p.key];return e&&(isDoor(e)||e.kind==="window");});
  const equipment=prog.filter(p=>{const e=library[p.key];return e&&!isDoor(e)&&e.kind!=="window";});
  const addProgram=(key)=>setProg(p=>[...p,{id:uid(),key,...(isDoor(library[key])?{w:800,dir:"auto",wall:"auto",hinge:"auto"}:{})}]);
  const renderItem=(p)=>{const e=library[p.key];const door=isDoor(e);
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
    </div>;
  };
  return (
    <aside className="constraints2 single">
      <div className="col inputCol">
        <Section k="input-space" title="Prostor">
          <Num label="Širina" v={W} set={setW} min={1200} max={5000} step={50}/>
          <Num label="Globina" v={D} set={setD} min={1400} max={5000} step={50}/>
          <div className="wp"><span>Mokri zid</span><div className="rt wgrid">{["N","E","S","W"].map(w=><button key={w} className={wet===w?"on":""} onClick={()=>setWet(w)}>{({N:"sever",E:"vzhod",S:"jug",W:"zahod"})[w]}</button>)}</div></div>
          <label className="softTgl inlineTgl"><input type="checkbox" checked={allowFloorRoutes} onChange={e=>setAllowFloorRoutes(e.target.checked)}/> <span>Dovoli napeljavo v tleh</span></label>
          <div className="softNote">{allowFloorRoutes?"Talni priklopi lahko gredo naravnost po plošči.":"Talni priklopi se preusmerijo po steni do mokrega zidu."}</div>
        </Section>

        <Section k="input-openings" title="Vrata in okna">
          <div className="addRow">{Object.entries(library).filter(([,e])=>isDoor(e)||e.kind==="window").map(([k,e])=><button key={k} onClick={()=>addProgram(k)}>+ {e.name}</button>)}</div>
          <div className="progList">{openings.map(renderItem)}</div>
          {!hasDoor && <div className="warnNote">⚠ Soba rabi vsaj ena vrata. Dodaj jih, sicer ni veljavne rešitve.</div>}
        </Section>

        <Section k="input-program" title="Program opreme">
          <div className="addRow">{Object.entries(library).filter(([,e])=>!isDoor(e)&&e.kind!=="window").map(([k,e])=><button key={k} onClick={()=>addProgram(k)}>+ {e.name}</button>)}</div>
          <div className="progList">{equipment.map(renderItem)}</div>
          {cornerEls.length>0 && <div className="warnNote">Kotni elementi rabijo vogalno postavitev - pride kasneje.</div>}
          {!feasibility.feasible && <div className="warnNote"><b>Predhodna izvedljivost</b><br/>{feasibility.reasons.map((r,i)=><span key={i}>{r}<br/></span>)}</div>}
        </Section>

        <Section k="input-zones" title="Realne omejitve sobe">
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
        </Section>

        <Section k="input-paths-widths" title="Poti in širina">
          <label className="softTgl"><input type="checkbox" checked={showPaths} onChange={e=>setShowPaths(e.target.checked)}/> <span>Pokaži poti (vrata → element)</span></label>
          <Num label="Minimalna (trdo)" v={pathMin} set={setPathMin} min={300} max={2400} step={50} c="#e2553f"/>
          <Num label="Želena (mehko)" v={pathWant} set={setPathWant} min={300} max={3000} step={50} c="#5bbd8b"/>
          {comfort&&<div className="softNote">Trenutno: najožja <b className="mono">{Math.round(comfort.minWidth)}</b> mm · udobje <b className="mono">{Math.round(comfort.ratio*100)}</b>.</div>}
          {paths.length>0 ? <div className="routeList">{paths.map((pt,i)=><div key={i} className="routeItem">
            <span>{pt.name} · {pt.reachable?(pt.minWidth>=pathWant?"udobno":"ozko"):"NI POTI"}</span>
            <b className="mono">{pt.reachable?Math.round(pt.minWidth)+" mm":"blok"}</b>
          </div>)}</div> : <div className="soft2 none">Poti se pokažejo po veljavni generaciji.</div>}
          <div className="softNote">Minimalna je trda: kandidat pade, če je pot ožja. Želena je mehka: kandidat ostane, vendar dobi slabšo oceno udobja.</div>
        </Section>
        <Section k="input-soft" title="Mehka pravila">
          <label className="softTgl"><input type="checkbox" checked={soft} onChange={e=>setSoft(e.target.checked)}/> <span>Dovoli mehko prekrivanje halo</span></label>
          <div className="softNote">{soft?"Mehka pravila ne zavrnejo kandidata takoj: prekrivanje halo dobi kazen v oceni. Trda pravila, kot so stena, jedro in lok vrat, ostanejo obvezna.":"Strogo: vsako prekrivanje halo zavrne kandidata."}</div>
        </Section>
        <Section k="input-generate" title="Generiranje">
          <button className="regen" onClick={()=>setSeed(s=>s+1)}>↻ Generiraj</button>
          <div className="softNote">Generiraj ponovno premeša iskanje in naredi nov bazen veljavnih razporeditev za iste vhode. Ne spremeni pravil; spremeni samo poskus iskanja variant.</div>
        </Section>
      </div>
    </aside>
  );
}

/* ===== Korak 3 (a) — oder z razporeditvijo in poolom ===== */
function ABStagePanel({rp}){
  const {best,cfg,zones,optionA,optionB,abPair,choosePreference,chooseEqualPreference,chooseChampionStays,pref,channels,championKey,championEvents,explore,setExplore,pathMin,pathWant,pool,idx,setIdx,allowFloorRoutes}=rp;
  const routeOf=(cand)=>cand?routeServices(cand.placed,cfg,{allowFloorRoutes}):null;
  const aIsChampion=optionA&&candidateKey(optionA)===championKey;
  const bIsChampion=optionB&&candidateKey(optionB)===championKey;
  const championInPair=aIsChampion||bIsChampion;
  const challenger=aIsChampion?optionB:bIsChampion?optionA:null;
  const recent=championEvents.slice(-5);
  const changes=recent.filter(e=>e.changed).length;
  const lastNew=championEvents.at(-1)?.changed;
  const pairHints=[
    ["izkoriščanje",abPairLabel({mode:"prvak vs izzivalka",a:best,b:pool.find(c=>best&&candidateKey(c)!==candidateKey(best))})],
    ["vmes",abPair?.mode||"-"],
    ["raziskovanje","največji informacijski donos"],
  ];
  const learnedDrain=channels.find(ch=>ch.id==="drain-distance")?.learned??0;
  const learnedPath=channels.find(ch=>ch.id==="path-comfort")?.learned??0;
  return <main className="cstage abStage">
    <div className="abProgress">
      <span>Primerjave <b className="mono">{pref.comparisons}</b></span>
      <span className={changes===0&&recent.length>=3?"conv on":"conv"}>{recent.length<3?"še zbiramo":changes===0?"prvak drži":`prvak se menja ${changes}/${recent.length}`}</span>
      <span>{abPair?.mode||"par"} · donos <b className="mono">{abPair?Math.round(abPair.info*100):0}</b></span>
      <span>learned: trase <b className="mono">{(learnedDrain*100).toFixed(1)}</b> · poti <b className="mono">{(learnedPath*100).toFixed(1)}</b></span>
      <label>raziskovanje <b className="mono">{Math.round(explore*100)}</b><input type="range" min="0" max="1" step="0.05" value={explore} onInput={e=>setExplore(+e.target.value)} onChange={e=>setExplore(+e.target.value)}/></label>
      <button className="microBtn" onClick={()=>setExplore(0)}>izkoriščaj</button>
      <button className="microBtn" onClick={()=>setExplore(1)}>raziskuj</button>
      <button className="microBtn" onClick={()=>setExplore(suggestedExplore(pref.comparisons))}>predlagaj</button>
    </div>
    <div className="pairModeHints">{pairHints.map(([k,v])=><span key={k}><b>{k}</b>{v}</span>)}</div>
    <div className="bestStrip">
      <div className="abHead"><b>Trenutno najboljša {lastNew&&<em className="newChamp">nov prvak</em>}</b><span className="mono">{best?(best.ev.score*100|0):"-"}</span></div>
      <div className="bestMini">{best?<O2Plan cand={best} cfg={cfg} zones={zones} routing={routeOf(best)} paths={[]} bandMin={pathMin} bandWant={pathWant}/>:<div className="noRes">Ni veljavne rešitve.</div>}</div>
    </div>
    {optionA&&optionB ? <>
      <div className="abCompare">
        <ABPlanCard label="A" badge={aIsChampion?"prvak":bIsChampion?"izzivalka":""} cand={optionA} cfg={cfg} zones={zones} routing={routeOf(optionA)} pathMin={pathMin} pathWant={pathWant}/>
        <ABPlanCard label="B" badge={bIsChampion?"prvak":aIsChampion?"izzivalka":""} cand={optionB} cfg={cfg} zones={zones} routing={routeOf(optionB)} pathMin={pathMin} pathWant={pathWant}/>
      </div>
      <div className="abChoiceBtns">
        <button onClick={()=>choosePreference(optionA,optionB)}>A je boljša</button>
        <button onClick={()=>chooseEqualPreference(optionA,optionB)}>enakovredni</button>
        <button onClick={()=>choosePreference(optionB,optionA)}>B je boljša</button>
        {championInPair&&<button className="champStay" onClick={()=>chooseChampionStays(challenger)}>trenutno najboljša ostane</button>}
      </div>
    </> : <div className="noRes">Za A/B sta potrebni vsaj dve veljavni razporeditvi.</div>}
    <div className="poolBar">{pool.length>0 && <><span className="mono">{pool.length} veljavnih</span>{pool.slice(0,8).map((c,i)=><button key={i} className={"thumb "+(idx===i?"on":"")} onClick={()=>setIdx(i)}><span className="mono">{(c.ev.score*100|0)}</span></button>)}</>}</div>
  </main>;
}

function abPairLabel(pair){
  if(!pair?.a||!pair?.b)return "-";
  return pair.mode||"par";
}

function ABPlanCard({label,badge,cand,cfg,zones,routing,pathMin,pathWant}){
  return <div className="abPlanCard">
    <div className="abHead"><b>{label} {badge&&<em className={badge==="prvak"?"champBadge":"challBadge"}>{badge}</em>}</b><span className="mono">score {(cand.ev.score*100|0)} · prehod {Math.round(cand.ev.aisle)} mm · halo {(cand.ev.halo/1e6).toFixed(2)} m²</span></div>
    <div className="abSheet"><O2Plan cand={cand} cfg={cfg} zones={zones} routing={routing} paths={[]} bandMin={pathMin} bandWant={pathWant}/></div>
  </div>;
}

// Daljinec — plasti prikaza. Vpliva SAMO na izris, ne na engine/pravila/rezultat.
const DEFAULT_LAYERS={walls:true,equipment:true,doors:true,windows:true,cores:false,halo:false,paths:false,humans:false,"water-out":false,"water-in":false,electric:false,vent:false};
const LAYER_GROUPS=[
  {name:"Prostor",items:[["walls","stene"],["equipment","oprema"],["doors","vrata"],["windows","okna"]]},
  {name:"Pravila",items:[["cores","jedra"],["halo","halo"],["paths","poti"],["humans","človeški kvadri"]]},
  {name:"Instalacije",media:true,items:[["water-out","voda-odvod"],["water-in","voda-dovod"],["electric","elektrika"],["vent","zrak"]]},
];
const MEDIA_KEYS=["water-out","water-in","electric","vent"];

function Daljinec({layers,toggle,toggleGroup}){
  return <aside className="daljinec">
    <div className="eyebrow">Daljinec · plasti</div>
    {LAYER_GROUPS.map(g=>{
      const allOn=g.items.every(([k])=>layers[k]);
      return <div key={g.name} className="layGroup">
        <label className="layHd"><input type="checkbox" checked={allOn} onChange={()=>toggleGroup(g,!allOn)}/> <b>{g.name}</b></label>
        {g.items.map(([k,label])=><label key={k} className="layItem"><input type="checkbox" checked={!!layers[k]} onChange={()=>toggle(k)}/> {g.media&&<i className="medDot" style={{background:CONN[k].color}}/>}{label}</label>)}
      </div>;
    })}
    <div className="softNote">Daljinec spreminja samo izris — ne pravil, ne rezultata.</div>
  </aside>;
}

function StagePanel({rp}){
  const {best,cfg,zones,routing,feasibility,hasDoor,soft,pool,idx,setIdx,paths,showPaths,pathMin,pathWant,search,expandSearch}=rp;
  const [view,setView]=usePersistentState("floorplanner.stageView","plan");
  const [rawLayers,setRawLayers]=usePersistentState("floorplanner.layers",DEFAULT_LAYERS);
  const layers=useMemo(()=>({...DEFAULT_LAYERS,...rawLayers}),[rawLayers]);
  const toggle=(k)=>setRawLayers(L=>({...DEFAULT_LAYERS,...L,[k]:!(({...DEFAULT_LAYERS,...L})[k])}));
  const toggleGroup=(g,on)=>setRawLayers(L=>{const next={...DEFAULT_LAYERS,...L};g.items.forEach(([k])=>next[k]=on);return next;});
  const wallView=["N","E","S","W"].includes(view)?view:null;
  const viewButtons=[
    ["plan","Tloris"],
    ["N","Naris S"],
    ["E","Naris V"],
    ["S","Naris J"],
    ["W","Naris Z"],
    ["3d","3D"],
  ];
  return (
    <main className="cstage">
      <div className="legend mono"><span><i style={{background:"#2b3138"}}/>oprema</span><span><i style={{background:"#e2553f"}}/>jedro</span><span><i style={{background:"#d9a23b",opacity:.5}}/>halo</span><span><i style={{background:"#c0392b"}}/>prekrivanje</span><span><i style={{background:"#5aa9e6",opacity:.35}}/>človek</span><span><i style={{background:"#86c9ff",opacity:.5}}/>okno</span><span><i style={{background:"#8a96a3"}}/>stena</span><span><i style={{background:"#16b3b3"}}/>mokri zid</span><span><i style={{background:"#5bbd8b"}}/>pot</span></div>
      <div className="viewTabs" role="tablist" aria-label="Pogled risbe">
        {viewButtons.map(([id,label])=><button key={id} className={view===id?"on":""} onClick={()=>setView(id)}>{label}</button>)}
      </div>
      <div className="stageRow">
        <div className="sheet">{best? (view==="3d"
          ? <ThreeRoomView cand={best} cfg={cfg} routing={routing} paths={paths} bandMin={pathMin} layers={layers}/>
          : wallView
          ? <ElevationView cand={best} cfg={cfg} wall={wallView} routing={routing} layers={layers}/>
          : <O2Plan cand={best} cfg={cfg} zones={zones} routing={routing} paths={paths} bandMin={pathMin} bandWant={pathWant} layers={layers}/>)
          : <div className="noRes">{search?.status==="infeasible"
              ? <><b style={{color:"#f08a78"}}>NI VELJAVNE REŠITVE</b> (dokazano):<br/>{(search.reasons&&search.reasons.length?search.reasons:feasibility.reasons).join(" · ")}</>
              : !hasDoor
              ? "Dodaj vrata - soba brez vrat nima veljavne rešitve."
              : <><b style={{color:"#d9a23b"}}>Nisem našel</b> v {search?.attempts||0} poskusih (morda obstaja).<br/><i style={{fontSize:"11px",color:"#8a96a3"}}>To NI dokaz nemožnosti — iskanje je naključno (znana omejitev iz HANDOFF).{soft?"":" Lahko tudi vklopiš mehka pravila."}</i><br/><button className="regen" style={{marginTop:10,maxWidth:240}} onClick={expandSearch}>↻ Razširi iskanje (več poskusov)</button></>}</div>}</div>
        <Daljinec layers={layers} toggle={toggle} toggleGroup={toggleGroup}/>
      </div>
      <div className="poolBar">{pool.length>0 && <><span className="mono">{pool.length} veljavnih</span>{pool.slice(0,8).map((c,i)=><button key={i} className={"thumb "+(idx===i?"on":"")} onClick={()=>setIdx(i)}><span className="mono">{(c.ev.score*100|0)}</span></button>)}</>}</div>
    </main>
  );
}

/* ===== Korak 3 (b) — preverba, instalacije, A/B aktivno učenje, kanali ===== */
function ReviewPanel({rp,showAB=true,showBench=true}){
  const {best,cfg,routing,optionA,optionB,abPair,explore,setExplore,pref,channels,setChannel,bestChannelScores,choosePreference,paths,comfort,pathMin,pathWant}=rp;
  return (
    <aside className="col">
      {best? <>
        <Section k="rules" title={<>Preverba pravil · ocena <span className="mono">{(best.ev.score*100|0)}</span></>}>
          <div className="check ok2">✓ trda jedra se ne prekrivajo</div>
          <div className="check ok2">✓ lok vrat prost (P-01)</div>
          <div className="check ok2">✓ prehod {Math.round(best.ev.aisle)} mm ≥ {cfg.minAisle}</div>
        </Section>
        <Section k="halo" title="Mehke kazni (halo)">
          {best.ev.overlaps.length>0 ? best.ev.overlaps.map((o,i)=>(
            <div key={i} className="soft2"><span className="sw"/>{o.a} ↔ {o.b}<br/><span className="mono">{(o.area/1e6).toFixed(2)} m² → dovoljeno, kaznovano</span></div>
          )) : <div className="soft2 none">brez prekrivanj halo - čista razporeditev</div>}
        </Section>
        <Section k="install" title="Instalacije">
          <div className="drain"><span className="mono">{((routing?.totalLength||0)/1000).toFixed(2)} m</span> skupne trase<br/><i>O5 računa od dejanske priklopne točke</i></div>
          {routing?.reroutedCount>0 && <div className="warnNote">{routing.reroutedCount} priklopov v tla je preusmerjenih po steni (talne trase niso dovoljene).</div>}
          {routing?.floorCrossingCount>0 && <div className="warnNote">{routing.floorCrossingCount} talnih tras ima križanje.</div>}
          <div className="routeList">{routing?.routes.map(r=><div key={r.id} className={"routeItem "+r.via} style={r.mediumOk?{}:{borderColor:"#7a3028"}}>
            <div className="routeTop"><span><i className="medDot" style={{background:CONN[r.medium].color}}/>{r.fixtureName} · {MEDIA_PROFILE[r.medium].label}</span><b className="mono">{(r.length/1000).toFixed(2)} m</b></div>
            <div className="medNote" style={r.mediumOk?{color:"#6f9f86"}:{color:"#f08a78"}}>{r.mediumOk?"✓ ":"✗ "}{r.mediumNote}</div>
          </div>)}</div>
        </Section>
        <Section k="paths" title={<>Poti · trak <span className="mono">{pathMin}</span>/<span className="mono">{pathWant}</span> mm</>}>
          {paths.length>0 ? <div className="routeList">{paths.map((pt,i)=>(
            <div key={i} className="routeItem" style={pt.reachable?(pt.minWidth>=pathWant?{}:{borderColor:"#5a4420"}):{borderColor:"#7a3028",color:"#f08a78"}}>
              <span>{pt.name} · {pt.reachable?(pt.minWidth>=pathWant?"udobno":"ozko"):"NI POTI"}</span>
              <b className="mono">{pt.reachable?Math.round(pt.minWidth)+" mm":"blok"}</b>
            </div>
          ))}</div> : <div className="soft2 none">Ni elementov za pot.</div>}
          {comfort && <div className="check ok2" style={comfort.minWidth>=pathWant?{}:{background:"#2a1a10",color:"#d9a23b",border:"1px solid #5a4420"}}>
            udobje (želena {pathWant} mm): <b className="mono">{Math.round(comfort.ratio*100)}</b> · najožja <b className="mono">{Math.round(comfort.minWidth)}</b> mm
          </div>}
          <div className="softNote"><b style={{color:"#e2553f"}}>Minimalna {pathMin} mm</b> = trdo (prehodnost, veljavnost). <b style={{color:"#5bbd8b"}}>Želena {pathWant} mm</b> = mehko (udobje, vpliva le na to oceno).</div>
        </Section>
        {showAB&&<Section k="ab" title="A/B preference · aktivno učenje">
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
        </Section>}
        {showBench&&<Section k="bench" title="Testna miza kanalov" defaultOpen={false}>
          <div className="softNote">Kanal je merilo, po katerem engine primerja razporeditve. A/B izbire premikajo <b>learned</b>; <b>prior</b> nastaviš ročno, <b>zaupanje</b> določa mešanico, <b>eff</b> je efektivna utež.</div>
          <div className="channelBench">
            {channels.map(ch=>{
              const score=bestChannelScores?.scores.find(s=>s.channelId===ch.id);
              return <div key={ch.id} className={"channelCard "+(!ch.enabled?"off":"")}>
                <div className="chTop"><label><input type="checkbox" checked={ch.enabled} onChange={e=>setChannel(ch.id,{enabled:e.target.checked})}/> {ch.name}</label><span>{ch.family}</span></div>
                <div className="chScope"><button className={ch.scope==="global"?"on":""} onClick={()=>setChannel(ch.id,{scope:"global"})}>global</button><button className={ch.scope==="room-type"?"on":""} onClick={()=>setChannel(ch.id,{scope:"room-type"})}>room</button></div>
                <label className="chSlider" title="Prior: ročna začetna utež, preden A/B izbire dodajo signal.">prior <input type="range" min="0" max="1" step="0.01" value={ch.prior} onChange={e=>setChannel(ch.id,{prior:+e.target.value})}/><b className="mono">{Math.round(ch.prior*100)}</b></label>
                <label className="chSlider" title="Zaupanje: koliko naj eff sledi priorju proti learned signalu.">zaup. <input type="range" min="0" max="1" step="0.01" value={ch.confidence} onChange={e=>setChannel(ch.id,{confidence:+e.target.value})}/><b className="mono">{Math.round(ch.confidence*100)}</b></label>
                <div className="chBars">
                  <span title="Prior: kar nastaviš ročno." style={{"--w":`${ch.prior*100}%`}}>prior</span>
                  <span title="Learned: kar engine nauči iz A/B izbir." style={{"--w":`${ch.learned*100}%`}}>learned</span>
                  <span title="Eff: efektivna utež, zmes priorja in learned." style={{"--w":`${effectiveWeight(ch)*100}%`}}>eff</span>
                </div>
                <div className="chScore">score <b className="mono">{score?Math.round(score.value*100):"-"}</b></div>
              </div>
            })}
          </div>
        </Section>}
      </> : <div className="noRes2">Ni veljavne rešitve za te zahteve.</div>}
    </aside>
  );
}

/* Zložljiva sekcija desnega stolpca — klik na naslov skrije/pokaže telo. */
function Section({k,title,defaultOpen=true,children}){
  const [open,setOpen]=usePersistentState("floorplanner.sec."+k,defaultOpen);
  return <div className={"sec "+(open?"open":"")}>
    <button className="secHd" onClick={()=>setOpen(o=>!o)}>
      <span className="chev">{open?"▾":"▸"}</span>
      <span className="secTtl eyebrow">{title}</span>
    </button>
    {open && <div className="secBody">{children}</div>}
  </div>;
}

function O2Plan({cand,cfg,zones,routing,paths=[],bandMin=600,bandWant=900,layers=DEFAULT_LAYERS}){ const {W,D,wetWall}=cfg; const PAD=900; const we=wallEdge(wetWall,W,D);
  const fixtures=cand.placed.filter(p=>p.kind!=="door");
  const isWin=(p)=>p.el.kind==="window";
  return <svg viewBox={`${-PAD} ${-PAD} ${W+PAD*2} ${D+PAD*2}`} style={{width:"100%",height:"100%"}}>
    <defs><pattern id="hh" width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="80" stroke="#d9a23b" strokeWidth="12" opacity=".5"/></pattern>
    <pattern id="nogo" width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="70" stroke="#e2553f" strokeWidth="16" opacity=".55"/></pattern></defs>
    {layers.walls&&<rect x="0" y="0" width={W} height={D} fill="#f6f7f3" stroke="#2b3138" strokeWidth="110"/>}
    <g fontFamily="ui-monospace,Menlo,monospace" fontSize="150" fill="#aab4bf" opacity=".65" textAnchor="middle">
      <text x={W/2} y={-300}>S</text>
      <text x={W+360} y={D/2} dy="52">V</text>
      <text x={W/2} y={D+420}>J</text>
      <text x={-360} y={D/2} dy="52">Z</text>
    </g>
    {layers.walls&&<line {...we} stroke="#16b3b3" strokeWidth="130"/>}
    {/* INSTALACIJE — trasa po medijevi barvi, vsak medij svoja plast */}
    {(routing?.routes||[]).filter(r=>layers[r.medium]).map(r=><g key={r.id}>
      <polyline points={(r.path||[r.from,r.to]).map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke={r.mediumOk?CONN[r.medium].color:"#e2553f"} strokeWidth="26" strokeDasharray={r.via==="floor"?"60 42":"none"} strokeLinejoin="round" strokeLinecap="round" opacity=".9"/>
      <circle cx={r.from.x} cy={r.from.y} r="42" fill={CONN[r.medium].color} stroke="#0e1116" strokeWidth="9"/>
    </g>)}
    {(zones||[]).map((z,i)=><g key={"z"+i}><rect x={z.x} y={z.y} width={z.w} height={z.h} fill="url(#nogo)" stroke="#e2553f" strokeWidth="16" strokeDasharray="70 50"/>
      <text x={z.x+z.w/2} y={z.y+z.h/2} fill="#b03a2e" fontSize="95" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle" dy="34">ne</text></g>)}
    {layers.halo&&fixtures.map((p,i)=><rect key={"s"+i} x={p.soft.x} y={p.soft.y} width={p.soft.w} height={p.soft.h} fill="url(#hh)" stroke="#d9a23b" strokeWidth="14" strokeDasharray="50 50" opacity=".8"/>)}
    {layers.halo&&cand.ev.overlaps.map((o,i)=>o.box&&<rect key={"o"+i} x={o.box.x} y={o.box.y} width={o.box.w} height={o.box.h} fill="#c0392b" opacity=".34"/>)}
    {layers.cores&&fixtures.map((p,i)=><rect key={"h"+i} x={p.hard.x} y={p.hard.y} width={p.hard.w} height={p.hard.h} fill="#e2553f" opacity=".14" stroke="#e2553f" strokeWidth="20"/>)}
    {layers.humans&&fixtures.map((p,i)=>{const hb=humanUsageBox(p);return hb&&<rect key={"hu"+i} x={hb.x} y={hb.y} width={hb.w} height={hb.h} fill="#5aa9e6" opacity=".18" stroke="#3a78b0" strokeWidth="16" strokeDasharray="46 34"/>;})}
    {fixtures.filter(p=>isWin(p)?layers.windows:layers.equipment).map((p,i)=><g key={"f"+i}><rect x={p.foot.x} y={p.foot.y} width={p.foot.w} height={p.foot.h} rx="26" fill={isWin(p)?"#cfe8fb":"#dfe6df"} stroke={isWin(p)?"#3f86c9":"#2b3138"} strokeWidth="30"/>
      <text x={p.foot.x+p.foot.w/2} y={p.foot.y+p.foot.h/2} fill="#3a444f" fontSize="115" fontFamily="ui-sans-serif,system-ui" textAnchor="middle" dy="40">{p.name}</text></g>)}
    {layers.paths&&paths.map((pt,i)=>pt.reachable
      ? <g key={"p"+i}>
          {/* želena širina = bled trak v ozadju (mehko, udobje) */}
          <polyline points={pt.path.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#5bbd8b" strokeWidth={bandWant} strokeLinecap="round" strokeLinejoin="round" opacity=".10"/>
          {/* minimalna širina = poln trak (trdo, prehodnost) */}
          <polyline points={pt.path.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#3f7d5e" strokeWidth={bandMin} strokeLinecap="round" strokeLinejoin="round" opacity=".22"/>
          <polyline points={pt.path.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#2f5e46" strokeWidth="14" strokeDasharray="14 40" strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>
          {pt.narrowest&&<g>
            <line x1={pt.narrowest.x-pt.minWidth/2} y1={pt.narrowest.y} x2={pt.narrowest.x+pt.minWidth/2} y2={pt.narrowest.y} stroke="#d9a23b" strokeWidth="20"/>
            <circle cx={pt.narrowest.x} cy={pt.narrowest.y} r="40" fill="none" stroke="#d9a23b" strokeWidth="14"/>
            <text x={pt.narrowest.x} y={pt.narrowest.y} dy="-58" fill="#b8841f" fontSize="92" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle">{Math.round(pt.minWidth)}</text>
          </g>}
        </g>
      : <g key={"p"+i}>{pt.blockedAt&&<g>
          <line x1={pt.blockedAt.x-78} y1={pt.blockedAt.y-78} x2={pt.blockedAt.x+78} y2={pt.blockedAt.y+78} stroke="#e2553f" strokeWidth="28" strokeLinecap="round"/>
          <line x1={pt.blockedAt.x-78} y1={pt.blockedAt.y+78} x2={pt.blockedAt.x+78} y2={pt.blockedAt.y-78} stroke="#e2553f" strokeWidth="28" strokeLinecap="round"/>
          <text x={pt.blockedAt.x} y={pt.blockedAt.y} dy="-108" fill="#b03a2e" fontSize="86" fontFamily="ui-sans-serif,system-ui" textAnchor="middle">{pt.name}: ni poti</text>
        </g>}</g>
    )}
    {layers.doors&&cand.placed.filter(p=>p.kind==="door").map((p,i)=><Door key={"d"+i} p={p} W={W} D={D}/>)}
  </svg>;
}

function ThreeRoomView({cand,cfg,routing,paths=[],bandMin=600,layers=DEFAULT_LAYERS}){
  const hostRef=useRef(null);
  useEffect(()=>{
    const host=hostRef.current;
    if(!host)return;
    const {W,D,wetWall}=cfg;
    const H=2600,wallT=80;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color("#f6f7f3");
    const camera=new THREE.PerspectiveCamera(45,1,20,20000);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.shadowMap.enabled=true;
    host.appendChild(renderer.domElement);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true;
    controls.target.set(0,700,0);
    controls.minDistance=Math.max(W,D)*0.45;
    controls.maxDistance=Math.max(W,D)*4;

    scene.add(new THREE.HemisphereLight(0xffffff,0x9aa1a8,1.9));
    const sun=new THREE.DirectionalLight(0xffffff,1.8);
    sun.position.set(-W*0.65,3200,D*0.9);
    sun.castShadow=true;
    scene.add(sun);

    const mats={
      floor:new THREE.MeshStandardMaterial({color:"#dfe6df",roughness:.82}),
      wall:new THREE.MeshStandardMaterial({color:"#d8ded7",roughness:.9,transparent:true,opacity:.38,depthWrite:false}),
      wet:new THREE.MeshStandardMaterial({color:"#16b3b3",roughness:.82,transparent:true,opacity:.46,depthWrite:false}),
      fixture:new THREE.MeshStandardMaterial({color:"#dfe6df",roughness:.66}),
      fixtureTop:new THREE.MeshStandardMaterial({color:"#cfd8cf",roughness:.62}),
      glass:new THREE.MeshStandardMaterial({color:"#86c9ff",transparent:true,opacity:.34,roughness:.25,metalness:.04}),
      doorArc:new THREE.LineBasicMaterial({color:"#3a78b0",transparent:true,opacity:.85}),
      human:new THREE.MeshStandardMaterial({color:"#5aa9e6",transparent:true,opacity:.22,roughness:.55,depthWrite:false}),
    };
    const group=new THREE.Group();
    scene.add(group);

    const addBox=(box,mat,cast=false)=>{
      if(box.w<=0||box.h<=0||box.h3<=0)return null;
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(box.w,box.h3,box.h),mat);
      mesh.position.set(box.x+box.w/2-W/2,box.z+box.h3/2,box.y+box.h/2-D/2);
      mesh.castShadow=cast;
      mesh.receiveShadow=true;
      group.add(mesh);
      return mesh;
    };

    addBox({x:0,y:0,z:-26,w:W,h:D,h3:26},mats.floor);
    if(layers.walls)for(const wall of ["N","E","S","W"])addWall(group,wall,cfg,cand.placed,H,wallT,wall===wetWall?mats.wet:mats.wall);

    if(layers.equipment)cand.placed.filter(p=>p.kind!=="door"&&p.el.kind!=="window").forEach((p)=>{
      const mesh=addBox(elementBox(p),mats.fixture,true);
      if(mesh)mesh.name=p.name;
    });

    if(layers.windows)cand.placed.filter(p=>p.el.kind==="window").forEach((p)=>addWindowPane(group,p,cfg,H,mats.glass));
    if(layers.doors)cand.placed.filter(p=>p.kind==="door").forEach((p)=>addDoorSwing3D(group,p,cfg,mats.doorArc));
    if(layers.humans)cand.placed.filter(p=>p.kind!=="door").forEach((p)=>{
      const human=humanUsageBox(p);
      if(human)addBox(human,mats.human,false);
    });

    // INSTALACIJE 3D — metodološko korektno: cev NE teče po zraku. Vodoravno gre
    // po DEJANSKI trasi (route.path: po tleh za talne, ob steni/obodu za stenske)
    // na ravni tal (FLOOR_RUN). Montažna VERTIKALA poveže višino priklopa
    // (connectionZ — montaža na zid/element) s to ravnijo. Tako se upošteva
    // višina montaže glede na tla in stene.
    const FLOOR_RUN=40; // raven cevi tik nad ploščo (tla/estrih)
    const elByName=new Map();
    cand.placed.filter(p=>p.kind!=="door").forEach((p)=>{if(!elByName.has(p.name))elByName.set(p.name,p.el);});
    (routing?.routes||[]).forEach((r)=>{
      if(!layers[r.medium])return;
      const el=elByName.get(r.fixtureName);
      const z=el?connectionZ(el,r.connection):(r.connection.z??1000);
      const path=r.path&&r.path.length?r.path:[r.from,r.to];
      const mat=new THREE.LineBasicMaterial({color:new THREE.Color(CONN[r.medium].color)});
      const pts=[
        new THREE.Vector3(r.from.x-W/2,z,r.from.y-D/2),       // priklop na višini montaže
        new THREE.Vector3(r.from.x-W/2,FLOOR_RUN,r.from.y-D/2), // vertikala do ravni tal
      ];
      for(const pt of path)pts.push(new THREE.Vector3(pt.x-W/2,FLOOR_RUN,pt.y-D/2)); // trasa po tleh/ob steni
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat));
    });

    // POTI 3D (rang 1) — trak hoje od vrat do elementa, ležeč na tleh (širina = minimalna);
    // rdeč X na mestu blokade, če pot ni prehodna. Plast "poti" v daljincu.
    if(layers.paths){
      const pathBand=new THREE.MeshStandardMaterial({color:"#3f7d5e",transparent:true,opacity:.34,roughness:.95,depthWrite:false});
      const blockMat=new THREE.MeshStandardMaterial({color:"#e2553f",roughness:.7});
      for(const pt of paths){
        if(pt.reachable&&pt.path){
          for(let i=1;i<pt.path.length;i+=1){
            const a=pt.path[i-1],b=pt.path[i];
            const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
            if(len<1)continue;
            const seg=new THREE.Mesh(new THREE.BoxGeometry(len,14,Math.max(bandMin,60)),pathBand);
            seg.position.set((a.x+b.x)/2-W/2,18,(a.y+b.y)/2-D/2);
            seg.rotation.y=-Math.atan2(dy,dx);
            group.add(seg);
          }
        }else if(pt.blockedAt){
          const x=new THREE.Mesh(new THREE.BoxGeometry(200,40,40),blockMat);
          x.position.set(pt.blockedAt.x-W/2,40,pt.blockedAt.y-D/2);x.rotation.y=Math.PI/4;group.add(x);
          const x2=new THREE.Mesh(new THREE.BoxGeometry(200,40,40),blockMat);
          x2.position.set(pt.blockedAt.x-W/2,40,pt.blockedAt.y-D/2);x2.rotation.y=-Math.PI/4;group.add(x2);
        }
      }
    }

    const axes=new THREE.GridHelper(Math.max(W,D),Math.ceil(Math.max(W,D)/250),0xb9c0c7,0xd0d6dc);
    axes.position.y=1;
    group.add(axes);

    camera.position.set(W*.82,Math.max(W,D)*.78,D*1.18);
    camera.lookAt(controls.target);
    controls.update();

    const resize=()=>{
      const rect=host.getBoundingClientRect();
      const width=Math.max(320,rect.width),height=Math.max(260,rect.height);
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      camera.updateProjectionMatrix();
    };
    const observer=new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let raf=0,sampled=false;
    const loop=()=>{
      controls.update();
      renderer.render(scene,camera);
      if(!sampled){
        sampled=true;
        const gl=renderer.getContext(),pixels=new Uint8Array(4);
        const xs=[.25,.5,.75].map(v=>Math.floor(gl.drawingBufferWidth*v));
        const ys=[.25,.5,.75].map(v=>Math.floor(gl.drawingBufferHeight*v));
        let samples=0,nonBlank=0;
        for(const x of xs)for(const y of ys){
          gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          samples++;
          if(!(pixels[0]>245&&pixels[1]>245&&pixels[2]>240))nonBlank++;
        }
        renderer.domElement.dataset.pixelSamples=String(samples);
        renderer.domElement.dataset.nonBlankSamples=String(nonBlank);
      }
      raf=requestAnimationFrame(loop);
    };
    loop();

    return ()=>{
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      scene.traverse((obj)=>{
        if(obj.geometry)obj.geometry.dispose?.();
        if(obj.material){
          const materials=Array.isArray(obj.material)?obj.material:[obj.material];
          materials.forEach((mat)=>mat.dispose?.());
        }
      });
    };
  },[cand,cfg,layers,routing,paths,bandMin]);
  return <div className="threeHost" ref={hostRef} aria-label="3D pogled prostora"/>;
}

function addWall(group,wall,cfg,placed,H,wallT,mat){
  const openings=placed.filter(p=>p.wall===wall&&(p.kind==="door"||p.el.kind==="window")).map((p)=>{
    const along=wall==="N"||wall==="S"?p.foot.x:p.foot.y;
    const width=wall==="N"||wall==="S"?p.foot.w:p.foot.h;
    const z=p.kind==="door"?0:(p.el.z??p.el.parapet??900);
    const h=p.kind==="door"?(p.el.h||2100):p.el.h;
    return {start:along,end:along+width,z,endZ:z+h};
  });
  const L=wall==="N"||wall==="S"?cfg.W:cfg.D;
  const xs=[0,L],zs=[0,H];
  openings.forEach((o)=>{xs.push(clamp(o.start,0,L),clamp(o.end,0,L));zs.push(clamp(o.z,0,H),clamp(o.endZ,0,H));});
  const sortedX=[...new Set(xs)].sort((a,b)=>a-b);
  const sortedZ=[...new Set(zs)].sort((a,b)=>a-b);
  for(let i=0;i<sortedX.length-1;i++){
    for(let j=0;j<sortedZ.length-1;j++){
      const a=sortedX[i],b=sortedX[i+1],z0=sortedZ[j],z1=sortedZ[j+1];
      if(b-a<1||z1-z0<1)continue;
      const cx=(a+b)/2,cz=(z0+z1)/2;
      if(openings.some(o=>cx>o.start&&cx<o.end&&cz>o.z&&cz<o.endZ))continue;
      addWallSegment(group,wall,cfg,a,b-a,z0,z1-z0,wallT,mat);
    }
  }
}

function addWallSegment(group,wall,cfg,along,len,z,h,wallT,mat){
  const W=cfg.W,D=cfg.D;
  const box=wall==="N"?{x:along,y:-wallT,z,w:len,h:wallT,h3:h}
    :wall==="S"?{x:along,y:D,z,w:len,h:wallT,h3:h}
    :wall==="W"?{x:-wallT,y:along,z,w:wallT,h:len,h3:h}
    :{x:W,y:along,z,w:wallT,h:len,h3:h};
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(box.w,box.h3,box.h),mat);
  mesh.position.set(box.x+box.w/2-W/2,box.z+box.h3/2,box.y+box.h/2-D/2);
  mesh.receiveShadow=true;
  group.add(mesh);
}

function addWindowPane(group,p,cfg,H,mat){
  const W=cfg.W,D=cfg.D,t=18;
  const z=p.el.z??p.el.parapet??900;
  const h=p.el.h;
  const box=p.wall==="N"?{x:p.foot.x,y:-t,z,w:p.foot.w,h:t,h3:h}
    :p.wall==="S"?{x:p.foot.x,y:D,z,w:p.foot.w,h:t,h3:h}
    :p.wall==="W"?{x:-t,y:p.foot.y,z,w:t,h:p.foot.h,h3:h}
    :{x:W,y:p.foot.y,z,w:t,h:p.foot.h,h3:h};
  const pane=new THREE.Mesh(new THREE.BoxGeometry(box.w,box.h3,box.h),mat);
  pane.position.set(box.x+box.w/2-W/2,box.z+box.h3/2,box.y+box.h/2-D/2);
  group.add(pane);
  addWallSegment(group,p.wall,cfg,p.wall==="N"||p.wall==="S"?p.foot.x:p.foot.y,p.wall==="N"||p.wall==="S"?p.foot.w:p.foot.h,z-32,32,24,mat);
  addWallSegment(group,p.wall,cfg,p.wall==="N"||p.wall==="S"?p.foot.x:p.foot.y,p.wall==="N"||p.wall==="S"?p.foot.w:p.foot.h,Math.min(H,z+h),32,24,mat);
}

function addDoorSwing3D(group,p,cfg,mat){
  const g=doorSwing(p.wall,p.hinge?1:0,p.dir,p.foot,cfg.W,cfg.D);
  const start=Math.atan2(g.ty-g.hy,g.tx-g.hx);
  let end=Math.atan2(g.jy-g.hy,g.jx-g.hx);
  let delta=end-start;
  if(g.sweep&&delta<0)delta+=Math.PI*2;
  if(!g.sweep&&delta>0)delta-=Math.PI*2;
  const pts=[];
  for(let i=0;i<=24;i++){
    const a=start+delta*(i/24);
    const x=g.hx+Math.cos(a)*g.lw;
    const y=g.hy+Math.sin(a)*g.lw;
    pts.push(new THREE.Vector3(x-cfg.W/2,8,y-cfg.D/2));
  }
  const arc=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),mat);
  group.add(arc);
  const leaf=new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(g.hx-cfg.W/2,10,g.hy-cfg.D/2),
    new THREE.Vector3(g.tx-cfg.W/2,10,g.ty-cfg.D/2),
  ]),mat);
  group.add(leaf);
}

const WALL_LABELS={N:"S",E:"V",S:"J",W:"Z"};
function ElevationView({cand,cfg,wall,routing,layers=DEFAULT_LAYERS}){
  const model=buildElevation(cand.placed,cfg,wall);
  const PADL=360,PADR=160,PADT=260,PADB=280;
  const WALL=120;
  const axis=model.width;
  const yOf=(r)=>model.height-r.y-r.h;
  // INSTALACIJE v narisu — priklopi na tem zidu po višini z; gravitacijski odvod
  // pokaže PADEC (vertikala od višine priklopa navzdol do tal/vertikale).
  const inst=[];
  cand.placed.filter(p=>p.kind!=="door"&&p.wall===wall).forEach(p=>{(p.el.conns||[]).forEach(c=>{
    if(!layers[c.type])return;
    const pt=placedConnectionPoint(p,c);
    const along=(wall==="N"||wall==="S")?pt.x:pt.y;
    inst.push({along,z:connectionZ(p.el,c),color:CONN[c.type].color,gravity:MEDIA_PROFILE[c.type].gravity});
  });});
  const ticks=[];
  for(let z=0;z<=model.height;z+=500)ticks.push(z);
  if(ticks[ticks.length-1]!==model.height)ticks.push(model.height);
  const fillOf=(r)=>r.kind==="human"?"#5aa9e6":r.kind==="window"?"#86c9ff":"#dfe6df";
  const strokeOf=(r)=>r.kind==="human"?"#3a78b0":r.kind==="window"?"#3f86c9":"#2b3138";
  return <svg viewBox={`${-PADL} ${-PADT} ${axis+PADL+PADR} ${model.height+PADT+PADB}`} style={{width:"100%",height:"100%"}}>
    <rect x={-PADL} y={-PADT} width={axis+PADL+PADR} height={model.height+PADT+PADB} fill="#f6f7f3"/>
    {layers.walls&&<g>
      <rect x="0" y="0" width={axis} height={model.height} fill="#eef1ed" stroke="#2b3138" strokeWidth="16"/>
      <rect x={-WALL} y="0" width={WALL} height={model.height+WALL} fill="#d8ded7" stroke="#2b3138" strokeWidth="14"/>
      <rect x={axis} y="0" width={WALL} height={model.height+WALL} fill="#d8ded7" stroke="#2b3138" strokeWidth="14"/>
      <rect x={-WALL} y={model.height} width={axis+WALL*2} height={WALL} fill="#cfd6cf" stroke="#2b3138" strokeWidth="14"/>
      <rect x="0" y={-WALL} width={axis} height={WALL} fill="#d8ded7" stroke="#2b3138" strokeWidth="14"/>
      <line x1="0" y1="0" x2="0" y2={model.height} stroke="#7f8a96" strokeWidth="18"/>
      <line x1={axis} y1="0" x2={axis} y2={model.height} stroke="#7f8a96" strokeWidth="18"/>
    </g>}
    <g fontFamily="ui-monospace,Menlo,monospace" fill="#8a96a3">
      <text x={axis/2} y={-126} fontSize="96" textAnchor="middle">Naris {WALL_LABELS[wall]} · vzdolž zidu / višina Z</text>
      <line x1="0" y1={model.height} x2={axis} y2={model.height} stroke="#2b3138" strokeWidth="18"/>
      <line x1="-120" y1="0" x2="-120" y2={model.height} stroke="#2b3138" strokeWidth="14"/>
      {ticks.map(z=><g key={z}>
        <line x1="-160" y1={model.height-z} x2={axis} y2={model.height-z} stroke="#c7cfd6" strokeWidth="8" opacity={z===0?0:0.55}/>
        <line x1="-160" y1={model.height-z} x2="-82" y2={model.height-z} stroke="#2b3138" strokeWidth="12"/>
        <text x="-188" y={model.height-z} dy="30" fontSize="76" textAnchor="end">{z}</text>
      </g>)}
      <text x="-188" y="-46" fontSize="76" textAnchor="end">mm</text>
      <text x={axis/2} y={model.height+146} fontSize="76" textAnchor="middle">{axis} mm</text>
    </g>
    {model.rects.filter(r=>r.kind==="human"?layers.humans:r.kind==="window"?layers.windows:layers.equipment).map(r=><g key={r.id}>
      <rect x={r.x} y={yOf(r)} width={r.w} height={r.h} rx="16" fill={fillOf(r)} fillOpacity={r.kind==="human"?0.24:r.kind==="window"?0.36:0.95} stroke={strokeOf(r)} strokeWidth={r.kind==="human"?16:18} strokeDasharray={r.kind==="human"||r.kind==="window"?"52 36":"none"}/>
      {r.kind==="window"&&<line x1={r.x} y1={yOf(r)+r.h} x2={r.x+r.w} y2={yOf(r)+r.h} stroke="#3f86c9" strokeWidth="24"/>}
      <text x={r.x+r.w/2} y={yOf(r)+Math.min(r.h/2,130)} dy="32" fill={r.kind==="human"?"#2e6f9e":"#3a444f"} fontSize="78" fontFamily="ui-sans-serif,system-ui" textAnchor="middle">{r.kind==="human"?"človek":r.name}</text>
      {r.kind==="window"&&<text x={r.x+r.w/2} y={yOf(r)+r.h+86} fill="#3f86c9" fontSize="58" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle">parapet {Math.round(r.y)}</text>}
    </g>)}
    {model.conflicts.map((r,i)=><g key={"c"+i}>
      <rect x={r.x} y={model.height-r.y-r.h} width={r.w} height={r.h} fill="#c0392b" opacity=".48" stroke="#e2553f" strokeWidth="24"/>
      <text x={r.x+r.w/2} y={model.height-r.y-r.h-42} fill="#b03a2e" fontSize="64" fontFamily="ui-monospace,Menlo,monospace" textAnchor="middle">3D trk</text>
    </g>)}
    {inst.map((u,i)=><g key={"i"+i}>
      {u.gravity
        ? <g>
            <line x1={u.along} y1={model.height-u.z} x2={u.along} y2={model.height} stroke={u.color} strokeWidth="24" strokeDasharray="44 30"/>
            <path d={`M${u.along-46} ${model.height-110} L${u.along} ${model.height} L${u.along+46} ${model.height-110}`} fill="none" stroke={u.color} strokeWidth="22" strokeLinejoin="round" strokeLinecap="round"/>
            <text x={u.along+62} y={model.height-u.z/2} dy="24" fill={u.color} fontSize="62" fontFamily="ui-monospace,Menlo,monospace">padec {Math.round(u.z)}</text>
          </g>
        : <line x1={u.along-70} y1={model.height-u.z} x2={u.along+70} y2={model.height-u.z} stroke={u.color} strokeWidth="24"/>}
      <circle cx={u.along} cy={model.height-u.z} r="36" fill={u.color} stroke="#0e1116" strokeWidth="9"/>
    </g>)}
    {model.rects.length===0&&inst.length===0&&<text x={axis/2} y={model.height/2} fill="#7c8794" fontSize="86" fontFamily="ui-sans-serif,system-ui" textAnchor="middle">Na tem zidu ni elementov za naris.</text>}
  </svg>;
}

function Door({p,W,D}){
  // geometrija iz testirane čiste funkcije (geometry.doorSwing) — tečaj fiksen na
  // zidu, krilo pravokotno, lok z radijem=širina krila okoli tečaja, sweep iz atan2
  const {hx:Hx,hy:Hy,jx:Jx,jy:Jy,tx:Tx,ty:Ty,lw,sweep}=doorSwing(p.wall,p.hinge?1:0,p.dir,p.foot,W,D);
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
function ProjectNum({label,unit,v,set,min,max,step}){ return <div className="num"><div className="fhd"><span>{label}</span><span className="mono">{v}{unit?` ${unit}`:""}</span></div><input type="range" min={min} max={max} step={step} value={v} onChange={e=>set(+e.target.value)}/></div>; }

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
.constraints2{display:grid;grid-template-columns:minmax(300px,1fr) minmax(220px,.55fr);gap:1px;background:var(--bd)}
.constraints2.single{grid-template-columns:1fr}
.constraints2 .col{min-width:0}.controlCol .sec{margin-bottom:8px}.controlCol .secHd{padding:10px 0}.controlCol .secBody{padding:0 0 10px}
@media(max-width:1180px){.constraints2{grid-template-columns:1fr}}
.elementCards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px;background:var(--bd);padding:1px;margin-bottom:1px}
.elementCard{min-height:104px;display:grid;grid-template-columns:72px 1fr auto;grid-template-rows:auto 1fr;gap:6px 9px;align-items:center;text-align:left;background:var(--panel);border:1px solid transparent;color:var(--tx);padding:9px;border-radius:8px;cursor:pointer}
.elementCard.on{border-color:var(--cy);background:#0e2626}.elementCard .src{justify-self:end}.elementMini{width:72px;height:62px;grid-row:1/3;background:#f6f7f3;border-radius:6px}
.ecMain{display:flex;flex-direction:column;gap:2px;min-width:0}.ecMain b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ecMain i{font-style:normal;color:var(--mut);font-size:10.5px}
.ecMeta{grid-column:2/4;font-size:10.5px;color:var(--mut)}
.col{background:var(--panel);padding:16px 15px}
.cstage{background:var(--bg);display:flex;flex-direction:column;min-height:480px}
.legend{display:flex;gap:13px;flex-wrap:wrap;padding:12px 16px;font-size:10.5px;color:var(--mut)}
.legend span{display:flex;gap:5px;align-items:center}.legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
.viewTabs{display:flex;gap:7px;padding:0 16px 12px;flex-wrap:wrap}
.viewTabs button{height:30px;padding:0 11px;border-radius:7px;border:1px solid var(--bd);background:var(--panel);color:var(--mut);font-size:11px;cursor:pointer}
.viewTabs button.on{border-color:var(--cy);background:#0e2626;color:var(--cy)}
.sceneTgl{height:30px;display:flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--bd);border-radius:7px;color:var(--mut);font-size:11px;background:var(--panel)}
.sceneTgl input{accent-color:var(--cy)}
.sheet{flex:1;margin:0;background:#f6f7f3;border-radius:11px;border:1px solid var(--bd);overflow:hidden;min-height:360px;touch-action:none;display:flex;align-items:center;justify-content:center}
.threeHost{width:100%;height:100%;min-height:360px;display:block;touch-action:none}
.stageRow{flex:1;display:flex;gap:12px;margin:0 16px;min-height:360px}
.daljinec{flex:none;width:172px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.layGroup{display:flex;flex-direction:column;gap:5px;background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:8px 9px}
.layHd{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--tx);cursor:pointer;border-bottom:1px solid var(--bd);padding-bottom:6px}
.layItem{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--mut);cursor:pointer}
.layItem .medDot{width:10px;height:10px;border-radius:50%;flex:none}
@media(max-width:760px){.stageRow{flex-direction:column}.daljinec{width:auto;flex-direction:row;flex-wrap:wrap}}
.threeHost canvas{width:100%;height:100%;display:block}
.abStage{gap:10px;padding-bottom:12px}.abProgress{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;color:var(--mut);font-size:11px}
.abProgress label{display:flex;align-items:center;gap:7px}.abProgress input{width:120px}.bestStrip{margin:0 16px;border:1px solid var(--bd);border-radius:8px;overflow:hidden;background:var(--panel)}
.pairModeHints{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 16px;color:var(--mut);font-size:10.5px}.pairModeHints span{border:1px solid var(--bd);border-radius:7px;padding:7px 8px;background:var(--panel)}.pairModeHints b{display:block;color:var(--tx);font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:2px}
.bestMini{height:210px;background:#f6f7f3}.bestMini svg{width:100%;height:100%}.abCompare{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 16px}
.abPlanCard{min-width:0;background:var(--panel);border:1px solid var(--bd);border-radius:8px;overflow:hidden}.abHead{height:36px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 11px;font-size:12px;color:var(--tx);background:var(--panel);border-bottom:1px solid var(--bd)}
.abHead .mono{font-size:10.5px;color:var(--mut);white-space:nowrap}.abSheet{height:360px;background:#f6f7f3}.abSheet svg{width:100%;height:100%}
.newChamp,.champBadge,.challBadge{font-style:normal;font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;border-radius:5px;padding:3px 6px;margin-left:6px}
.newChamp,.champBadge{background:#10302a;color:#5bbd8b;border:1px solid #285d4b}.challBadge{background:#2a1a10;color:#d9a23b;border:1px solid #5a4420}
.abChoiceBtns{display:grid;grid-template-columns:1fr auto 1fr auto;gap:8px;margin:0 16px}.abChoiceBtns button{height:38px;border:1px solid var(--bd);border-radius:8px;background:var(--p2);color:var(--tx);cursor:pointer;padding:0 12px}.abChoiceBtns button:hover{border-color:var(--cy)}.abChoiceBtns .champStay{border-color:#285d4b;color:#5bbd8b;background:#10241f}
@media(max-width:980px){.abCompare,.pairModeHints{grid-template-columns:1fr}.abSheet{height:300px}.abChoiceBtns{grid-template-columns:1fr}}
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
.addRow{display:flex;flex-direction:column;gap:5px;margin-bottom:9px}.addRow button{background:var(--bg);border:1px solid var(--bd);color:var(--mut);padding:7px;border-radius:7px;font-size:11.5px;cursor:pointer;text-align:left;display:flex;justify-content:space-between;gap:8px;align-items:center}.addRow button:hover{border-color:var(--cy);color:var(--cy)}.addRow button.on{border-color:var(--cy);color:var(--cy);background:#0e2626}.addRow button .mono{font-size:9.5px;color:var(--mut)}
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
.inlineTgl{margin-top:10px}
.softNote{font-size:10.5px;color:var(--mut);margin-top:6px;line-height:1.45}
.poolBar{display:flex;gap:7px;align-items:center;padding:12px 16px;flex-wrap:wrap}.poolBar .mono{font-size:11px;color:var(--mut);margin-right:4px}
.thumb{width:34px;height:30px;border-radius:7px;border:1px solid var(--bd);background:var(--p2);color:var(--mut);cursor:pointer;font-size:11px}.thumb.on{border-color:var(--cy);color:var(--cy)}
.check{font-size:12px;padding:8px 11px;border-radius:7px;margin-bottom:6px;background:#13282a;color:#7fdede;border:1px solid #1f4444}
.soft2{font-size:11.5px;background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:9px 11px;margin-bottom:6px;line-height:1.5;position:relative;padding-left:24px}
.soft2 .sw{position:absolute;left:9px;top:11px;width:9px;height:9px;border-radius:2px;background:#c0392b}.soft2.none{padding-left:11px;color:var(--mut)}
.soft2 .mono{color:var(--mut)}
.drain{font-size:11.5px;line-height:1.5;color:var(--tx)}.drain .mono{color:var(--cy);font-size:14px}.drain i{color:var(--mut);font-size:10.5px}
.routeList{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.routeItem{display:flex;flex-direction:column;gap:4px;background:var(--p2);border:1px solid var(--bd);border-radius:7px;padding:8px 9px;font-size:11px;color:var(--tx)}
.routeItem.wall{border-color:#244662}.routeItem.floor{border-color:#5a4420}.routeItem.blocked{border-color:#7a3028;color:#f08a78}
.routeItem b{color:var(--cy);font-size:10.5px;white-space:nowrap}
.routeTop{display:flex;justify-content:space-between;gap:8px;align-items:center}
.medDot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.medNote{font-size:10px;line-height:1.35}
.mediaRule{font-size:10px;line-height:1.4;border-radius:6px;padding:6px 8px;margin-top:6px}
.mediaRule.grav{background:#0e1e2e;border:1px solid #234a63;color:#7fb8e6}
.mediaRule.free{background:#16201a;border:1px solid #2a4a36;color:#7fcaa0}
.zrange{flex:1;accent-color:#16b3b3;height:3px}
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
.presetRow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 0 9px}
.presetRow button{background:var(--bg);border:1px solid var(--bd);color:var(--mut);border-radius:7px;padding:8px 7px;font-size:10.5px;cursor:pointer}
.presetRow button:hover{border-color:var(--cy);color:var(--cy)}
.ifcTrainingList{display:grid;gap:9px;margin-bottom:14px}
.ifcTrainingCard{background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:10px}
.ifcTrainingCard .regen{margin-top:10px}
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
.phaseNav{grid-template-columns:repeat(5,1fr)}
@media(max-width:760px){.phaseNav{grid-template-columns:1fr 1fr}}
.phaseBtn{display:flex;align-items:center;gap:10px;text-align:left;background:var(--panel);border:1px solid var(--bd);border-radius:11px;padding:11px 13px;cursor:pointer;color:var(--tx)}
.phaseBtn.on{border-color:var(--cy);background:#0e1f1f}
.phaseBtn.sep{border-style:dashed}
.phaseTag{width:28px;height:28px;border:1.5px solid var(--cy);border-radius:8px;display:grid;place-items:center;color:var(--cy);font-weight:700;font-size:12px;flex:none}
.phaseTtl{display:flex;flex-direction:column;gap:2px;min-width:0}.phaseTtl b{font-size:13px}.phaseTtl i{font-size:10.5px;color:var(--mut);font-style:normal;line-height:1.3}
.phaseBody{background:var(--panel);border:1px solid var(--bd);border-radius:12px;overflow:hidden}
.phaseLead{padding:14px 18px;font-size:12px;line-height:1.55;color:#9fb0bd;border-bottom:1px solid var(--bd);background:var(--p2)}
.grid2c{display:grid;grid-template-columns:240px 1fr;gap:1px;background:var(--bd)}
.grid2c.setupGrid{grid-template-columns:minmax(560px,.82fr) minmax(560px,1.18fr)}
.grid2c.setupGrid.resizableSetup{grid-template-columns:minmax(480px,var(--setup-left,42%)) 10px minmax(560px,1fr)}
.grid2c.wide{grid-template-columns:1fr 290px}
.colResize{border:0;background:var(--bd);padding:0;cursor:col-resize;display:grid;place-items:center;min-width:10px}
.colResize span{width:3px;height:54px;border-radius:3px;background:#33414a}
.colResize:hover span,.colResize:focus-visible span{background:var(--cy)}
@media(max-width:1080px){.grid2c,.grid2c.wide{grid-template-columns:1fr}}
@media(max-width:1180px){.grid2c.setupGrid,.grid2c.setupGrid.resizableSetup{grid-template-columns:1fr}.colResize{display:none}}
.phaseCta{display:flex;justify-content:flex-end;padding:14px 18px;background:var(--panel)}
.ctaNext{background:#0e2626;border:1px solid #1f4444;color:var(--cy);border-radius:8px;padding:9px 18px;font-size:12.5px;cursor:pointer}.ctaNext:hover{border-color:var(--cy)}
.projectGrid{display:grid;grid-template-columns:260px 1fr 260px;gap:1px;background:var(--bd)}
.projectStage{background:var(--bg);min-width:0;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.floorProgress{display:flex;gap:10px;flex-wrap:wrap;color:var(--mut);font-size:11px}.floorProgress span{background:var(--panel);border:1px solid var(--bd);border-radius:7px;padding:7px 9px}
.floorBest,.floorCard{background:var(--panel);border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.floorBest{max-width:640px}.floorHead{height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;border-bottom:1px solid var(--bd);font-size:12px}.floorHead span{color:var(--mut);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.floorPair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.floorSvg{width:100%;height:250px;background:#f6f7f3;display:block}
.floorSignals{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:9px;font-size:10.5px;color:var(--mut)}.floorSignals span,.metricStack span{background:var(--p2);border:1px solid var(--bd);border-radius:6px;padding:7px}.floorSignals b,.metricStack b{float:right;color:var(--cy)}
.floorSignals .bad,.metricStack .bad{color:#f08a78;border-color:#7a3028}.metricStack .ok{color:#7fdede;border-color:#1f4444}
.metricStack{display:grid;gap:6px;font-size:10.5px;color:var(--mut);margin-top:10px}.floorBtns{margin:0;grid-template-columns:1fr 1fr 1fr auto}
.roomPick{display:grid;gap:6px;margin-top:8px}.roomPick button{display:flex;justify-content:space-between;gap:8px;align-items:center;text-align:left;background:var(--p2);border:1px solid var(--bd);color:var(--tx);border-radius:7px;padding:8px 9px;cursor:pointer}.roomPick button.on{border-color:var(--cy);background:#0e2626}.roomPick span{color:var(--mut);font-size:10px}
.entranceList{display:grid;gap:7px;margin-bottom:8px}.entranceItem{background:var(--p2);border:1px solid var(--bd);border-radius:8px;padding:8px 9px}.entranceItem .num{margin-bottom:8px}.entranceItem .zTop button:disabled{opacity:.35;cursor:not-allowed}
@media(max-width:1180px){.projectGrid{grid-template-columns:1fr}.floorPair{grid-template-columns:1fr}.floorBtns{grid-template-columns:1fr}}
/* zložljive sekcije desnega stolpca */
.sec{border-top:1px solid var(--bd)}.sec:first-child{border-top:none}
.secHd{width:100%;display:flex;align-items:center;gap:8px;background:none;border:none;color:var(--tx);cursor:pointer;text-align:left;padding:13px 0 11px}
.secHd .chev{color:var(--mut);font-size:11px;width:12px;flex:none}
.secHd .secTtl{margin-bottom:0}
.secHd:hover .secTtl{color:var(--cy)}
.secBody{padding-bottom:6px}
`;





