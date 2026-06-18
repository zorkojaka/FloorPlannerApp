import React, { useState, useRef, useMemo, useEffect } from "react";

/* =========================================================================
   ZAKLENJEN SISTEM — harmonika orehov
   O1 model elementa (zlozljiv) · O2 postavitev (trda jedra / mehki halo) ·
   O5 instalacije (prihaja) · O9 indukcija iz IFC (prihaja)
   ========================================================================= */

const CONN = {
  "water-in":  { name:"Dotok vode",   short:"DV", color:"#3f86c9" },
  "water-out": { name:"Odvod vode",   short:"OV", color:"#16b3b3" },
  "electric":  { name:"Elektrika",    short:"EL", color:"#d9a23b" },
  "vent":      { name:"Prezracevanje",short:"PR", color:"#9a86d0" },
};
const SIDES = { back:"zadaj", front:"spredaj", left:"levo", right:"desno" };
const uid = () => Math.random().toString(36).slice(2,8);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function baseLib(){
  return {
    toilet:{category:"toilet",name:"WC skoljka",w:400,d:600,source:"default",
      conns:[{id:uid(),type:"water-out",side:"back",off:0.5,routesTo:"floor"},{id:uid(),type:"water-in",side:"back",off:0.25,routesTo:"wall"}],
      clear:{core:650,halo:800,sat:1000,conf:0.92,scope:"room-type"}},
    sink:{category:"sink",name:"Umivalnik",w:550,d:430,source:"default",
      conns:[{id:uid(),type:"water-out",side:"back",off:0.55,routesTo:"wall"},{id:uid(),type:"water-in",side:"back",off:0.4,routesTo:"wall"}],
      clear:{core:550,halo:700,sat:900,conf:0.85,scope:"global"}},
    urinal:{category:"urinal",name:"Pisoar",w:400,d:350,source:"default",
      conns:[{id:uid(),type:"water-out",side:"back",off:0.5,routesTo:"wall"},{id:uid(),type:"water-in",side:"back",off:0.5,routesTo:"wall"}],
      clear:{core:600,halo:750,sat:900,conf:0.8,scope:"room-type"}},
    door:{category:"door",kind:"door",name:"Vrata",w:800,d:80,source:"default",conns:[],
      clear:{core:0,halo:0,sat:0,conf:1,scope:"global"}},
  };
}
const isDoor=(el)=>el && el.kind==="door";
const serviceSides=(el)=>{ const s=new Set(); for(const c of el.conns) if(c.routesTo==="wall") s.add(c.side); return [...s]; };
function orientation(el){
  const ss=serviceSides(el);
  const opp=(a,b)=>(a==="back"&&b==="front")||(a==="front"&&b==="back")||(a==="left"&&b==="right")||(a==="right"&&b==="left");
  if(ss.length===0) return {txt:"Ni priklopa na zid → prost element (otok).",warn:false,corner:false};
  if(ss.length===1) return {txt:`Servisna stran ${SIDES[ss[0]]} → ob zidu, 4 orientacije.`,warn:false,corner:false};
  if(ss.length===2) return opp(ss[0],ss[1])
    ? {txt:`Priklopa na NASPROTNIH straneh → fizicno nemogoce.`,warn:true,corner:false}
    : {txt:`Servisni strani ${SIDES[ss[0]]}+${SIDES[ss[1]]} → v VOGAL, 4 vogali.`,warn:false,corner:true};
  return {txt:`Vec priklopov na zid → najbrz neizvedljivo.`,warn:true,corner:false};
}

/* ===================== APP — harmonika ===================== */
export default function App(){
  const [library,setLibrary]=useState(baseLib());
  const [open,setOpen]=useState("O2");
  const steps=[
    {id:"O1",title:"Model elementa",sub:"priklopi določajo orientacijo · clearance kot spekter",status:"deluje"},
    {id:"O2",title:"Postavitev v sobo",sub:"trda jedra se ne prekrivajo · halo se sme (s kaznijo)",status:"deluje"},
    {id:"O5",title:"Instalacije / routing",sub:"trase od priklopov do mokrega zidu · stene/tla",status:"prihaja"},
    {id:"O9",title:"Indukcija iz IFC",sub:"reference → pravila (zamenja rocno vpisana)",status:"prihaja"},
  ];
  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="appHd">
        <span className="brand">◫ Layout Engine</span>
        <span className="bcrumb mono">oreh 1 · postavitev pohistva v sobo</span>
      </div>
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
            {(s.id==="O5"||s.id==="O9") && <Soon id={s.id}/>}
          </div>}
        </section>
      ))}
    </div>
  );
}

