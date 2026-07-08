/**
 * Stavba · PoC — gnezdenje (Oreh 2): enota = soba, prostor = stavba.
 * Demo zgodba: A reference (resnica) → B inducirana pravila → C nova naloga
 * → D kandidati → E A/B izostritev → izhodišče za ročno delo.
 */

import { useMemo, useState } from 'react';
import { baseReferences } from './references';
import { induceBuildingRules, type BuildingRuleset, type MetricRule } from './induction';
import {
  checkBriefFeasibility,
  generateBuildingCandidates,
  type BuildingBrief,
} from './generator';
import { evaluateBuildingCandidate, type BuildingCandidate } from './evaluator';
import {
  buildingScore,
  initialBuildingPreference,
  pickBuildingPair,
  rankBuildingCandidates,
  recordBuildingPreference,
  SIGNAL_LABELS,
  type BuildingPreferenceState,
} from './preference';
import { toM2, validateReferencePlan, type ReferencePlan, type WallSide } from './schema';
import { PlanLegend, PlanSvg } from './PlanSvg';
import { EXTRACTION_PROMPT } from './extractionPrompt';
import {
  furnishFloor,
  FURNISH_PRESETS,
  defaultPresetId,
  type RoomFurnishing,
} from './furnish';
import { loadJson, saveJson } from '../shared/storage';

type StepId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

function usePersistentState<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
  const [value, setValue] = useState<T>(() => loadJson(storage, key, fallback));
  const update = (next: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      saveJson(storage, key, resolved);
      return resolved;
    });
  };
  return [value, update];
}

const SIDE_LABELS: Record<WallSide, string> = {
  N: 'sever (zgoraj)',
  S: 'jug (spodaj)',
  E: 'vzhod (desno)',
  W: 'zahod (levo)',
};

const DEFAULT_BRIEF: BuildingBrief = {
  W: 26000,
  D: 12500,
  entrance: { side: 'W', offset: 6200 },
  offices: 9,
  wcs: 2,
};