function Soon({id}){
  const txt=id==="O5"
    ? "Routing instalacij: realne trase od PRIKLOPNIH TOČK (iz O1) do mokrega zidu/jaška, po politiki stene ali tla. Tu dolžino odtoka računamo od dejanskega priklopa, ne od centra opreme."
    : "Indukcija: AI prebere reference/IFC in izlušči pravila v ENVELOPE obliki (jedro/halo/nasičenje/zaupanje), ki zamenjajo ročno vpisane vrednosti iz O1. Steklena škatla pokaže sklepanje.";
  return <div className="soon">{txt}</div>;
}

/* ===================== O1 ===================== */
function connXY(c,R){ if(c.side==="back")return{x:R.x+c.off*R.w,y:R.y}; if(c.side==="front")return{x:R.x+c.off*R.w,y:R.y+R.h}; if(c.side==="left")return{x:R.x,y:R.y+c.off*R.h}; return{x:R.x+R.w,y:R.y+c.off*R.h}; }
function nearestEdge(px,py,R){ const dT=Math.abs(py-R.y),dB=Math.abs(py-(R.y+R.h)),dL=Math.abs(px-R.x),dR=Math.abs(px-(R.x+R.w)); const m=Math.min(dT,dB,dL,dR);
  if(m===dT)return{side:"back",off:clamp((px-R.x)/R.w,0,1)}; if(m===dB)return{side:"front",off:clamp((px-R.x)/R.w,0,1)}; if(m===dL)return{side:"left",off:clamp((py-R.y)/R.h,0,1)}; return{side:"right",off:clamp((py-R.y)/R.h,0,1)}; }

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
        <div className="eyebrow">Knjiznica</div>
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
        <Num label="Sirina" v={el.w} set={v=>patch(e=>e.w=v)} min={250} max={2000} step={10}/>
        <Num label="Globina" v={el.d} set={v=>patch(e=>e.d=v)} min={250} max={2500} step={10}/>
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

/* ===================== O2 — postavitev ===================== */
function placeRects(el,wall,pos,W,D){ const along=el.w,depth=el.d,core=el.clear.core,halo=el.clear.halo; let foot,hard,soft;
  if(wall==="S"){foot={x:pos,y:D-depth,w:along,h:depth};hard={x:pos,y:D-depth-core,w:along,h:core};soft={x:pos,y:D-depth-halo,w:along,h:halo};}
  else if(wall==="N"){foot={x:pos,y:0,w:along,h:depth};hard={x:pos,y:depth,w:along,h:core};soft={x:pos,y:depth,w:along,h:halo};}
  else if(wall==="W"){foot={x:0,y:pos,w:depth,h:along};hard={x:depth,y:pos,w:core,h:along};soft={x:depth,y:pos,w:halo,h:along};}
  else{foot={x:W-depth,y:pos,w:depth,h:along};hard={x:W-depth-core,y:pos,w:core,h:along};soft={x:W-depth-halo,y:pos,w:halo,h:along};}
  return{foot,hard,soft};}

function doorRects(el,wall,pos,hinge,dir,W,D){ const lw=el.w,TH=80,PASS=520; let foot,sq,pass;
  if(wall==="S"){foot={x:pos,y:D-TH,w:lw,h:TH};sq={x:pos,y:D-lw,w:lw,h:lw};pass={x:pos,y:D-PASS,w:lw,h:PASS};}
  else if(wall==="N"){foot={x:pos,y:0,w:lw,h:TH};sq={x:pos,y:0,w:lw,h:lw};pass={x:pos,y:0,w:lw,h:PASS};}
  else if(wall==="W"){foot={x:0,y:pos,w:TH,h:lw};sq={x:0,y:pos,w:lw,h:lw};pass={x:0,y:pos,w:PASS,h:lw};}
  else{foot={x:W-TH,y:pos,w:TH,h:lw};sq={x:W-lw,y:pos,w:lw,h:lw};pass={x:W-PASS,y:pos,w:PASS,h:lw};}
  return{foot,swing:dir==="inward"?sq:null,pass,wall,hinge,dir,kind:"door"};}

const ovArea=(a,b)=>{const x=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));const y=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return x*y;};
const ovBox=(a,b)=>{const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);return x2>x1&&y2>y1?{x:x1,y:y1,w:x2-x1,h:y2-y1}:null;};
const insideR=(r,W,D,e=2)=>r.x>=-e&&r.y>=-e&&r.x+r.w<=W+e&&r.y+r.h<=D+e;
const distWall=(cx,cy,w,W,D)=>w==="S"?D-cy:w==="N"?cy:w==="E"?W-cx:cx;

function evalPlace(placed,cfg,soft,zones){ const {W,D,wetWall,minAisle}=cfg; const viol=[]; let halo=0; const overlaps=[];
  const fix=placed.filter(p=>p.kind!=="door"); const doors=placed.filter(p=>p.kind==="door");
  if(doors.length===0) viol.push("soba nima vrat");
  for(const p of placed) if(!insideR(p.foot,W,D)) viol.push("element izven sobe");
  // fixture vs fixture
  for(let i=0;i<fix.length;i++)for(let j=i+1;j<fix.length;j++){const a=fix[i],b=fix[j];
    if(ovArea(a.foot,b.foot)>1) viol.push("prekrivanje opreme");
    if(ovArea(a.hard,b.foot)>1||ovArea(b.hard,a.foot)>1) viol.push("oprema v trdem jedru");
    if(ovArea(a.hard,b.hard)>1) viol.push(`trdi jedri se prekrivata (${a.name}↔${b.name})`);
    const so=ovArea(a.soft,b.soft); if(so>1){halo+=so;overlaps.push({a:a.name,b:b.name,area:so,box:ovBox(a.soft,b.soft)});
      if(!soft) viol.push(`halo prekrivanje v strogem nacinu (${a.name}↔${b.name})`);}
  }
  // door (P-01): lok navznoter ne sme zadeti opreme; prehod prost; opening prost
  for(const d of doors){ for(const f of fix){
    if(ovArea(f.foot,d.foot)>1) viol.push("oprema v odprtini vrat");
    if(d.swing && ovArea(f.foot,d.swing)>1) viol.push(`vrata se odpirajo na opremo (${f.name})`);
    if(ovArea(f.foot,d.pass)>1) viol.push("oprema v prehodu vrat");
  }}
  for(let i=0;i<doors.length;i++)for(let j=i+1;j<doors.length;j++) if(ovArea(doors[i].foot,doors[j].foot)>1) viol.push("vrata se prekrivajo");
  // prepovedane cone (realne omejitve sobe)
  for(const z of (zones||[])) for(const p of placed){
    if(ovArea(p.foot,z)>1) viol.push("element v prepovedani coni");
    if(p.kind==="door"&&p.swing&&ovArea(p.swing,z)>1) viol.push("lok vrat v prepovedani coni");
  }
  // prehod (brez vrat v izracunu protrudov)
  const ext={N:0,S:0,E:0,W:0}; for(const p of fix){const e=(p.wall==="N"||p.wall==="S")?p.foot.h+p.el.clear.core:p.foot.w+p.el.clear.core; if(e>ext[p.wall])ext[p.wall]=e;}
  const aisle=Math.min(W-ext.E-ext.W,D-ext.N-ext.S); if(aisle<minAisle) viol.push("prehod preozek");
  let drain=0; for(const p of fix){const c={x:p.foot.x+p.foot.w/2,y:p.foot.y+p.foot.h/2};drain+=distWall(c.x,c.y,wetWall,W,D);}
  const valid=viol.length===0; const maxDim=Math.max(W,D);
  const haloN=clamp(halo/(maxDim*maxDim*0.25),0,1); const drainN=clamp(fix.length?drain/(fix.length*maxDim):0,0,1);
  const score=1-(haloN*0.5+drainN*0.5);
  return {valid,viol:[...new Set(viol)],halo,overlaps,aisle,drain,score};
}