export default function BuildingPoC() {
  const [step, setStep] = usePersistentState<StepId>('floorplanner.bp.step', 'A');
  const [refs, setRefs] = usePersistentState<ReferencePlan[]>(
    'floorplanner.bp.refs.v1',
    baseReferences(),
  );
  const [brief, setBrief] = usePersistentState<BuildingBrief>('floorplanner.bp.brief', DEFAULT_BRIEF);
  const [pref, setPref] = usePersistentState<BuildingPreferenceState>(
    'floorplanner.bp.pref',
    initialBuildingPreference(),
  );
  const [seedBase, setSeedBase] = useState(1);
  const [pool, setPool] = useState<BuildingCandidate[] | null>(null);
  const [genMsg, setGenMsg] = useState<{ kind: 'infeasible' | 'search'; text: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [finalPlan, setFinalPlan] = useState<ReferencePlan | null>(null);
  const [furnishChoices, setFurnishChoices] = useState<Record<string, string>>({});

  const ruleset = useMemo(() => induceBuildingRules(refs), [refs]);

  const generate = (seed = seedBase) => {
    const output = generateBuildingCandidates(brief, ruleset, 10, seed);
    if (output.infeasible) {
      setPool(null);
      setGenMsg({ kind: 'infeasible', text: output.infeasible });
      return;
    }
    if (output.plans.length === 0) {
      setPool(null);
      setGenMsg({ kind: 'search', text: output.searchNote || 'Nisem našel postavitve.' });
      return;
    }
    setGenMsg(
      output.searchNote ? { kind: 'search', text: output.searchNote } : null,
    );
    setPool(output.plans.map((plan) => evaluateBuildingCandidate(plan, brief, ruleset)));
    setDetailId(null);
    setFinalPlan(null);
  };

  const steps: Array<{ id: StepId; tag: string; title: string; sub: string }> = [
    { id: 'A', tag: 'A', title: 'Reference', sub: 'resnica — načrti, iz katerih se učimo' },
    { id: 'B', tag: 'B', title: 'Inducirana pravila', sub: 'statistika referenc → envelope' },
    { id: 'C', tag: 'C', title: 'Nova naloga', sub: 'druga stavba, drug vhod, druga števila' },
    { id: 'D', tag: 'D', title: 'Kandidati', sub: 'deterministični generator + ocena' },
    { id: 'E', tag: 'E', title: 'A/B izostritev', sub: 'tvoje izbire → uteži → izhodišče' },
    { id: 'F', tag: 'F', title: 'Oprema po sobah', sub: 'vsak prostor skozi engine — cela etaža' },
  ];

  return (
    <div className="bp">
      <style>{CSS}</style>
      <div className="bpNav">
        {steps.map((item) => (
          <button
            key={item.id}
            className={'bpStep' + (step === item.id ? ' on' : '')}
            onClick={() => setStep(item.id)}
          >
            <span className="bpTag">{item.tag}</span>
            <span className="bpTtl">
              <b>{item.title}</b>
              <i>{item.sub}</i>
            </span>
          </button>
        ))}
      </div>

      {step === 'A' && (
        <StepReferences
          refs={refs}
          setRefs={setRefs}
          onNext={() => setStep('B')}
        />
      )}
      {step === 'B' && <StepRules ruleset={ruleset} refCount={refs.length} onNext={() => setStep('C')} />}
      {step === 'C' && (
        <StepBrief
          brief={brief}
          setBrief={setBrief}
          ruleset={ruleset}
          onGenerate={() => {
            generate();
            setStep('D');
          }}
        />
      )}
      {step === 'D' && (
        <StepCandidates
          pool={pool}
          genMsg={genMsg}
          pref={pref}
          detailId={detailId}
          setDetailId={setDetailId}
          onGenerate={() => generate()}
          onReseed={() => {
            const seed = seedBase + 1;
            setSeedBase(seed);
            generate(seed);
          }}
          onNext={() => setStep('E')}
        />
      )}
      {step === 'E' && (
        <StepAB
          pool={pool}
          pref={pref}
          onChoose={(winner, loser) => setPref(recordBuildingPreference(pref, winner, loser))}
          onResetLearning={() => setPref(initialBuildingPreference())}
          finalPlan={finalPlan}
          onAdopt={(plan) => setFinalPlan(plan)}
          onAdoptAsReference={(plan) => {
            const next: ReferencePlan = {
              ...plan,
              id: `U${refs.length + 1}`,
              name: `Potrjeni kandidat (uporabnik) — ${new Date().toLocaleDateString('sl-SI')}`,
              source: 'user',
            };
            setRefs([...refs, next]);
          }}
          onFurnish={() => setStep('F')}
        />
      )}
      {step === 'F' && (
        <StepFurnish
          plan={finalPlan}
          choices={furnishChoices}
          setChoice={(roomId, presetId) =>
            setFurnishChoices((prev) => ({ ...prev, [roomId]: presetId }))
          }
          resetChoices={() => setFurnishChoices({})}
        />
      )}
    </div>
  );
}

/* ───────────────────────── A: Reference ───────────────────────── */

function StepReferences({
  refs,
  setRefs,
  onNext,
}: {
  refs: ReferencePlan[];
  setRefs: (next: ReferencePlan[]) => void;
  onNext: () => void;
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(EXTRACTION_PROMPT);
      setMsg('Prompt skopiran — priloži mu sliko načrta v Claudu, vrnjeni JSON prilepi sem.');
    } catch {
      setMsg('Kopiranje ni uspelo — prompt je v razdelku spodaj.');
    }
  };

  const addReference = () => {
    try {
      const plan = validateReferencePlan(JSON.parse(pasteValue));
      if (refs.some((ref) => ref.id === plan.id)) throw new Error(`Referenca z id "${plan.id}" že obstaja.`);
      setRefs([...refs, plan]);
      setPasteValue('');
      setShowPaste(false);
      setMsg(`Referenca "${plan.name}" dodana — pravila se ponovno inducirajo.`);
    } catch (error) {
      setMsg(`Napaka: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="bpBody">
      <p className="bpLead">
        To je <b>resnica</b>: potrjeni načrti, iz katerih se sistem uči. V produkcijskem toku jih
        prebere AI iz naloženih načrtov (slika/PDF/DWG) in vrne strukturiran zapis, človek mere
        preveri. Za PoC je naloženih {refs.length} referenc; svojo dodaš prek AI-ekstrakcijskega
        prompta.
      </p>
      <div className="bpRow">
        <button className="bpBtn" onClick={copyPrompt}>📋 Kopiraj AI-ekstrakcijski prompt</button>
        <button className="bpBtn" onClick={() => setShowPaste(!showPaste)}>
          {showPaste ? 'Skrij' : '＋ Prilepi ekstrahiran JSON'}
        </button>
        <button
          className="bpBtn ghost"
          onClick={() => {
            setRefs(baseReferences());
            setMsg('Reference ponastavljene na privzetih 6.');
          }}
        >
          Ponastavi na privzete
        </button>
      </div>
      {msg && <div className="bpMsg">{msg}</div>}
      {showPaste && (
        <div className="bpPaste">
          <textarea
            value={pasteValue}
            onChange={(event) => setPasteValue(event.target.value)}
            placeholder='{"id": "...", "name": "...", "outline": {...}, "rooms": [...]}'
            rows={8}
          />
          <button className="bpBtn primary" onClick={addReference}>Preveri in dodaj referenco</button>
        </div>
      )}
      <details className="bpDetails">
        <summary>AI-ekstrakcijski prompt (ogled)</summary>
        <pre>{EXTRACTION_PROMPT}</pre>
      </details>
      <PlanLegend />
      <div className="bpGrid">
        {refs.map((ref) => {
          const open = openId === ref.id;
          return (
            <div
              key={ref.id}
              className={'bpCard' + (open ? ' open' : '')}
              onClick={() => setOpenId(open ? null : ref.id)}
            >
              <div className="bpCardHd">
                <b>{ref.name}</b>
                <span className={'bpSrc ' + ref.source}>
                  {ref.source === 'synthetic' ? 'sintetična' : ref.source === 'user' ? 'uporabnik' : 'AI-ekstrakcija'}
                </span>
              </div>
              <PlanSvg plan={ref} width={open ? 640 : 300} showLabels={open} />
              <div className="bpCardFt">
                {ref.rooms.filter((room) => room.type === 'office').length} pisarn ·{' '}
                {ref.rooms.filter((room) => room.type === 'wc').length} WC ·{' '}
                {toM2(ref.outline.w * ref.outline.h).toFixed(0)} m²
              </div>
              {open && (
                <details className="bpDetails" onClick={(event) => event.stopPropagation()}>
                  <summary>Strukturiran zapis (JSON)</summary>
                  <pre>{JSON.stringify(ref, null, 2)}</pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
      <div className="bpCta">
        <button className="bpBtn primary" onClick={onNext}>Naprej → induciraj pravila</button>
      </div>
    </div>
  );
}

/* ───────────────────────── B: Pravila ───────────────────────── */

function fmtMetric(rule: MetricRule, value: number): string {
  if (rule.unit === 'm2') return `${value.toFixed(1)} m²`;
  if (rule.unit === '%') return `${value.toFixed(1)} %`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} m`;
  return `${Math.round(value)} mm`;
}

const MODE_LABELS: Record<MetricRule['mode'], string> = {
  band: 'ciljno območje',
  atLeast: 'najmanj — jedro je trdo',
  atMost: 'največ — mehko s kaznijo',
};

function StepRules({
  ruleset,
  refCount,
  onNext,
}: {
  ruleset: BuildingRuleset;
  refCount: number;
  onNext: () => void;
}) {
  return (
    <div className="bpBody">
      <p className="bpLead">
        Iz {refCount} referenc inducirana pravila — <b>brez ročnega vnosa</b>. Ista statistika kot
        pri opremi-v-sobi: najmanjša opažena vrednost → <b>trdo jedro</b>, mediana → <b>halo</b>{' '}
        (želeno), 90. percentil → <b>nasičenje</b>; <b>zaupanje</b> pade z varianco referenc.
        Sosedstva: relacija, ki drži v 100 % referenc, postane trdo pravilo, sicer mehka utež.
      </p>
      <div className="bpPanel">
        <h3>Metrična pravila (envelope)</h3>
        <table className="bpTable">
          <thead>
            <tr>
              <th>Pravilo</th>
              <th>Jedro</th>
              <th>Halo</th>
              <th>Nasičenje</th>
              <th>Zaupanje</th>
              <th>n</th>
              <th>Način</th>
            </tr>
          </thead>
          <tbody>
            {ruleset.metrics.map((rule) => (
              <tr key={rule.key}>
                <td>{rule.label}</td>
                <td>{fmtMetric(rule, rule.envelope.core)}</td>
                <td className="hl">{fmtMetric(rule, rule.envelope.halo)}</td>
                <td>{fmtMetric(rule, rule.envelope.sat)}</td>
                <td>
                  <span className="bpConf">
                    <span style={{ width: `${rule.envelope.conf * 100}%` }} />
                  </span>{' '}
                  {(rule.envelope.conf * 100).toFixed(0)} %
                </td>
                <td>{rule.count}</td>
                <td className="dim">{MODE_LABELS[rule.mode]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bpPanel">
        <h3>Pravila sosedstev</h3>
        {ruleset.adjacency.map((rule) => (
          <div key={rule.key} className="bpAdj">
            <span className="bpAdjLabel">{rule.label}</span>
            <span className="bpConf wide">
              <span style={{ width: `${rule.freq * 100}%` }} />
            </span>
            <span className="dim">
              {rule.observed}/{rule.total}
            </span>
            <span className={'bpBadge ' + (rule.hard ? 'hard' : 'soft')}>
              {rule.hard ? 'TRDO' : `mehko · ${(rule.freq * 100).toFixed(0)} %`}
            </span>
          </div>
        ))}
      </div>
      <div className="bpCta">
        <button className="bpBtn primary" onClick={onNext}>Naprej → nova naloga</button>
      </div>
    </div>
  );
}

/* ───────────────────────── C: Naloga ───────────────────────── */

function StepBrief({
  brief,
  setBrief,
  ruleset,
  onGenerate,
}: {
  brief: BuildingBrief;
  setBrief: (next: BuildingBrief) => void;
  ruleset: BuildingRuleset;
  onGenerate: () => void;
}) {
  const feasibility = checkBriefFeasibility(brief, ruleset);
  const maxOffset = brief.entrance.side === 'W' || brief.entrance.side === 'E' ? brief.D : brief.W;

  const num = (value: number, digits = 1) => Number((value / 1000).toFixed(digits));

  return (
    <div className="bpBody">
      <p className="bpLead">
        Nova naloga — <b>drugačna od vseh referenc</b>: druga kvadratura, drug vhod, druga števila
        sob. Engine ne kopira nobene reference; postavlja po induciranih pravilih.
      </p>
      <div className="bpPanel">
        <div className="bpForm">
          <label>
            Širina stavbe [m]
            <input
              type="number"
              min={8}
              max={60}
              step={0.5}
              value={num(brief.W)}
              onChange={(event) => setBrief({ ...brief, W: Number(event.target.value) * 1000 })}
            />
          </label>
          <label>
            Globina stavbe [m]
            <input
              type="number"
              min={6}
              max={40}
              step={0.5}
              value={num(brief.D)}
              onChange={(event) => setBrief({ ...brief, D: Number(event.target.value) * 1000 })}
            />
          </label>
          <label>
            Stran vhoda
            <select
              value={brief.entrance.side}
              onChange={(event) =>
                setBrief({
                  ...brief,
                  entrance: { ...brief.entrance, side: event.target.value as WallSide },
                })
              }
            >
              {(Object.keys(SIDE_LABELS) as WallSide[]).map((side) => (
                <option key={side} value={side}>
                  {SIDE_LABELS[side]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Odmik vhoda [m] <span className="dim">(0–{(maxOffset / 1000).toFixed(1)})</span>
            <input
              type="number"
              min={0.5}
              max={maxOffset / 1000}
              step={0.5}
              value={num(brief.entrance.offset)}
              onChange={(event) =>
                setBrief({
                  ...brief,
                  entrance: { ...brief.entrance, offset: Number(event.target.value) * 1000 },
                })
              }
            />
          </label>
          <label>
            Število pisarn
            <input
              type="number"
              min={1}
              max={30}
              value={brief.offices}
              onChange={(event) => setBrief({ ...brief, offices: Number(event.target.value) })}
            />
          </label>
          <label>
            Število WC
            <input
              type="number"
              min={0}
              max={6}
              value={brief.wcs}
              onChange={(event) => setBrief({ ...brief, wcs: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className={'bpFeas ' + (feasibility ? 'bad' : 'good')}>
          {feasibility ||
            `Izvedljivo: ${toM2(brief.W * brief.D).toFixed(0)} m² stavbe za ${brief.offices} pisarn + ${brief.wcs} WC (trda jedra se izidejo).`}
        </div>
      </div>
      <div className="bpCta">
        <button className="bpBtn primary" disabled={!!feasibility} onClick={onGenerate}>
          Generiraj kandidate →
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── D: Kandidati ───────────────────────── */

function StepCandidates({
  pool,
  genMsg,
  pref,
  detailId,
  setDetailId,
  onGenerate,
  onReseed,
  onNext,
}: {
  pool: BuildingCandidate[] | null;
  genMsg: { kind: 'infeasible' | 'search'; text: string } | null;
  pref: BuildingPreferenceState;
  detailId: string | null;
  setDetailId: (id: string | null) => void;
  onGenerate: () => void;
  onReseed: () => void;
  onNext: () => void;
}) {
  if (genMsg && !pool) {
    return (
      <div className="bpBody">
        <div className={'bpFeas ' + (genMsg.kind === 'infeasible' ? 'bad' : 'warn')}>
          <b>{genMsg.kind === 'infeasible' ? 'Trdo neizvedljivo.' : 'Iskanje ni uspelo.'}</b>{' '}
          {genMsg.text}
        </div>
        <div className="bpCta">
          <button className="bpBtn" onClick={onReseed}>Poskusi z drugim semenom</button>
        </div>
      </div>
    );
  }
  if (!pool) {
    return (
      <div className="bpBody">
        <p className="bpLead">Kandidati še niso generirani.</p>
        <button className="bpBtn primary" onClick={onGenerate}>Generiraj kandidate</button>
      </div>
    );
  }

  const ranked = rankBuildingCandidates(pool, pref.weights);
  const detail = pool.find((candidate) => candidate.id === detailId) || null;

  return (
    <div className="bpBody">
      <p className="bpLead">
        {pool.length} kandidatov — deterministični generator (hodnik od vhoda, sobe obojestransko,
        WC praviloma ob vhodu), razvrščeni po trenutnih utežeh. Vsaka ocena je razložljiva — klikni
        kandidata.
      </p>
      <div className="bpRow">
        <button className="bpBtn" onClick={onReseed}>🎲 Nova serija (drugo seme)</button>
        <button className="bpBtn primary" onClick={onNext}>Naprej → A/B izostritev</button>
      </div>
      <div className="bpGrid">
        {ranked.map((candidate, index) => (
          <div
            key={candidate.id}
            className={'bpCard' + (detailId === candidate.id ? ' sel' : '')}
            onClick={() => setDetailId(detailId === candidate.id ? null : candidate.id)}
          >
            <div className="bpCardHd">
              <b>
                #{index + 1} · {candidate.id}
              </b>
              <span className={'bpScore' + (candidate.hardOk ? '' : ' bad')}>
                {candidate.hardOk ? `${(buildingScore(candidate, pref.weights) * 100).toFixed(0)} %` : 'trda kršitev'}
              </span>
            </div>
            <PlanSvg plan={candidate.plan} width={300} />
            <div className="bpPens">
              {(Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>).map((key) => (
                <span key={key} title={SIGNAL_LABELS[key]} className="bpPen">
                  <i style={{ width: `${candidate.penalties[key] * 100}%` }} />
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {detail && (
        <div className="bpPanel">
          <h3>
            {detail.id} — razlaga ocene
          </h3>
          <div className="bpDetailGrid">
            <PlanSvg plan={detail.plan} width={620} showLabels />
            <div>
              {!detail.hardOk && (
                <div className="bpFeas bad">
                  {detail.hardFails.map((fail, index) => (
                    <div key={index}>✕ {fail}</div>
                  ))}
                </div>
              )}
              <ul className="bpChecks">
                {detail.checks.map((check, index) => (
                  <li key={index} className={check.status}>
                    <span className="mark">
                      {check.status === 'ok' ? '✓' : check.status === 'warn' ? '~' : '✕'}
                    </span>
                    <b>{check.label}</b> — {check.detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── E: A/B ───────────────────────── */

function StepAB({
  pool,
  pref,
  onChoose,
  onResetLearning,
  finalPlan,
  onAdopt,
  onAdoptAsReference,
  onFurnish,
}: {
  pool: BuildingCandidate[] | null;
  pref: BuildingPreferenceState;
  onChoose: (winner: BuildingCandidate, loser: BuildingCandidate) => void;
  onResetLearning: () => void;
  finalPlan: ReferencePlan | null;
  onAdopt: (plan: ReferencePlan) => void;
  onAdoptAsReference: (plan: ReferencePlan) => void;
  onFurnish: () => void;
}) {
  const [adoptedRef, setAdoptedRef] = useState(false);
  if (!pool || pool.length < 2) {
    return (
      <div className="bpBody">
        <p className="bpLead">Najprej generiraj kandidate (korak D).</p>
      </div>
    );
  }
  const pair = pickBuildingPair(pool, pref.weights);
  const champion = rankBuildingCandidates(pool, pref.weights)[0];

  return (
    <div className="bpBody">
      <p className="bpLead">
        Izbiraj boljšega od para — vsaka izbira premakne uteži signala, kjer se kandidata najbolj
        razlikujeta. Po stabilnem nizu izbir sistem konvergira in ponudi izhodišče za ročno delo.
      </p>
      <div className="bpAbGrid">
        <div className="bpAbPair">
          {pair &&
            !finalPlan &&
            pair.map((candidate, index) => (
              <div key={candidate.id} className="bpCard ab">
                <div className="bpCardHd">
                  <b>{index === 0 ? 'A' : 'B'} · {candidate.id}</b>
                  <span className="bpScore">
                    {(buildingScore(candidate, pref.weights) * 100).toFixed(0)} %
                  </span>
                </div>
                <PlanSvg plan={candidate.plan} width={430} showLabels />
                <button
                  className="bpBtn primary"
                  onClick={() => onChoose(candidate, pair[index === 0 ? 1 : 0])}
                >
                  Ta je boljši
                </button>
              </div>
            ))}
          {finalPlan && (
            <div className="bpCard ab">
              <div className="bpCardHd">
                <b>Izhodišče za ročno urejanje</b>
                <span className="bpScore">izbrano</span>
              </div>
              <PlanSvg plan={finalPlan} width={640} showLabels />
              <p className="dim" style={{ margin: '8px 0 0' }}>
                Od tu naprej prevzame projektant: kandidat je izhodišče, ne končni načrt. Vsaka soba
                lahko gre nato skozi obstoječi engine opreme-v-sobi (Oreh 1) — gnezdenje.
              </p>
              <button className="bpBtn primary" style={{ marginTop: 10 }} onClick={onFurnish}>
                Naprej → oprema po sobah (cela etaža)
              </button>
            </div>
          )}
        </div>
        <div className="bpPanel bpAbSide">
          <h3>Naučene uteži</h3>
          {(Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>).map((key) => (
            <div key={key} className="bpAdj">
              <span className="bpAdjLabel">{SIGNAL_LABELS[key]}</span>
              <span className="bpConf wide">
                <span style={{ width: `${pref.weights[key] * 100}%` }} />
              </span>
              <span className="dim">{(pref.weights[key] * 100).toFixed(0)} %</span>
            </div>
          ))}
          <div className="bpAbStats">
            primerjav: <b>{pref.comparisons}</b> · prevladujoč signal:{' '}
            <b>{pref.dominantSignal === 'balanced' ? 'uravnotežen' : SIGNAL_LABELS[pref.dominantSignal]}</b>{' '}
            · niz: <b>{pref.stableStreak}</b>
          </div>
          <div className={'bpBadge ' + (pref.converged ? 'hard' : 'soft')} style={{ alignSelf: 'flex-start' }}>
            {pref.converged ? 'KONVERGIRANO' : 'še se uči'}
          </div>
          {pref.converged && !finalPlan && (
            <button className="bpBtn primary" onClick={() => onAdopt(champion.plan)}>
              ✓ Uporabi šampiona kot izhodišče
            </button>
          )}
          {!pref.converged && !finalPlan && (
            <button className="bpBtn ghost" onClick={() => onAdopt(champion.plan)}>
              Prevzemi trenutnega šampiona brez konvergence
            </button>
          )}
          {finalPlan && !adoptedRef && (
            <button
              className="bpBtn"
              onClick={() => {
                onAdoptAsReference(finalPlan);
                setAdoptedRef(true);
              }}
            >
              ↻ Dodaj med reference (zanka učenja)
            </button>
          )}
          {adoptedRef && (
            <div className="bpMsg">
              Dodano med reference — pravila se ob naslednji indukciji ostrijo tudi iz tvoje izbire.
            </div>
          )}
          <button className="bpBtn ghost" onClick={onResetLearning}>Ponastavi učenje</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── F: Oprema po sobah ───────────────────────── */

const STATUS_LABEL: Record<RoomFurnishing['status'], string> = {
  found: 'opremljeno',
  empty: 'samo vrata',
  'not-found': 'ni šlo',
  infeasible: 'neizvedljivo',
};

function StepFurnish({
  plan,
  choices,
  setChoice,
  resetChoices,
}: {
  plan: ReferencePlan | null;
  choices: Record<string, string>;
  setChoice: (roomId: string, presetId: string) => void;
  resetChoices: () => void;
}) {
  const furnishings = useMemo(() => (plan ? furnishFloor(plan, choices) : []), [plan, choices]);
  const floorItems = useMemo(() => furnishings.flatMap((f) => f.items), [furnishings]);

  if (!plan) {
    return (
      <div className="bpBody">
        <p className="bpLead">
          Najprej v koraku <b>E</b> prevzemi izhodiščni tloris (gumb »Uporabi šampiona kot
          izhodišče«). Nato se tu vsak prostor opremi skozi engine Oreh 1.
        </p>
      </div>
    );
  }

  const rooms = furnishings.filter((f) => f.room.type !== 'corridor');
  const okCount = rooms.filter((f) => f.status === 'found' || f.status === 'empty').length;
  const failCount = rooms.length - okCount;

  return (
    <div className="bpBody">
      <p className="bpLead">
        <b>Gnezdenje</b>: vsak prostor etaže gre skozi engine opreme-v-sobi (Oreh 1). Preset določa,
        kateri engine (nabor opreme) postavlja — WC, pisarna, skladišče. Vrata sedejo na steno proti
        hodniku. Za vsak prostor lahko izbereš svoj preset; rezultat je cela etaža — sobe, hodniki in
        oprema.
      </p>
      <div className="bpRow">
        <span className={'bpBadge ' + (failCount === 0 ? 'hard' : 'soft')}>
          {okCount}/{rooms.length} prostorov opremljenih
        </span>
        {failCount > 0 && <span className="bpBadge soft">{failCount} ni šlo</span>}
        <button className="bpBtn ghost" onClick={resetChoices}>
          Ponastavi izbire (privzeti preseti)
        </button>
      </div>

      <div className="bpFurnGrid">
        <div className="bpPanel bpFurnPlan">
          <PlanSvg plan={plan} width={760} showLabels floorItems={floorItems} />
          <div className="bpFurnLegend">
            {[
              ['#1f4a63', 'miza'],
              ['#3a4656', 'omara / regal'],
              ['#43506a', 'WC školjka'],
              ['#274f60', 'umivalnik / pisoar'],
              ['#1fbf75', 'vrata'],
            ].map(([color, label]) => (
              <span key={label}>
                <span className="sw" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="bpPanel bpFurnList">
          <h3>Prostori · izbira engine-a</h3>
          {rooms.map((f) => (
            <div key={f.room.id} className="bpFurnRow">
              <div className="bpFurnRowHd">
                <b>{f.room.name}</b>
                <span className={'bpFurnStat ' + f.status}>{STATUS_LABEL[f.status]}</span>
              </div>
              <select
                value={choices[f.room.id] ?? defaultPresetId(f.room.type)}
                onChange={(event) => setChoice(f.room.id, event.target.value)}
              >
                {FURNISH_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {f.note && <div className="bpFurnNote">{f.note}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── CSS ───────────────────────── */

const CSS = `
.bp{max-width:1400px;margin:0 auto;padding:14px 18px 40px;color:#d7dee6}
.bp .dim{color:#7e8a96}
.bpNav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.bpStep{display:flex;align-items:center;gap:9px;background:#161c23;border:1px solid #252e39;border-radius:9px;padding:8px 12px;color:#aab4bf;cursor:pointer;text-align:left}
.bpStep.on{border-color:#16b3b3;color:#e8eef4;background:#122225}
.bpTag{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:#1b232c;color:#16b3b3;font-weight:700;font-size:12px}
.bpTtl{display:flex;flex-direction:column}
.bpTtl b{font-size:13px}
.bpTtl i{font-style:normal;font-size:11px;color:#7e8a96}
.bpBody{display:flex;flex-direction:column;gap:14px}
.bpLead{color:#aab4bf;font-size:13.5px;line-height:1.55;max-width:900px;margin:0}
.bpRow{display:flex;gap:8px;flex-wrap:wrap}
.bpBtn{background:#1b232c;border:1px solid #2b3744;border-radius:8px;color:#cdd6df;padding:7px 13px;cursor:pointer;font-size:13px}
.bpBtn:hover{border-color:#3b4a5c}
.bpBtn.primary{background:#0e2626;border-color:#16b3b3;color:#7fdede}
.bpBtn.primary:disabled{opacity:.45;cursor:not-allowed}
.bpBtn.ghost{background:transparent}
.bpMsg{border:1px solid #2f3a47;background:#0e2626;color:#7fdede;border-radius:8px;padding:8px 11px;font-size:12.5px}
.bpPaste{display:flex;flex-direction:column;gap:8px}
.bpPaste textarea{background:#12161b;border:1px solid #2b3744;border-radius:8px;color:#d7dee6;padding:10px;font-family:ui-monospace,monospace;font-size:12px}
.bpDetails summary{cursor:pointer;color:#7e8a96;font-size:12.5px}
.bpDetails pre{background:#12161b;border:1px solid #252e39;border-radius:8px;padding:12px;font-size:11.5px;overflow:auto;max-height:340px;white-space:pre-wrap}
.bpGrid{display:flex;flex-wrap:wrap;gap:12px}
.bpCard{background:#161c23;border:1px solid #252e39;border-radius:10px;padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:8px}
.bpCard:hover{border-color:#3b4a5c}
.bpCard.open,.bpCard.sel{border-color:#16b3b3}
.bpCard.ab{cursor:default}
.bpCardHd{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px}
.bpCardFt{font-size:12px;color:#7e8a96}
.bpSrc{font-size:10.5px;padding:2px 7px;border-radius:20px;border:1px solid #2b3744;color:#7e8a96}
.bpSrc.user{border-color:#16b3b3;color:#7fdede}
.bpSrc.ai-extracted{border-color:#cf9a35;color:#cf9a35}
.bpScore{font-size:12px;color:#7fdede;background:#0e2626;border:1px solid #16b3b3;border-radius:20px;padding:2px 9px}
.bpScore.bad{color:#f08a8a;background:#2a1416;border-color:#a04545}
.bpPens{display:flex;gap:5px}
.bpPen{flex:1;height:5px;background:#12161b;border-radius:3px;overflow:hidden}
.bpPen i{display:block;height:100%;background:#cf6a3d}
.bpPanel{background:#161c23;border:1px solid #252e39;border-radius:10px;padding:14px 16px}
.bpPanel h3{margin:0 0 10px;font-size:14px;color:#e8eef4}
.bpTable{border-collapse:collapse;width:100%;font-size:12.5px}
.bpTable th{color:#7e8a96;text-align:left;font-weight:500;padding:5px 10px 5px 0;border-bottom:1px solid #252e39}
.bpTable td{padding:6px 10px 6px 0;border-bottom:1px solid #1d242d}
.bpTable td.hl{color:#7fdede}
.bpConf{display:inline-block;width:56px;height:6px;background:#12161b;border-radius:3px;overflow:hidden;vertical-align:middle}
.bpConf.wide{width:140px}
.bpConf span{display:block;height:100%;background:#16b3b3}
.bpAdj{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12.5px}
.bpAdjLabel{width:280px}
.bpBadge{font-size:10.5px;letter-spacing:.4px;padding:2px 8px;border-radius:20px}
.bpBadge.hard{background:#0e2626;border:1px solid #16b3b3;color:#7fdede}
.bpBadge.soft{background:#1b232c;border:1px solid #2b3744;color:#aab4bf}
.bpForm{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.bpForm label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:#aab4bf}
.bpForm input,.bpForm select{background:#12161b;border:1px solid #2b3744;border-radius:7px;color:#d7dee6;padding:7px 9px}
.bpFeas{border-radius:8px;padding:9px 12px;font-size:12.5px;margin-top:12px}
.bpFeas.good{background:#0e2616;border:1px solid #1f7a4d;color:#7fdea8}
.bpFeas.bad{background:#2a1416;border:1px solid #a04545;color:#f0a0a0}
.bpFeas.warn{background:#2a2214;border:1px solid #a08245;color:#f0d3a0}
.bpCta{margin-top:4px}
.bpDetailGrid{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
.bpChecks{list-style:none;margin:0;padding:0;font-size:12.5px;display:flex;flex-direction:column;gap:6px;max-width:420px}
.bpChecks li .mark{display:inline-block;width:18px}
.bpChecks li.ok .mark{color:#1fbf75}
.bpChecks li.warn .mark{color:#cf9a35}
.bpChecks li.fail .mark{color:#f08a8a}
.bpAbGrid{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.bpAbPair{display:flex;gap:14px;flex-wrap:wrap;flex:1;min-width:600px}
.bpAbSide{display:flex;flex-direction:column;gap:10px;min-width:330px}
.bpAbStats{font-size:12px;color:#aab4bf}
@media (max-width:1100px){.bpAbPair{min-width:0}}
.bpFurnGrid{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.bpFurnPlan{flex:1;min-width:520px}
.bpFurnLegend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#aab4bf;margin-top:10px}
.bpFurnLegend span{display:inline-flex;align-items:center;gap:6px}
.bpFurnLegend .sw{width:12px;height:12px;border-radius:2px;display:inline-block}
.bpFurnList{width:330px;display:flex;flex-direction:column;gap:8px}
.bpFurnRow{border:1px solid #252e39;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
.bpFurnRowHd{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
.bpFurnRow select{background:#12161b;border:1px solid #2b3744;border-radius:7px;color:#d7dee6;padding:6px 8px;font-size:12.5px}
.bpFurnStat{font-size:10.5px;padding:2px 7px;border-radius:20px;border:1px solid #2b3744;color:#7e8a96}
.bpFurnStat.found{border-color:#1f7a4d;color:#7fdea8}
.bpFurnStat.empty{border-color:#3b4a5c;color:#aab4bf}
.bpFurnStat.not-found,.bpFurnStat.infeasible{border-color:#a04545;color:#f0a0a0}
.bpFurnNote{font-size:11.5px;color:#f0b0a0}
@media (max-width:1100px){.bpFurnPlan{min-width:0}.bpFurnList{width:100%}}
`;