function O2({library}){
  const [W,setW]=useState(1900),[D,setD]=useState(2200),[wet,setWet]=useState("S");
  const [prog,setProg]=useState([{id:uid(),key:"door",w:800,dir:"auto",wall:"auto",hinge:"auto"},{id:uid(),key:"toilet"},{id:uid(),key:"sink"}]);
  const [soft,setSoft]=useState(true);
  const [zones,setZones]=useState([]);
  const setZone=(id,patch)=>setZones(Z=>Z.map(z=>z.id===id?{...z,...patch}:z));
  const [pool,setPool]=useState([]); const [idx,setIdx]=useState(0); const [seed,setSeed]=useState(0);
  const cfg=useMemo(()=>({W,D,wetWall:wet,minAisle:800}),[W,D,wet]);
  const WALLS=["N","S","E","W"];

  useEffect(()=>{
    const insts=prog.map(p=>({...p,el:library[p.key]})).filter(p=>p.el && (isDoor(p.el)||serviceSides(p.el).length<=1));
    const out=[];
    for(let s=0;s<1100;s++){ const placed=[]; let ok=true;
      for(const inst of insts){ const el=inst.el;
        if(isDoor(el)){ const wall=inst.wall!=="auto"?inst.wall:WALLS[Math.floor(Math.random()*4)];
          const wlen=(wall==="N"||wall==="S")?W:D; const span=wlen-(inst.w||el.w); if(span<80){ok=false;break;}
          const pos=inst.fixedPos?clamp((inst.fpos??0.5)*span,0,span):Math.random()*span;
          const hinge=inst.hinge!=="auto"&&inst.hinge!==undefined?inst.hinge:(Math.random()<0.5?0:1);
          const dir=inst.dir!=="auto"?inst.dir:(Math.random()<0.5?"inward":"outward");
          const r=doorRects({...el,w:inst.w||el.w},wall,pos,hinge,dir,W,D);
          placed.push({...r,el,wall,name:el.name});
        } else { const wall=WALLS[Math.floor(Math.random()*4)]; const wlen=(wall==="N"||wall==="S")?W:D;
          if(wlen<el.w){ok=false;break;} const pos=Math.random()*(wlen-el.w);
          const r=placeRects(el,wall,pos,W,D); placed.push({...r,el,wall,name:el.name}); }
      }
      if(!ok) continue; const ev=evalPlace(placed,cfg,soft,zones); if(ev.valid) out.push({placed,ev});
    }
    const seen=new Set(); const uniq=[];
    for(const c of out){const k=c.placed.map(p=>`${p.name[0]}${p.wall}${Math.round(p.foot.x/120)}${Math.round(p.foot.y/120)}${p.dir||""}`).join("|");if(!seen.has(k)){seen.add(k);uniq.push(c);}}
    uniq.sort((a,b)=>b.ev.score-a.ev.score); setPool(uniq.slice(0,40)); setIdx(0);
  },[library,prog,W,D,wet,soft,zones,seed,cfg]);

  const cornerEls=prog.filter(p=>{const e=library[p.key];return e&&!isDoor(e)&&serviceSides(e).length>1;});
  const hasDoor=prog.some(p=>isDoor(library[p.key]));
  const best=pool[idx];
  const setInst=(id,patch)=>setProg(P=>P.map(p=>p.id===id?{...p,...patch}:p));
  return (
   <div className="o2">
    <div className="grid3">
      <aside className="col">
        <div className="eyebrow">Prostor</div>
        <Num label="Sirina" v={W} set={setW} min={1200} max={5000} step={50}/>
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
        {cornerEls.length>0 && <div className="warnNote">Kotni elementi rabijo vogalno postavitev — pride kasneje.</div>}
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
        <div className="ifaceNote">Vmesnik omejitev: zdaj jih vnašaš ti (steber, okno, obstoječa vrata). Kasneje jih engine za razporeditev sob napolni sam — kje so vrata, koliko m².</div>
        <label className="softTgl"><input type="checkbox" checked={soft} onChange={e=>setSoft(e.target.checked)}/> <span>Mehka pravila: halo se sme upogniti</span></label>
        <div className="softNote">{soft?"Halo se sme prekriti (kazen). Lok vrat ostane TRDO pravilo — vanj nikoli.":"Strogo: vsako prekrivanje halo = zavrnitev."}</div>
        <button className="regen" onClick={()=>setSeed(s=>s+1)}>↻ Generiraj</button>
      </aside>

      <main className="cstage">
        <div className="legend mono"><span><i style={{background:"#2b3138"}}/>oprema</span><span><i style={{background:"#e2553f"}}/>jedro</span><span><i style={{background:"#d9a23b",opacity:.5}}/>halo</span><span><i style={{background:"#c0392b"}}/>halo prekrit</span><span><i style={{background:"#5aa9e6"}}/>lok vrat</span><span><i style={{background:"#16b3b3"}}/>mokri zid</span></div>
        <div className="sheet">{best? <O2Plan cand={best} cfg={cfg} zones={zones}/> : <div className="noRes">{!hasDoor?"Dodaj vrata — soba brez vrat nima veljavne rešitve.":soft?"Ni veljavne razporeditve ob teh omejitvah. Povečaj prostor ali zrahljaj zahteve.":"V strogem načinu ni rešitve — vklopi mehka pravila."}</div>}</div>
        <div className="poolBar">{pool.length>0 && <><span className="mono">{pool.length} veljavnih</span>{pool.slice(0,8).map((c,i)=><button key={i} className={"thumb "+(idx===i?"on":"")} onClick={()=>setIdx(i)}><span className="mono">{(c.ev.score*100|0)}</span></button>)}</>}</div>
      </main>

      <aside className="col">
        {best? <>
          <div className="eyebrow">Preverba pravil · ocena <span className="mono">{(best.ev.score*100|0)}</span></div>
          <div className="check ok2">✓ trda jedra se ne prekrivajo</div>
          <div className="check ok2">✓ lok vrat prost (P-01)</div>
          <div className="check ok2">✓ prehod {Math.round(best.ev.aisle)} mm ≥ {cfg.minAisle}</div>
          <div className="eyebrow mt">Mehke kazni (halo)</div>
          {best.ev.overlaps.length>0 ? best.ev.overlaps.map((o,i)=>(
            <div key={i} className="soft2"><span className="sw"/>{o.a} ↔ {o.b}<br/><span className="mono">{(o.area/1e6).toFixed(2)} m² → dovoljeno, kaznovano</span></div>
          )) : <div className="soft2 none">brez prekrivanj halo — čista razporeditev</div>}
          <div className="eyebrow mt">Instalacije</div>
          <div className="drain"><span className="mono">{(best.ev.drain/1000).toFixed(2)} m</span> skupni odtok<br/><i>O5 bo računal od priklopne točke</i></div>
        </> : <div className="noRes2">Ni veljavne rešitve za te zahteve.</div>}
      </aside>
    </div>
   </div>);
}

function O2Plan({cand,cfg,zones}){ const {W,D,wetWall}=cfg; const PAD=900; const we=wallEdge(wetWall,W,D);
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
  // sweep iz dejanskega kota: lok od T do J okoli H, krajsa pot (90°)
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

function wallEdge(w,W,D){ if(w==="S")return{x1:0,y1:D,x2:W,y2:D}; if(w==="N")return{x1:0,y1:0,x2:W,y2:0}; if(w==="W")return{x1:0,y1:0,x2:0,y2:D}; return{x1:W,y1:0,x2:W,y2:D}; }


/* ===================== mali gradniki ===================== */
function ZNum({label,v,set,max}){ return <label className="znum"><span>{label}</span><input type="range" min="0" max={max} step="50" value={v} onChange={e=>set(+e.target.value)}/><b className="mono">{v}</b></label>; }
function Num({label,v,set,min,max,step,c}){ return <div className="num"><div className="fhd"><span>{label}</span><span className="mono" style={c?{color:c}:{}}>{v}{label.match(/Sirina|Globina|Jedro|Halo/)?" mm":""}</span></div><input type="range" min={min} max={max} step={step} value={v} onChange={e=>set(+e.target.value)} style={c?{accentColor:c}:{}}/></div>; }

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
`;
