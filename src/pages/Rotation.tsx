import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileText,
  Info,
  Layers,
  Leaf,
  Lightbulb,
  MinusCircle,
  Pencil,
  PlusCircle,
  Scale,
  Sprout,
  Star,
  Wheat,
} from 'lucide-react';
import { useToast } from '../components/Toast';
import { ensureSyncedFarmProfiles } from '../lib/homeFarmEvaluator';
import { getActiveFarmId, setActiveFarmId, upsertFarmProfile } from '../lib/farmStorage';
import { buildAssessedFarmRecord, syncFarmToLocalProfiles } from '../lib/myFarmsEngine';
import { enqueueOutboxOp } from '../lib/myFarmsOutbox';
import {
  buildCandidateForSavePayload,
  CropSeasonStepDetail,
  derivePlanProsAndCons,
  formatShortPlanDate,
  isSameActiveSequence,
  loadRotationDraft,
  RotationPlanCandidate,
  RotationWizardDraft,
  runRotationPlannerEngine,
  saveRotationDraft,
} from '../lib/rotationPlannerEngine';
import { downloadRotationPlanJson, downloadRotationPlanPdf } from '../lib/rotationPdfExport';
import { executeDirectMutation, fetchMyFarmsPortfolio } from '../services/myFarmsApi';
import { fetchNasaPowerClimatology } from '../services/nasaPower';
import { getDefaultTargetDate } from '../lib/format';
import { mapSnapshotToFarmProfile, mapSnapshotToRotationDraft } from '../lib/questionnaireEngine';
import { loadLocalSnapshotBundle, saveLocalSnapshotBundle } from '../lib/questionnaireStorage';
import { fetchImmutableSnapshotApi } from '../services/questionnaireApi';
import {
  MyFarmRecord,
  PlanDecisionEvent,
  PlanDecisionReasonCode,
  PortfolioFieldRecord,
} from '../types/myFarms';
import {
  BotanicalCropTimelineSvg,
  CircularMetricGauge,
  GlossyWaterDropletIcon,
  resolveRotationCropImage,
  ROTATION_MEDIA,
  RotationLogoSvg,
} from '../components/rotation/RotationVisuals';
import {
  ConfirmSavePlanModal,
  CropSuitabilityDetailModal,
  EditInputsWizardModal,
  PlanDetailEvidenceModal,
} from '../components/rotation/RotationModals';

function buildFallbackPortfolioFarms(): MyFarmRecord[] {
  const local = ensureSyncedFarmProfiles();
  return local.map((fp) => ({
    id: fp.id,
    name: fp.location.farmName || 'Green Valley Farm',
    primaryCrop: fp.crops.currentCrops[0] || 'Wheat',
    locationLabel: fp.location.locationLabel || 'Ames, Iowa',
    regionLabel: fp.location.regionOrAddress || 'Story County, Iowa',
    country: fp.location.country || 'United States',
    timezone: 'UTC',
    centroid:
      fp.location.lat !== null && fp.location.lon !== null
        ? { lat: fp.location.lat, lon: fp.location.lon }
        : { lat: 42.0308, lon: -93.6319 },
    geometry: null,
    areaUnit: fp.areaUnit || 'hectares',
    declaredAreaHa: fp.areaValue ?? 48,
    mappedAreaHa: fp.areaValue ?? 48,
    perimeterM: 0,
    hasBoundary: false,
    areaGapNote: null,
    hasFieldOverlapWarning: false,
    overlapWarningDetail: null,
    isPrivate: true,
    isDraft: false,
    archivedAt: null,
    notes: '',
    versionNumber: 1,
    activePlan: null,
    recommendedPlanId: 'rot-wheat-chickpea-sorghum-cover',
    recommendedPlanTitle: 'Wheat → Chickpea → Sorghum → Cover Crop',
    soil: {
      texture: fp.soil.texture || 'Loam',
      moistureStatus: fp.soil.moistureStatus || 'measured',
      moisturePct: fp.soil.moisturePct ?? 24,
      moistureMethod: fp.soil.moistureMethod || 'Soil moisture probe',
      moistureDate: fp.soil.moistureDate || new Date().toISOString().slice(0, 10),
      phStatus: fp.soil.phStatus || 'tested',
      phValue: fp.soil.phValue ?? 6.6,
      phTestDate: fp.soil.phTestDate || new Date().toISOString().slice(0, 10),
      organicMatterPct: 2.3,
      drainage: fp.soil.drainage || 'Moderately',
      slopePct: null,
      elevationM: null,
      preparationMethods: fp.soil.preparationMethods || [],
      notes: '',
    },
    water: {
      sources: fp.water.sources || ['Rainwater collection', 'Groundwater / Well'],
      reliability: fp.water.reliability || 'Always available',
      dailyCapacityKnown: fp.water.availableQuantityKnown === 'Yes',
      dailyCapacityM3: fp.water.availableQuantityValue ?? 420,
      qualityTested: fp.water.qualityTested || 'Yes',
      ecDsM: fp.water.ecValue ?? 0.65,
      salinityPpm: fp.water.salinityValue ?? 410,
      qualityTestDate: fp.water.qualityTestDate || '',
      wateringMethod: fp.water.wateringMethod || 'Hybrid (rainfall and irrigation)',
      irrigationMethod: fp.water.irrigationMethod || 'Sprinkler irrigation',
      irrigationFrequency: fp.water.irrigationFrequency || 'Weekly',
      rainfallFrequency: fp.water.rainfallFrequency || 'Weekly',
      estimatedDailyDemandM3: null,
      demandAssumptionNote: '',
    },
    planningHorizon: fp.planning.horizon || 'Next 2–3 years',
    priorities: fp.planning.priorities || ['Soil health', 'Water conservation', 'Yield'],
    challenges: fp.planning.challenges || [],
    assessment: {
      status: 'good',
      freshnessState: 'fresh',
      score: 91,
      confidencePct: 84,
      completenessPct: 88,
      assessedAt: fp.updatedAt || new Date().toISOString(),
      activeAlertsCount: 0,
      criticalAlertsCount: 0,
      summary: 'Soil and water profile calibrated for multi-season rotation planning.',
      worstFieldId: null,
      worstFieldName: null,
      worstFieldReason: null,
      staleReasons: [],
    },
    createdAt: fp.createdAt || new Date().toISOString(),
    updatedAt: fp.updatedAt || new Date().toISOString(),
  }));
}

interface RotationSelectDropdownProps {
  label: string;
  options: RotationPlanCandidate[];
  value: string;
  onChange: (planId: string) => void;
}

const RotationSelectDropdown: React.FC<RotationSelectDropdownProps> = ({
  label,
  options,
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const selected = options.find((c) => c.id === value) ?? options[0];
  if (!selected) return null;

  return (
    <div
      ref={containerRef}
      className={`relative ${open ? 'z-40' : 'z-10'}`}
    >
      <button
        type="button"
        aria-label={`Select ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full h-11 px-3.5 rounded-xl bg-white/75 dark:bg-[#04231F]/80 hover:bg-white/95 dark:hover:bg-[#06312B] border border-[#0F766E]/25 dark:border-[#2DD4BF]/35 hover:border-[#0F766E]/50 dark:hover:border-[#2DD4BF]/60 flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] font-bold text-[#0F766E] dark:text-[#24E982] tabular-nums shrink-0">
            #{selected.rank}
          </span>
          <span className="text-[13px] font-semibold text-[#072622] dark:text-white truncate">
            {selected.planCode}: {selected.title}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono text-[11.5px] font-bold text-[#1B4D46] dark:text-[#5EEAD4] tabular-nums">
            {selected.matchScore}/100
          </span>
          <ChevronDown
            className={`w-4 h-4 text-[#0F766E] dark:text-[#5EEAD4] transition-transform duration-150 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={`${label} options`}
          className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl bg-[#F4FBF9] dark:bg-[#052622] border border-[#0F766E]/25 dark:border-[#2DD4BF]/40 p-1.5 shadow-2xl max-h-64 overflow-y-auto fs-thin-scroll"
        >
          {options.map((cand) => {
            const isSelected = cand.id === selected.id;
            return (
              <button
                key={cand.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(cand.id);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-2.5 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#0F766E]/14 dark:bg-[#2DD4BF]/18 text-[#072622] dark:text-white font-semibold'
                    : 'text-[#14433C] dark:text-[#CBE8E1] hover:bg-[#0F766E]/8 dark:hover:bg-white/[0.08]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[11px] font-bold text-[#0F766E] dark:text-[#24E982] tabular-nums shrink-0 w-5">
                    #{cand.rank}
                  </span>
                  <span className="text-[12.5px] truncate">
                    {cand.planCode}: {cand.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-mono text-[11.5px] font-semibold tabular-nums text-[#1B4D46] dark:text-[#5EEAD4]">
                    {cand.matchScore}/100
                  </span>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#24E982]" strokeWidth={2.8} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface PlanShowcaseBodyProps {
  plan: RotationPlanCandidate;
  isPreviewActive: boolean;
  onInspectDetails: (plan: RotationPlanCandidate) => void;
  onSelectPreview: (planId: string) => void;
  onResetToTop?: () => void;
  isSlideVariant?: boolean;
}

const PlanShowcaseBody: React.FC<PlanShowcaseBodyProps> = ({
  plan,
  isPreviewActive,
  onInspectDetails,
  onSelectPreview,
  onResetToTop,
  isSlideVariant = false,
}) => {
  const isRankOne = plan.rank === 1;
  const ringColor = isRankOne ? '#24E982' : plan.rank === 2 ? '#2DD4BF' : '#38BDF8';
  const ringGlow = isRankOne
    ? 'rgba(36, 233, 130, 0.42)'
    : plan.rank === 2
      ? 'rgba(45, 212, 191, 0.36)'
      : 'rgba(56, 189, 248, 0.32)';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[246px_minmax(0,1fr)] w-full h-full">
      {/* Left Score Column — sheer frosted glass column */}
      <div
        className={`flex flex-col justify-between pb-5 border-b lg:border-b-0 lg:border-r ${
          isRankOne
            ? 'border-emerald-600/25 dark:border-[#24E982]/25 bg-emerald-500/[0.06] dark:bg-[#05332A]/25'
            : 'border-teal-700/20 dark:border-teal-400/20 bg-teal-500/[0.05] dark:bg-[#042824]/22'
        }`}
      >
        {/* Top strip */}
        <div
          className="h-10 px-4 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-white"
          style={{
            background: isRankOne
              ? 'linear-gradient(90deg, rgba(16, 185, 129, 0.88) 0%, rgba(15, 118, 110, 0.88) 100%)'
              : 'linear-gradient(90deg, rgba(15, 118, 110, 0.78) 0%, rgba(6, 78, 68, 0.82) 100%)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-4 h-4 rounded-full bg-white text-[#0F766E] grid place-items-center shrink-0">
              <Star className="w-2.5 h-2.5 fill-current" />
            </span>
            <span className="truncate">
              {isRankOne ? 'BEST ROTATION (#1)' : `${plan.planCode} · RANK #${plan.rank}`}
            </span>
          </div>
          {isPreviewActive && (
            <span className="text-[10px] font-bold tracking-normal normal-case text-emerald-100 shrink-0">
              Active Preview
            </span>
          )}
        </div>

        <div className="px-5 pt-4 flex flex-col items-center text-center">
          <div className="text-[40px] lg:text-[44px] font-extrabold leading-none text-[#072622] dark:text-[#ECF8F5] tracking-tight tabular-nums">
            #{plan.rank}
          </div>

          <div className="mt-3">
            <CircularMetricGauge
              value={plan.matchScore}
              size={118}
              stroke={9}
              color={ringColor}
              trackColor="rgba(15, 118, 110, 0.28)"
              glowColor={ringGlow}
            >
              <div className="flex items-baseline gap-0.5 leading-none">
                <span className="text-[28px] font-extrabold text-[#072622] dark:text-white tabular-nums">
                  {plan.matchScore}
                </span>
                <span className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A8D6CD]">
                  / 100
                </span>
              </div>
              <span className="text-[10.5px] font-semibold text-[#0F766E] dark:text-[#7FEAD6] mt-1">
                Match Score
              </span>
            </CircularMetricGauge>
          </div>

          <div className="mt-3 flex items-start gap-2 text-left">
            <span className="w-4 h-4 rounded-full bg-[#10B981] dark:bg-[#24E982] text-white dark:text-[#042318] grid place-items-center shrink-0 mt-0.5">
              <Check className="w-2.5 h-2.5" strokeWidth={3} />
            </span>
            <p className="text-[11.5px] leading-[1.4] text-[#14433C] dark:text-[#CBE8E1]">
              {plan.fitSummary}
            </p>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 w-full">
            <button
              type="button"
              onClick={() => onInspectDetails(plan)}
              className="inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full bg-[#0F766E]/15 dark:bg-[#0B4A42]/80 hover:bg-[#0F766E]/25 dark:hover:bg-[#115E54] border border-[#0F766E]/35 dark:border-[#2DD4BF]/50 text-[11.5px] font-semibold text-[#072622] dark:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>View Full Details</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {isSlideVariant && (
              <button
                type="button"
                onClick={() => onSelectPreview(plan.id)}
                className={`inline-flex items-center justify-center gap-1.5 h-8 px-4 rounded-full text-[11.5px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isPreviewActive
                    ? 'bg-[#10B981] dark:bg-[#24E982] text-white dark:text-[#042318]'
                    : 'bg-white/60 dark:bg-white/[0.08] hover:bg-white/85 dark:hover:bg-white/[0.15] border border-[#0F766E]/30 dark:border-teal-300/30 text-[#072622] dark:text-[#ECF8F5]'
                }`}
              >
                {isPreviewActive ? (
                  <>
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    <span>Previewing</span>
                  </>
                ) : (
                  <span>Preview #{plan.rank}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right Sequence & Reasons Column */}
      <div className="p-5 flex flex-col justify-between gap-3.5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-full bg-[#0F766E]/15 dark:bg-[#2DD4BF]/18 border border-[#0F766E]/30 dark:border-[#2DD4BF]/40 grid place-items-center text-[#0F766E] dark:text-[#2DD4BF] shrink-0">
              <Sprout className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] lg:text-[17px] font-bold text-[#072622] dark:text-[#ECF8F5] tracking-tight truncate">
                {isRankOne ? 'Your Optimal Rotation Plan' : plan.title}
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#285E55] dark:text-[#96C7BE]">
            <span>
              Confidence:{' '}
              <span className="text-[#0F766E] dark:text-[#5EEAD4] font-semibold tabular-nums">
                {plan.confidencePct}%
              </span>
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-[#072622] dark:text-[#D5EEE9]">
              {plan.planCode}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{plan.totalWaterDemandMm} mm ETc</span>
            {!isRankOne && onResetToTop && isPreviewActive && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onResetToTop}
                  className="text-[#0F766E] dark:text-[#24E982] font-semibold hover:underline cursor-pointer"
                >
                  Reset to #1
                </button>
              </>
            )}
          </div>
        </div>

        {/* Crop Cards Sequence + Why It Fits & Watch Out */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px] gap-3.5 items-stretch">
          {/* Horizontal Crop Sequence */}
          <div className="flex items-stretch gap-2 overflow-x-auto pb-1 xl:pb-0 fs-thin-scroll">
            {plan.steps.map((step, idx) => (
              <React.Fragment key={step.occurrenceId}>
                <div className="fs-rot-subcard flex-1 min-w-[114px] rounded-[18px] overflow-hidden flex flex-col text-center">
                  <div className="py-1.5 px-2 text-[11.5px] font-semibold text-[#072622] dark:text-[#ECF8F5] bg-white/35 dark:bg-[#05352E]/45 border-b border-[#0F766E]/15 dark:border-teal-300/15 w-full">
                    {step.seasonLabel}
                  </div>
                  <div className="relative h-[120px] lg:h-[138px] w-full overflow-hidden bg-[#08241F]">
                    <img
                      src={resolveRotationCropImage(step.cropId)}
                      alt={`${step.cropName} — ${step.seasonLabel}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="py-2 px-2 flex-1 flex flex-col justify-center">
                    <div className="text-[13px] font-bold text-[#072622] dark:text-white leading-tight truncate">
                      {step.cropName}
                    </div>
                    <div className="text-[11px] text-[#1B4D46] dark:text-[#A5D4CB] leading-tight mt-0.5">
                      ({step.plainFamily})
                    </div>
                    <div className="text-[10.5px] text-[#2B665D] dark:text-[#7BB8AC] tabular-nums mt-0.5">
                      ~{step.durationDays} days
                    </div>
                  </div>
                </div>

                {idx < plan.steps.length - 1 && (
                  <div className="flex items-center justify-center shrink-0 px-0.5">
                    <ArrowRight
                      className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]"
                      strokeWidth={2.5}
                    />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Right Column: Why It Fits + Watch Out */}
          <div className="flex flex-col gap-3 justify-between">
            <div className="fs-rot-subcard flex-1 rounded-[18px] p-3.5 text-left">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#072622] dark:text-white">
                <span className="w-4 h-4 rounded-full bg-[#10B981] dark:bg-[#24E982] text-white dark:text-[#042318] grid place-items-center shrink-0">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
                <span>Why it fits?</span>
              </div>
              <ul className="mt-2.5 space-y-2">
                {plan.whyItFits.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2 text-[11px] leading-snug text-[#14433C] dark:text-[#CFEBE4]"
                  >
                    <Check
                      className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#24E982] shrink-0 mt-0.5"
                      strokeWidth={2.6}
                    />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[18px] p-3.5 text-left bg-rose-500/14 dark:bg-rose-950/38 backdrop-blur-md border border-rose-500/35">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#7F1D1D] dark:text-white">
                <span className="w-4 h-4 rounded-full bg-[#E11D48] dark:bg-[#FF465A] text-white grid place-items-center shrink-0 text-[10px] font-extrabold">
                  !
                </span>
                <span>Watch Out</span>
              </div>
              <p className="text-[11px] leading-snug text-[#881337] dark:text-[#F6CDD6] mt-1.5">
                {plan.risks[0]?.shortWarning || 'Monitor mid-season soil moisture & drainage'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Rotation: React.FC = () => {
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const snapshotIdParam = searchParams.get('snapshotId');

  // Portfolio & farm selection state
  const [farms, setFarms] = useState<MyFarmRecord[]>(() => buildFallbackPortfolioFarms());
  const [fields, setFields] = useState<PortfolioFieldRecord[]>([]);
  const [decisions, setDecisions] = useState<PlanDecisionEvent[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(() => {
    const active = getActiveFarmId();
    const list = buildFallbackPortfolioFarms();
    if (active && list.some((f) => f.id === active)) return active;
    return list[0]?.id ?? '';
  });

  // Load real portfolio from backend seamlessly
  const loadPortfolio = useCallback(async () => {
    try {
      const portfolio = await fetchMyFarmsPortfolio();
      const assessed = portfolio.farms
        .filter((f) => !f.archivedAt)
        .map((raw) =>
          buildAssessedFarmRecord(
            raw,
            portfolio.fields ?? [],
            portfolio.observations ?? [],
            portfolio.tasks ?? []
          )
        );
      if (assessed.length > 0) {
        setFarms(assessed);
        setFields(portfolio.fields ?? []);
        setDecisions(portfolio.decisions ?? []);
        setSelectedFarmId((prev) =>
          assessed.some((f) => f.id === prev) ? prev : assessed[0].id
        );
      }
    } catch {
      // Offline / fallback profiles already populated cleanly
    }
  }, []);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  // Hydrate immutable snapshot handoff from /questions? -> /rotation?snapshotId=...
  useEffect(() => {
    if (!snapshotIdParam) return;
    let cancelled = false;
    const applyBundle = (
      snapshot: Parameters<typeof mapSnapshotToRotationDraft>[0],
      result: Parameters<typeof mapSnapshotToRotationDraft>[1]
    ) => {
      if (cancelled) return;
      const hydrated = mapSnapshotToRotationDraft(snapshot, result);
      saveRotationDraft(hydrated);
      upsertFarmProfile(mapSnapshotToFarmProfile(snapshot));
      setActiveFarmId(snapshot.farmId);
      setSelectedFarmId(snapshot.farmId);
      setDraft(hydrated);
      loadPortfolio();
      showToast(
        `Loaded verified snapshot for ${snapshot.farmName} (${snapshot.evidenceCoverageGrade}).`,
        'success'
      );
    };

    const local = loadLocalSnapshotBundle(snapshotIdParam);
    if (local) {
      applyBundle(local.snapshot, local.result);
    }

    fetchImmutableSnapshotApi(snapshotIdParam)
      .then((remote) => {
        if (cancelled || !remote?.snapshot) return;
        saveLocalSnapshotBundle(remote.snapshot, remote.result);
        if (!local) {
          applyBundle(remote.snapshot, remote.result);
        }
      })
      .catch(() => {
        // Local bundle already applied if present
      });

    return () => {
      cancelled = true;
    };
  }, [snapshotIdParam, loadPortfolio, showToast]);

  const currentFarm = useMemo(
    () => farms.find((f) => f.id === selectedFarmId) ?? farms[0],
    [farms, selectedFarmId]
  );

  const currentFarmFields = useMemo(
    () => fields.filter((f) => f.farmId === currentFarm?.id),
    [fields, currentFarm?.id]
  );

  const [selectedFieldId, setSelectedFieldId] = useState<string>('');

  useEffect(() => {
    if (currentFarmFields.length === 0) {
      setSelectedFieldId('');
      return;
    }
    setSelectedFieldId((prev) =>
      currentFarmFields.some((f) => f.id === prev) ? prev : currentFarmFields[0].id
    );
  }, [currentFarm?.id, currentFarmFields]);

  const currentField = useMemo(
    () => currentFarmFields.find((f) => f.id === selectedFieldId) ?? currentFarmFields[0] ?? null,
    [currentFarmFields, selectedFieldId]
  );

  // Draft questionnaire inputs persisted per farm / field
  const [draft, setDraft] = useState<RotationWizardDraft>(() =>
    loadRotationDraft(currentFarm, fields, selectedFieldId || undefined)
  );

  useEffect(() => {
    if (!currentFarm) return;
    setActiveFarmId(currentFarm.id);
    if (!snapshotIdParam) {
      setDraft(loadRotationDraft(currentFarm, fields, selectedFieldId || undefined));
    }
  }, [currentFarm?.id, selectedFieldId, fields.length, snapshotIdParam]);

  // Calibrate climate baseline quietly from NASA POWER when coordinates exist
  useEffect(() => {
    const lat = currentFarm?.centroid?.lat;
    const lon = currentFarm?.centroid?.lon;
    if (lat === undefined || lon === undefined) return;
    let cancelled = false;
    fetchNasaPowerClimatology(lat, lon, getDefaultTargetDate(), undefined, 'farming')
      .then((power) => {
        if (cancelled) return;
        const meanTemp = power.meanTempC ?? null;
        const precipAnnual =
          power.meanPrecipMm !== null ? Math.round(power.meanPrecipMm * 365) : null;
        if (meanTemp !== null || precipAnnual !== null) {
          setDraft((prev) => {
            if (
              prev.climateMeanTempC === meanTemp &&
              prev.climateAnnualPrecipMm === precipAnnual
            ) {
              return prev;
            }
            return {
              ...prev,
              climateMeanTempC: meanTemp,
              climateAnnualPrecipMm: precipAnnual,
            };
          });
        }
      })
      .catch(() => {
        // Silent degradation — crop suitability engine transparently notes NASA POWER gap
      });
    return () => {
      cancelled = true;
    };
  }, [currentFarm?.id, currentFarm?.centroid?.lat, currentFarm?.centroid?.lon]);

  // Deterministic Rotation & Suitability Computation
  const engine = useMemo(
    () => runRotationPlannerEngine(currentFarm, fields, draft),
    [currentFarm, fields, draft]
  );

  // Primary #1 best rotation + All other ranked rotations (#2, #3, #4...)
  const bestPlan = engine.candidates[0] ?? null;
  const otherRankedPlans = useMemo(() => engine.candidates.slice(1), [engine.candidates]);

  const [previewPlanId, setPreviewPlanId] = useState<string>(
    () => engine.candidates[0]?.id ?? 'rot-wheat-chickpea-sorghum-cover'
  );

  useEffect(() => {
    if (!engine.candidates.some((c) => c.id === previewPlanId)) {
      setPreviewPlanId(engine.candidates[0]?.id ?? '');
    }
  }, [engine.candidates, previewPlanId]);

  const previewPlan = useMemo(
    () => engine.candidates.find((c) => c.id === previewPlanId) ?? engine.candidates[0],
    [engine.candidates, previewPlanId]
  );

  // Vertical Sliding Ranked Rotations Card state
  const rankedSliderRef = useRef<HTMLDivElement | null>(null);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  useEffect(() => {
    setActiveSlideIdx(0);
    if (rankedSliderRef.current) {
      rankedSliderRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [currentFarm?.id, otherRankedPlans.length]);

  const scrollToRankedSlide = useCallback(
    (idx: number) => {
      const el = rankedSliderRef.current;
      if (!el || otherRankedPlans.length === 0) return;
      const clamped = Math.max(0, Math.min(otherRankedPlans.length - 1, idx));
      setActiveSlideIdx(clamped);
      const targetChild = el.children[clamped] as HTMLElement | undefined;
      if (targetChild) {
        el.scrollTo({ top: targetChild.offsetTop, behavior: 'smooth' });
      }
    },
    [otherRankedPlans.length]
  );

  const handleRankedSliderScroll = useCallback(() => {
    const el = rankedSliderRef.current;
    if (!el || el.clientHeight <= 0) return;
    const idx = Math.round(el.scrollTop / el.clientHeight);
    const clamped = Math.max(0, Math.min(otherRankedPlans.length - 1, idx));
    setActiveSlideIdx((prev) => (prev === clamped ? prev : clamped));
  }, [otherRankedPlans.length]);

  // Dedicated On-Page Head-to-Head Comparison Card state (2 chosen rotations)
  const [compareLeftId, setCompareLeftId] = useState<string>(
    () => engine.candidates[0]?.id ?? ''
  );
  const [compareRightId, setCompareRightId] = useState<string>(
    () => engine.candidates[1]?.id ?? engine.candidates[0]?.id ?? ''
  );

  useEffect(() => {
    if (!engine.candidates.some((c) => c.id === compareLeftId)) {
      setCompareLeftId(engine.candidates[0]?.id ?? '');
    }
    if (!engine.candidates.some((c) => c.id === compareRightId)) {
      setCompareRightId(engine.candidates[1]?.id ?? engine.candidates[0]?.id ?? '');
    }
  }, [engine.candidates, compareLeftId, compareRightId]);

  const compareLeftPlan = useMemo(
    () => engine.candidates.find((c) => c.id === compareLeftId) ?? engine.candidates[0],
    [engine.candidates, compareLeftId]
  );
  const compareRightPlan = useMemo(
    () =>
      engine.candidates.find((c) => c.id === compareRightId) ??
      engine.candidates[1] ??
      engine.candidates[0],
    [engine.candidates, compareRightId]
  );

  const leftProsCons = useMemo(
    () => (compareLeftPlan ? derivePlanProsAndCons(compareLeftPlan, engine.candidates) : null),
    [compareLeftPlan, engine.candidates]
  );
  const rightProsCons = useMemo(
    () => (compareRightPlan ? derivePlanProsAndCons(compareRightPlan, engine.candidates) : null),
    [compareRightPlan, engine.candidates]
  );

  // Timeline interactive view switcher
  const [timelineView, setTimelineView] = useState<'seasons' | 'windows' | 'water_n'>('seasons');
  const [timelineMenuOpen, setTimelineMenuOpen] = useState(false);
  const [selectedTimelineSeason, setSelectedTimelineSeason] = useState<number>(0);

  // Modals & Drawers
  const [wizardModal, setWizardModal] = useState<{ open: boolean; step: number }>({
    open: false,
    step: 0,
  });
  const [detailModalPlan, setDetailModalPlan] = useState<RotationPlanCandidate | null>(null);
  const [suitabilityModal, setSuitabilityModal] = useState<{
    open: boolean;
    tab: 'occurrence' | 'suitability';
    step: CropSeasonStepDetail | null;
  }>({ open: false, tab: 'suitability', step: null });
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [farmSwitcherOpen, setFarmSwitcherOpen] = useState(false);
  const [fieldSwitcherOpen, setFieldSwitcherOpen] = useState(false);

  const farmSwitcherRef = useRef<HTMLDivElement | null>(null);
  const fieldSwitcherRef = useRef<HTMLDivElement | null>(null);
  const timelineMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (farmSwitcherRef.current && target && !farmSwitcherRef.current.contains(target)) {
        setFarmSwitcherOpen(false);
      }
      if (fieldSwitcherRef.current && target && !fieldSwitcherRef.current.contains(target)) {
        setFieldSwitcherOpen(false);
      }
      if (timelineMenuRef.current && target && !timelineMenuRef.current.contains(target)) {
        setTimelineMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFarmSwitcherOpen(false);
        setFieldSwitcherOpen(false);
        setTimelineMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const hasUnsavedPlanDiff = useMemo(() => {
    if (!previewPlan) return false;
    if (!currentFarm.activePlan) return !previewPlan.isRecommended;
    return !isSameActiveSequence(previewPlan, currentFarm.activePlan);
  }, [previewPlan, currentFarm.activePlan]);

  // Handlers
  const handleSaveDraftAndRun = async (nextDraft: RotationWizardDraft, syncToServer: boolean) => {
    const saved = saveRotationDraft(nextDraft);
    setDraft(saved);

    if (syncToServer) {
      try {
        await executeDirectMutation('PATCH', `/api/my-farms/farms/${currentFarm.id}`, {
          primaryCrop: saved.recentCrops[0]?.cropName || currentFarm.primaryCrop,
          planningHorizon:
            saved.planningHorizonLabel === '4 Seasons'
              ? 'Next 2–3 years'
              : saved.planningHorizonLabel,
          soil: {
            texture: saved.soilTexture,
            phValue: saved.soilPh,
            drainage: saved.drainage,
            organicMatterPct: saved.soilOrganicMatterPct,
          },
          water: {
            wateringMethod: saved.wateringMethod,
            reliability: saved.waterReliability,
            dailyCapacityKnown: saved.dailyWaterCapM3 !== null,
            dailyCapacityM3: saved.dailyWaterCapM3,
          },
        });
        await loadPortfolio();
      } catch {
        // Draft already saved locally cleanly
      }
    }
    showToast('Rotation inputs updated and plans re-ranked.', 'success');
  };

  const handleConfirmSaveActivePlan = async (
    reasonCode: PlanDecisionReasonCode,
    reasonNote: string
  ) => {
    if (!previewPlan || !currentFarm) return;
    const candidateOpt = buildCandidateForSavePayload(previewPlan);
    const payload = {
      operationId: `rot-save-${Date.now()}`,
      fieldId: draft.fieldId,
      fieldName: draft.fieldName,
      action: currentFarm.activePlan ? ('replaced' as const) : ('selected' as const),
      candidateId: candidateOpt.id,
      candidateTitle: candidateOpt.title,
      candidateScoreSnapshot: candidateOpt.suitabilityScore,
      candidateCrops: candidateOpt.steps.map((s) => ({
        cropId: s.cropId,
        cropName: s.cropName,
        cycleLabel: s.cycleLabel,
      })),
      isRecommendedPlan: previewPlan.isRecommended,
      reasonCode,
      reasonNote:
        reasonNote ||
        `Selected ${previewPlan.planCode} (${previewPlan.matchScore}/100) from Rotation Planner`,
      actor: 'Farm Manager',
      sourceReportId: engine.inputSnapshotHash,
      sourceReportDate: engine.generatedAt,
    };

    try {
      const res = await executeDirectMutation<{
        portfolio?: { farms: any[]; fields: any[]; decisions: any[] };
      }>('POST', `/api/my-farms/farms/${currentFarm.id}/decisions`, payload);
      if (res.portfolio) {
        const assessed = res.portfolio.farms
          .filter((f) => !f.archivedAt)
          .map((raw) =>
            buildAssessedFarmRecord(raw, res.portfolio!.fields ?? [], [], [])
          );
        setFarms(assessed);
        setDecisions(res.portfolio.decisions ?? []);
        const updatedSelf = assessed.find((f) => f.id === currentFarm.id);
        if (updatedSelf) syncFarmToLocalProfiles(updatedSelf);
      }
      showToast(`${previewPlan.planCode} saved as active rotation plan.`, 'success');
    } catch {
      enqueueOutboxOp({
        entityType: 'decision_log',
        entityId: currentFarm.id,
        farmId: currentFarm.id,
        baseVersion: currentFarm.versionNumber ?? null,
        conflictPolicy: 'append_only',
        method: 'POST',
        endpoint: `/api/my-farms/farms/${currentFarm.id}/decisions`,
        summaryLabel: `Save active rotation (${previewPlan.title})`,
        payload,
      });
      setFarms((prev) =>
        prev.map((f) =>
          f.id === currentFarm.id
            ? {
                ...f,
                activePlan: {
                  planId: previewPlan.id,
                  title: previewPlan.title,
                  version: (f.activePlan?.version ?? 0) + 1,
                  selectedAt: new Date().toISOString(),
                  selectedBy: 'Farm Manager',
                  cropSequence: payload.candidateCrops,
                  isRecommendedPlan: previewPlan.isRecommended,
                },
                updatedAt: new Date().toISOString(),
              }
            : f
        )
      );
      showToast(`${previewPlan.planCode} saved locally and queued for sync.`, 'success');
    }
  };

  const handleDownloadPdf = (targetPlan?: RotationPlanCandidate) => {
    const planToUse = targetPlan || previewPlan;
    if (!planToUse) return;
    const filename = downloadRotationPlanPdf(engine, planToUse, draft);
    showToast(`Downloaded ${filename}`, 'success');
  };

  const handleExportJson = () => {
    if (!previewPlan) return;
    const filename = downloadRotationPlanJson(engine, previewPlan, draft);
    showToast(`Exported ${filename}`, 'success');
  };

  const timelineViewLabels: Record<typeof timelineView, string> = {
    seasons: 'View by: Seasons',
    windows: 'View by: Months',
    water_n: 'View by: Water & N',
  };

  const topActivePlan = previewPlan || bestPlan;

  return (
    <div className="relative min-h-screen w-full text-[#072622] dark:text-[#ECF8F5] pb-14 transition-colors duration-500">
      {/* =================================================================== */}
      {/* FIXED VIEWPORT BACKGROUND IMAGE (stationary while cards scroll!)    */}
      {/* Matches Home Page 2 aesthetic cleanly in Dark & Light modes         */}
      {/* =================================================================== */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#C2DFD9] dark:bg-[#041513]"
      >
        {/* Dark Mode Stationary Farm Aerial */}
        <img
          src="/assets/aistudio/image_f90e4497.png"
          alt=""
          className="hidden dark:block w-full h-full object-cover object-center scale-[1.01]"
        />
        {/* Light Mode Stationary Morning Meadow / Field */}
        <img
          src="/assets/aistudio/image_73994810.png"
          alt=""
          className="block dark:hidden w-full h-full object-cover object-center brightness-[0.86] contrast-[1.03] saturate-[0.95] scale-[1.01]"
        />
        {/* Subtle readability scrim preserving full vivid photography */}
        <div
          className="hidden dark:block absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(3, 20, 18, 0.24) 0%, rgba(3, 20, 18, 0.34) 55%, rgba(2, 14, 12, 0.50) 100%)',
          }}
        />
        <div
          className="block dark:hidden absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(12, 56, 48, 0.14) 0%, rgba(10, 48, 42, 0.18) 65%, rgba(6, 36, 32, 0.28) 100%)',
          }}
        />
      </div>

      {/* =================================================================== */}
      {/* 01 — FULL-BLEED SUNSET HERO (Starts at y = 0 behind Home navbar)    */}
      {/* Soft bottom feather blends straight into the stationary background  */}
      {/* =================================================================== */}
      <header className="relative z-20 w-full">
        {/* Full-bleed sky + setting sun masked smoothly at bottom edge into fixed landscape */}
        <div
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{
            WebkitMaskImage:
              'linear-gradient(180deg, #000 0%, #000 68%, rgba(0,0,0,0.45) 86%, transparent 100%)',
            maskImage:
              'linear-gradient(180deg, #000 0%, #000 68%, rgba(0,0,0,0.45) 86%, transparent 100%)',
          }}
        >
          <div
            className="absolute inset-0 bg-cover"
            style={{
              backgroundImage: `url(${ROTATION_MEDIA.heroSunset})`,
              backgroundPosition: 'center 8%',
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(4, 21, 19, 0.70) 0%, rgba(4, 21, 19, 0.32) 44%, rgba(4, 21, 19, 0.08) 78%, rgba(4, 21, 19, 0.18) 100%)',
            }}
          />
        </div>

        <div className="relative z-10 max-w-[1520px] w-full mx-auto px-5 sm:px-8 lg:px-14 xl:px-[74px] pt-[104px] sm:pt-[118px] pb-8 lg:pb-9 min-h-[340px] lg:min-h-[372px] flex flex-col md:flex-row md:items-end justify-between gap-5">
          {/* Left: Rotation SVG Logo + Heading + Descriptions + Large Farm & Field Dropdowns */}
          <div className="flex items-start gap-4 lg:gap-5">
            <RotationLogoSvg className="w-[62px] h-[62px] sm:w-[74px] sm:h-[74px] lg:w-[82px] lg:h-[82px] shrink-0 mt-1" />
            <div>
              <h1
                className="text-[32px] sm:text-[36px] lg:text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white"
                style={{ textShadow: '0 2px 16px rgba(2, 14, 12, 0.55)' }}
              >
                Crop Rotation
                <br />
                Planner
              </h1>
              <p
                className="text-[13px] lg:text-[14px] leading-[1.45] text-[#E6F8F4] max-w-[490px] mt-2"
                style={{ textShadow: '0 1px 10px rgba(2, 14, 12, 0.55)' }}
              >
                Calculated across soil, water reliability, climate &amp; family breaks — ranking the
                strongest crop sequences for your field.
              </p>

              {/* Prominent Farm Dropdown + Transparent Field Dropdown branching from Farm Name */}
              <div className="mt-4 flex flex-col items-start">
                {/* 1. Large Prominent Farm Selector Dropdown */}
                <div className="relative" ref={farmSwitcherRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setFieldSwitcherOpen(false);
                      setFarmSwitcherOpen((v) => !v);
                    }}
                    className="inline-flex items-center justify-between gap-4 min-w-[290px] sm:min-w-[380px] px-5 py-3.5 rounded-[20px] bg-[#042420]/78 hover:bg-[#06322C]/90 backdrop-blur-xl border border-[#2DD4BF]/55 text-left shadow-[0_10px_28px_rgba(2,18,16,0.42)] transition-all cursor-pointer"
                  >
                    <span className="flex items-center gap-3.5 min-w-0">
                      <span className="w-10 h-10 rounded-full bg-[#14B89A]/25 border border-[#2DD4BF]/50 grid place-items-center shrink-0">
                        <Sprout className="w-5 h-5 text-[#5EEAD4]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-[#5EEAD4]/90">
                          Selected Farm
                        </span>
                        <span
                          className="block text-[20px] sm:text-[23px] font-extrabold tracking-tight leading-tight text-white truncate mt-0.5"
                          style={{ textShadow: '0 2px 12px rgba(2, 14, 12, 0.45)' }}
                        >
                          {currentFarm?.name || 'Select a farm'}
                        </span>
                      </span>
                    </span>
                    <ChevronDown
                      className={`w-5 h-5 text-[#5EEAD4] shrink-0 transition-transform duration-200 ${
                        farmSwitcherOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {farmSwitcherOpen && (
                    <div className="absolute left-0 top-full mt-2 z-50 w-80 sm:w-96 rounded-[20px] bg-[#041F1B]/95 backdrop-blur-xl border border-[#2DD4BF]/45 p-2 shadow-2xl space-y-1">
                      {farms.map((farmItem) => {
                        const fieldCount = fields.filter((f) => f.farmId === farmItem.id).length;
                        const active = farmItem.id === currentFarm?.id;
                        return (
                          <button
                            key={farmItem.id}
                            type="button"
                            onClick={() => {
                              setSelectedFarmId(farmItem.id);
                              setFarmSwitcherOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2.5 rounded-[14px] text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                              active
                                ? 'bg-[#14B89A]/25 text-white font-semibold border border-[#2DD4BF]/40'
                                : 'text-[#D4ECE6] hover:bg-white/10'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="text-[14px] font-bold truncate">
                                {farmItem.name}
                              </div>
                              <div className="text-[10.5px] text-[#9BD5CA] truncate mt-0.5">
                                {farmItem.locationLabel || 'Saved farm'}
                                {fieldCount > 0 ? ` · ${fieldCount} field${fieldCount > 1 ? 's' : ''}` : ''}
                              </div>
                            </div>
                            {active && <Check className="w-4 h-4 text-[#5EEAD4] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 2. Transparent Field Dropdown branching directly beneath the Farm Name */}
                {currentFarmFields.length > 0 && (
                  <div className="relative pl-6 sm:pl-8 pt-2" ref={fieldSwitcherRef}>
                    {/* Visual tree connector from Farm card down to Field dropdown */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 sm:left-4 top-0 w-3.5 sm:w-4 h-[26px] border-l-2 border-b-2 border-[#5EEAD4]/50 rounded-bl-[10px]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setFarmSwitcherOpen(false);
                        setFieldSwitcherOpen((v) => !v);
                      }}
                      className="inline-flex items-center justify-between gap-3 min-w-[230px] sm:min-w-[280px] px-3.5 py-2 rounded-[14px] bg-transparent hover:bg-white/[0.08] backdrop-blur-sm border border-white/25 hover:border-[#5EEAD4]/55 text-left transition-all cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Layers className="w-4 h-4 text-[#5EEAD4] shrink-0" />
                        <span className="min-w-0 flex items-baseline gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#9BD5CA] shrink-0">
                            Field ({currentFarmFields.length})
                          </span>
                          <span
                            className="text-[14px] font-semibold text-white/95 truncate"
                            style={{ textShadow: '0 1px 8px rgba(2, 14, 12, 0.55)' }}
                          >
                            {currentField?.name || draft.fieldName}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 text-[#5EEAD4] shrink-0 transition-transform duration-200 ${
                          fieldSwitcherOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {fieldSwitcherOpen && (
                      <div className="absolute left-6 sm:left-8 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-[18px] bg-[#041F1B]/72 backdrop-blur-2xl border border-[#5EEAD4]/35 p-1.5 shadow-2xl space-y-1">
                        {currentFarmFields.map((fld) => {
                          const active = fld.id === currentField?.id;
                          const ver =
                            fld.versions.find((v) => v.geometryVersionId === fld.currentVersionId) ??
                            fld.versions[0];
                          return (
                            <button
                              key={fld.id}
                              type="button"
                              onClick={() => {
                                setSelectedFieldId(fld.id);
                                setFieldSwitcherOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-[12px] text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                active
                                  ? 'bg-[#14B89A]/25 text-white font-semibold border border-[#5EEAD4]/40'
                                  : 'text-[#E0F5F0] hover:bg-white/10'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-[13px] font-semibold truncate">{fld.name}</div>
                                <div className="text-[10.5px] text-[#9BD5CA] truncate mt-0.5">
                                  {fld.cropName || 'No active crop'}
                                  {ver?.netAreaHectares ? ` · ${ver.netAreaHectares.toFixed(1)} ha` : ''}
                                </div>
                              </div>
                              {active && <Check className="w-4 h-4 text-[#5EEAD4] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Current Plan / Review Gate Sheer Glass Card */}
          <div className="fs-rot-panel rounded-[24px] px-4 py-3.5 flex items-center justify-between gap-4 lg:gap-5 shrink-0 self-start md:self-end">
            <div className="flex items-center gap-2.5 text-left">
              <span
                className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${
                  engine.reviewGate.status === 'review_required'
                    ? 'bg-[#FF465A] text-white'
                    : engine.reviewGate.status === 'review_suggested'
                      ? 'bg-[#FFAD28] text-[#1A1204]'
                      : 'bg-[#24E982] text-[#042318]'
                }`}
              >
                {engine.reviewGate.status === 'current' ? (
                  <Check className="w-4 h-4" strokeWidth={3} />
                ) : (
                  <AlertCircle className="w-4 h-4" strokeWidth={2.6} />
                )}
              </span>
              <div>
                <div className="text-[13px] lg:text-[14px] font-semibold text-[#072622] dark:text-white leading-tight">
                  {engine.reviewGate.badgeLabel}
                </div>
                <div className="text-[11px] text-[#1B4D46] dark:text-[#A8D6CD] mt-0.5 tabular-nums">
                  Updated: {formatShortPlanDate(currentFarm?.activePlan?.selectedAt || draft.lastSavedAt)}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setWizardModal({ open: true, step: 0 })}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/75 dark:bg-[#05352E]/85 hover:bg-white dark:hover:bg-[#094D43] border border-[#0F766E]/35 dark:border-[#2DD4BF]/40 text-[11.5px] font-semibold text-[#072622] dark:text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-[#0F766E] dark:text-[#5EEAD4]" />
              <span>Edit inputs</span>
            </button>
          </div>
        </div>
      </header>

      {/* =================================================================== */}
      {/* MAIN DASHBOARD CONTAINER                                            */}
      {/* =================================================================== */}
      <div className="relative z-10 max-w-[1520px] w-full mx-auto px-5 sm:px-8 lg:px-14 xl:px-[74px] pt-2 space-y-5">
        {/* 02 — FARM INPUT SUMMARY CARDS (5 Equal Home-Style Glass Cards) */}
        <section
          aria-label="Farm input summary"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5"
        >
          {/* Card 1: Soil Texture */}
          <div className="fs-rot-panel rounded-[22px] p-4 flex items-center gap-3.5 text-left min-h-[86px]">
            <div className="w-11 h-11 rounded-full overflow-hidden shrink-0 border border-[#A07449]/60 shadow-[0_0_12px_rgba(160,116,73,0.35)] bg-[#3D2917]">
              <img
                src={ROTATION_MEDIA.loamSoil}
                alt="Loam soil profile"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A7D4CB] leading-tight">
                Soil Texture
              </div>
              <div className="text-[14px] font-bold text-[#072622] dark:text-white truncate mt-0.5">
                {draft.soilTexture}
              </div>
              <div className="text-[10.5px] font-medium text-[#0F766E] dark:text-[#24E982] truncate mt-0.5">
                {draft.soilTextureProvenance === 'from_field_data'
                  ? 'From field data'
                  : 'Farmer confirmed'}
              </div>
            </div>
          </div>

          {/* Card 2: Water Source */}
          <div className="fs-rot-panel rounded-[22px] p-4 flex items-center gap-3.5 text-left min-h-[86px]">
            <div
              className="w-11 h-11 rounded-full grid place-items-center shrink-0"
              style={{
                background:
                  'radial-gradient(circle, rgba(45, 212, 191, 0.25) 0%, rgba(6, 56, 52, 0.85) 75%)',
                border: '1px solid rgba(45, 212, 191, 0.45)',
              }}
            >
              <GlossyWaterDropletIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A7D4CB] leading-tight">
                Water Source
              </div>
              <div className="text-[14px] font-bold text-[#072622] dark:text-white truncate mt-0.5">
                {draft.waterSourceSummary}
              </div>
              <div className="text-[10.5px] font-medium text-[#0F766E] dark:text-[#5EEAD4] truncate mt-0.5">
                From farmer input
              </div>
            </div>
          </div>

          {/* Card 3: Recent Crop */}
          <div className="fs-rot-panel rounded-[22px] p-4 flex items-center gap-3.5 text-left min-h-[86px]">
            <div
              className="w-11 h-11 rounded-full grid place-items-center shrink-0"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,173,40,0.28) 0%, rgba(36,27,16,0.88) 75%)',
                border: '1px solid rgba(255,173,40,0.45)',
              }}
            >
              <Wheat className="w-5 h-5 text-[#FFAD28]" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A7D4CB] leading-tight">
                Recent Crop
              </div>
              <div className="text-[14px] font-bold text-[#072622] dark:text-white truncate mt-0.5">
                {draft.recentCropDisplay}
              </div>
              <div className="text-[10.5px] font-medium text-[#0F766E] dark:text-[#5EEAD4] truncate mt-0.5">
                Crop history
              </div>
            </div>
          </div>

          {/* Card 4: Planning Horizon */}
          <div className="fs-rot-panel rounded-[22px] p-4 flex items-center gap-3.5 text-left min-h-[86px]">
            <div
              className="w-11 h-11 rounded-full grid place-items-center shrink-0"
              style={{
                background:
                  'radial-gradient(circle, rgba(45, 212, 191, 0.22) 0%, rgba(5, 44, 40, 0.88) 75%)',
                border: '1px solid rgba(45, 212, 191, 0.42)',
              }}
            >
              <Calendar className="w-5 h-5 text-[#2DD4BF]" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A7D4CB] leading-tight">
                Planning Horizon
              </div>
              <div className="text-[14px] font-bold text-[#072622] dark:text-white truncate mt-0.5">
                {draft.planningHorizonSeasons} Seasons
              </div>
              <div className="text-[10.5px] text-[#285E55] dark:text-[#8BC4B9] truncate mt-0.5">
                {draft.cropsPerYear === 2 ? '2 crops / year' : '1 crop / year'}
              </div>
            </div>
          </div>

          {/* Card 5: Last Updated */}
          <div className="col-span-2 sm:col-span-1 fs-rot-panel rounded-[22px] p-4 flex items-center gap-3.5 text-left min-h-[86px]">
            <div
              className="w-11 h-11 rounded-full grid place-items-center shrink-0"
              style={{
                background:
                  'radial-gradient(circle, rgba(36, 233, 130, 0.24) 0%, rgba(5, 42, 36, 0.88) 75%)',
                border: '1px solid rgba(36, 233, 130, 0.42)',
              }}
            >
              <Clock className="w-5 h-5 text-[#24E982]" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold text-[#1B4D46] dark:text-[#A7D4CB] leading-tight">
                Last Updated
              </div>
              <div className="text-[14px] font-bold text-[#072622] dark:text-white truncate mt-0.5 tabular-nums">
                {formatShortPlanDate(draft.lastSavedAt)}
              </div>
              <div className="text-[10.5px] text-[#285E55] dark:text-[#8BC4B9] truncate mt-0.5">
                Auto-saved
              </div>
            </div>
          </div>
        </section>

        {/* Empty Constraint Fallback Card */}
        {!topActivePlan && (
          <section className="fs-rot-panel rounded-[26px] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-[#FF465A]/45">
            <div className="space-y-1.5">
              <div className="text-base font-bold text-[#072622] dark:text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[#FF465A]" />
                No rotation plans matched all active constraints
              </div>
              <p className="text-xs text-[#1B4D46] dark:text-[#CBE8E1]">
                Your current crop exclusions ({draft.excludedCrops.join(', ') || 'none'}) or
                required crops filtered out all valid non-repeating sequences (
                {engine.rejectedCandidates.length} audited &amp; rejected).
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  handleSaveDraftAndRun({ ...draft, excludedCrops: [], requiredCrops: [] }, false)
                }
                className="px-4 py-2 rounded-full bg-[#24E982] text-[#042318] text-xs font-bold hover:brightness-110 cursor-pointer"
              >
                Reset Constraints
              </button>
              <button
                type="button"
                onClick={() => setWizardModal({ open: true, step: 5 })}
                className="px-4 py-2 rounded-full border border-[#0F766E]/40 dark:border-white/25 text-xs font-semibold text-[#072622] dark:text-white hover:bg-white/10 cursor-pointer"
              >
                Edit Constraints
              </button>
            </div>
          </section>
        )}

        {/* 03 — MAIN #1 RECOMMENDED ROTATION CARD (Always shows #1 Best Rotation) */}
        {bestPlan && (
          <section
            aria-label="Best rotation plan"
            className="fs-rot-panel rounded-[28px] overflow-hidden"
          >
            <PlanShowcaseBody
              plan={bestPlan}
              isPreviewActive={bestPlan.id === topActivePlan?.id}
              onInspectDetails={(p) => setDetailModalPlan(p)}
              onSelectPreview={(id) => {
                setPreviewPlanId(id);
                showToast(`Switched active preview back to #1 ${bestPlan.planCode}.`, 'info');
              }}
              isSlideVariant={bestPlan.id !== topActivePlan?.id}
            />
          </section>
        )}

        {/* 04 — ALL OTHER RANKED ROTATIONS (#2, #3, #4...) IN A VERTICAL SLIDING CARD */}
        {otherRankedPlans.length > 0 && (
          <section
            aria-label="Other ranked rotations"
            className="fs-rot-panel rounded-[28px] p-5 space-y-4"
          >
            {/* Header & Vertical Slide Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-full bg-[#0F766E]/15 dark:bg-[#2DD4BF]/18 border border-[#0F766E]/30 dark:border-[#2DD4BF]/35 grid place-items-center text-[#0F766E] dark:text-[#2DD4BF] shrink-0">
                  <Sprout className="w-4 h-4" />
                </span>
                <div>
                  <h2 className="text-[16px] lg:text-[17px] font-bold text-[#072622] dark:text-[#ECF8F5] leading-tight">
                    Other Ranked Rotations ({otherRankedPlans.length})
                  </h2>
                  <p className="text-[11.5px] text-[#1B4D46] dark:text-[#96C7BE]">
                    All remaining eligible sequences ranked #2 through #{engine.candidates.length} —
                    slide vertically to browse every option
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Quick Rank Jump Buttons */}
                <div className="flex items-center gap-1 p-1 rounded-full bg-white/40 dark:bg-[#04211D]/80 border border-[#0F766E]/25 dark:border-[#2DD4BF]/25">
                  {otherRankedPlans.map((cand, idx) => (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => scrollToRankedSlide(idx)}
                      className={`h-7 px-2.5 rounded-full text-[11px] font-bold tabular-nums transition-colors cursor-pointer ${
                        activeSlideIdx === idx
                          ? 'bg-[#0F766E] dark:bg-[#2DD4BF] text-white dark:text-[#04211D]'
                          : 'text-[#1B4D46] dark:text-[#A8D6CD] hover:text-[#072622] dark:hover:text-white'
                      }`}
                    >
                      #{cand.rank}
                    </button>
                  ))}
                </div>

                {/* Up / Down Vertical Slide Buttons */}
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => scrollToRankedSlide(activeSlideIdx - 1)}
                    disabled={activeSlideIdx === 0}
                    aria-label="Previous ranked rotation"
                    className="w-8 h-8 rounded-full grid place-items-center bg-white/55 dark:bg-[#06322C]/80 border border-[#0F766E]/30 dark:border-[#2DD4BF]/35 text-[#072622] dark:text-white disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed hover:bg-white dark:hover:bg-[#0B4A42] transition-colors"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <span className="text-[11.5px] font-semibold tabular-nums px-1.5 text-[#1B4D46] dark:text-[#A8D6CD]">
                    {activeSlideIdx + 1} / {otherRankedPlans.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => scrollToRankedSlide(activeSlideIdx + 1)}
                    disabled={activeSlideIdx >= otherRankedPlans.length - 1}
                    aria-label="Next ranked rotation"
                    className="w-8 h-8 rounded-full grid place-items-center bg-white/55 dark:bg-[#06322C]/80 border border-[#0F766E]/30 dark:border-[#2DD4BF]/35 text-[#072622] dark:text-white disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed hover:bg-white dark:hover:bg-[#0B4A42] transition-colors"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Vertical Sliding Viewport (Identical full card presentation per ranked rotation) */}
            <div
              ref={rankedSliderRef}
              onScroll={handleRankedSliderScroll}
              className="relative h-[560px] sm:h-[520px] xl:h-[395px] overflow-y-auto snap-y snap-mandatory fs-thin-scroll rounded-[22px] border border-white/55 dark:border-[#2DD4BF]/32 bg-white/18 dark:bg-[#031B18]/24 scroll-smooth"
            >
              {otherRankedPlans.map((cand) => (
                <div
                  key={cand.id}
                  className="min-h-full snap-start flex items-stretch border-b border-[#0F766E]/15 dark:border-teal-300/15 last:border-b-0"
                >
                  <PlanShowcaseBody
                    plan={cand}
                    isPreviewActive={cand.id === topActivePlan?.id}
                    onInspectDetails={(p) => setDetailModalPlan(p)}
                    onSelectPreview={(id) => {
                      setPreviewPlanId(id);
                      showToast(
                        `Now previewing ${cand.planCode} (Rank #${cand.rank}) across insights & overview.`,
                        'info'
                      );
                    }}
                    isSlideVariant={true}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 05 — KEY INSIGHTS (2/3 Left) + HEALTHIER SOIL PROMO (1/3 Right) */}
        {topActivePlan && (
          <section className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
            {/* Key Insights Card */}
            <div className="fs-rot-panel rounded-[26px] p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4 text-[#0F766E] dark:text-[#24E982]" />
                  <h2 className="text-[15.5px] lg:text-[16.5px] font-bold text-[#072622] dark:text-[#ECF8F5]">
                    Key Insights ({topActivePlan.planCode})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailModalPlan(topActivePlan)}
                  className="text-[11.5px] font-semibold text-[#0F766E] dark:text-[#5EEAD4] hover:underline cursor-pointer"
                >
                  Inspect calculations →
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 pb-1">
                {[
                  {
                    label: 'Soil Health',
                    val: topActivePlan.components.soilHealth,
                    color: '#24E982',
                    glow: 'rgba(36, 233, 130, 0.36)',
                  },
                  {
                    label: 'Water Efficiency',
                    val: topActivePlan.components.waterEfficiency,
                    color: '#2DD4BF',
                    glow: 'rgba(45, 212, 191, 0.36)',
                  },
                  {
                    label: 'Productivity',
                    val: topActivePlan.components.productivity,
                    color: '#FFA826',
                    glow: 'rgba(255, 168, 38, 0.36)',
                  },
                  {
                    label: 'Diversity',
                    val: topActivePlan.components.diversity,
                    color: '#38BDF8',
                    glow: 'rgba(56, 189, 248, 0.36)',
                  },
                ].map((metric) => (
                  <div
                    key={metric.label}
                    className="flex flex-col items-center text-center"
                  >
                    <CircularMetricGauge
                      value={metric.val}
                      size={86}
                      stroke={7}
                      color={metric.color}
                      trackColor="rgba(15, 118, 110, 0.25)"
                      glowColor={metric.glow}
                    >
                      <span className="text-[18px] font-extrabold text-[#072622] dark:text-white leading-none tabular-nums">
                        {metric.val}
                        <span className="text-[11px] font-semibold text-[#1B4D46] dark:text-[#A8D6CD]">
                          %
                        </span>
                      </span>
                    </CircularMetricGauge>
                    <span className="text-[12px] font-medium text-[#1B4D46] dark:text-[#B9E2DA] mt-2.5">
                      {metric.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Healthy Soil Promo Card */}
            <div className="fs-rot-panel rounded-[26px] p-4 flex items-stretch gap-4">
              <img
                src={ROTATION_MEDIA.seedling}
                alt="Healthy seedling sprouting from rich agricultural loam"
                className="w-[136px] sm:w-[152px] xl:w-[168px] h-auto min-h-[146px] rounded-[18px] object-cover shrink-0 border border-white/25 dark:border-[#2DD4BF]/25"
              />
              <div className="flex flex-col justify-between py-1 min-w-0">
                <div>
                  <h3 className="text-[15.5px] lg:text-[17px] font-bold text-[#072622] dark:text-white leading-tight">
                    Healthier Soil,
                    <br />
                    Higher Yields
                  </h3>
                  <p className="text-[11.5px] leading-relaxed text-[#1B4D46] dark:text-[#BCE2DA] mt-2">
                    This rotation improves soil structure and interrupts disease &amp; weed cycles.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSuitabilityModal({ open: true, tab: 'suitability', step: null })
                  }
                  className="mt-3 self-start inline-flex items-center gap-1.5 h-8 px-4 rounded-full bg-white/40 dark:bg-[#0B4A42]/55 hover:bg-white/70 dark:hover:bg-[#115E54]/80 border border-[#0F766E]/35 dark:border-[#2DD4BF]/45 text-[11.5px] font-semibold text-[#072622] dark:text-white whitespace-nowrap cursor-pointer transition-colors"
                >
                  <span>Learn More</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </section>
        )}

        {/* 06 — CROP SEQUENCE TIMELINE */}
        {topActivePlan && (
          <section
            aria-label="Crop sequence timeline"
            className="fs-rot-panel !overflow-visible rounded-[26px] p-5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 text-[#0F766E] dark:text-[#2DD4BF]" />
                <h2 className="text-[15.5px] lg:text-[16.5px] font-bold text-[#072622] dark:text-[#ECF8F5]">
                  Crop Sequence Timeline
                </h2>
              </div>

              <div className="relative z-30" ref={timelineMenuRef}>
                <button
                  type="button"
                  onClick={() => setTimelineMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-white/55 dark:bg-[#05322C]/85 border border-[#0F766E]/30 dark:border-[#2DD4BF]/35 text-[11.5px] font-semibold text-[#072622] dark:text-[#D5EEE9] hover:text-[#072622] dark:hover:text-white cursor-pointer"
                >
                  <span>{timelineViewLabels[timelineView]}</span>
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                {timelineMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 z-40 w-44 rounded-xl bg-white/95 dark:bg-[#04221E]/98 border border-[#0F766E]/30 dark:border-[#2DD4BF]/40 p-1 shadow-2xl text-xs">
                    {(['seasons', 'windows', 'water_n'] as const).map((modeKey) => (
                      <button
                        key={modeKey}
                        type="button"
                        onClick={() => {
                          setTimelineView(modeKey);
                          setTimelineMenuOpen(false);
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded-lg cursor-pointer ${
                          timelineView === modeKey
                            ? 'bg-[#0F766E]/15 dark:bg-[#2DD4BF]/20 text-[#0F766E] dark:text-[#5EEAD4] font-semibold'
                            : 'text-[#1B4D46] dark:text-[#C5E4DD] hover:bg-black/5 dark:hover:bg-white/10'
                        }`}
                      >
                        {timelineViewLabels[modeKey]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <BotanicalCropTimelineSvg
              steps={topActivePlan.steps}
              selectedSeason={selectedTimelineSeason}
              onSelectSeason={(sNum) =>
                setSelectedTimelineSeason((prev) => (prev === sNum ? 0 : sNum))
              }
            />

            <div
              className="grid gap-3 text-center pt-1"
              style={{
                gridTemplateColumns: `repeat(${topActivePlan.steps.length}, minmax(0, 1fr))`,
              }}
            >
              {topActivePlan.steps.map((step) => (
                <div
                  key={step.occurrenceId}
                  className="rounded-xl py-1.5"
                >
                  <div className="text-[12px] lg:text-[12.5px] font-bold text-[#072622] dark:text-white leading-tight">
                    {step.seasonLabel}
                  </div>
                  <div className="text-[11px] lg:text-[11.5px] text-[#1B4D46] dark:text-[#B9E2DA] mt-0.5">
                    {timelineView === 'seasons' && step.cropName}
                    {timelineView === 'windows' &&
                      `${step.cropName} (${step.plantingWindow.split('(')[0].trim()})`}
                    {timelineView === 'water_n' &&
                      `${step.cropName} · ${step.etcMmEstimate}mm / ${
                        step.nitrogenBalanceKgHa >= 0 ? '+' : ''
                      }${step.nitrogenBalanceKgHa}N`}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 07 — HEAD-TO-HEAD ROTATION COMPARISON (Pros & Cons Cards Only) */}
        {compareLeftPlan && compareRightPlan && leftProsCons && rightProsCons && (
          <section
            aria-label="Compare two chosen rotations"
            className="fs-rot-panel !overflow-visible rounded-[28px] p-5 lg:p-6 space-y-4"
          >
            {/* Header Row */}
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-[#0F766E]/15 dark:bg-[#2DD4BF]/18 border border-[#0F766E]/30 dark:border-[#2DD4BF]/35 grid place-items-center text-[#0F766E] dark:text-[#2DD4BF] shrink-0">
                <Scale className="w-4 h-4" />
              </span>
              <div>
                <h2 className="text-[16px] lg:text-[17px] font-bold text-[#072622] dark:text-[#ECF8F5] leading-tight">
                  Compare Rotations
                </h2>
                <p className="text-[11.5px] text-[#1B4D46] dark:text-[#96C7BE]">
                  Select two rotations to compare their pros and cons
                </p>
              </div>
            </div>

            {/* Two-Column Pros & Cons Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                {
                  slotLabel: 'Rotation 1',
                  plan: compareLeftPlan,
                  prosCons: leftProsCons,
                  onChange: setCompareLeftId,
                },
                {
                  slotLabel: 'Rotation 2',
                  plan: compareRightPlan,
                  prosCons: rightProsCons,
                  onChange: setCompareRightId,
                },
              ].map((col) => (
                <div
                  key={col.slotLabel}
                  className="fs-rot-subcard !overflow-visible rounded-[20px] p-4 lg:p-5 flex flex-col gap-4"
                >
                  <div className="space-y-2 pb-3 border-b border-[#0F766E]/15 dark:border-white/10">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#0F766E] dark:text-[#5EEAD4]">
                      {col.slotLabel}
                    </div>
                    <RotationSelectDropdown
                      label={col.slotLabel}
                      options={engine.candidates}
                      value={col.plan.id}
                      onChange={col.onChange}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
                    {/* Pros */}
                    <div>
                      <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#059669] dark:text-[#24E982] mb-2">
                        <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Pros</span>
                      </div>
                      <ul className="space-y-2">
                        {col.prosCons.pros.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-2 text-[11.5px] leading-snug text-[#14433C] dark:text-[#D5EEE9]"
                          >
                            <Check
                              className="w-3.5 h-3.5 text-[#059669] dark:text-[#24E982] shrink-0 mt-0.5"
                              strokeWidth={2.8}
                            />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Cons */}
                    <div>
                      <div className="flex items-center gap-1.5 text-[12px] font-bold text-[#B45309] dark:text-[#FBBF24] mb-2">
                        <MinusCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Cons</span>
                      </div>
                      <ul className="space-y-2">
                        {col.prosCons.cons.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-2 text-[11.5px] leading-snug text-[#3F3118] dark:text-[#F4E1C0]"
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-[#D97706] dark:text-[#FBBF24] shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 08 — DETAILED PLAN OVERVIEW + ADDITIONAL INSIGHTS */}
        {topActivePlan && (
          <section className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-5 items-stretch">
            {/* Left: Detailed Plan Overview */}
            <div className="fs-rot-panel rounded-[26px] p-5 flex flex-col justify-between gap-3.5">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-full bg-[#0F766E]/15 dark:bg-[#24E982]/16 border border-[#0F766E]/30 dark:border-[#24E982]/35 grid place-items-center text-[#0F766E] dark:text-[#24E982]">
                    <FileText className="w-4 h-4" />
                  </span>
                  <div>
                    <h2 className="text-[15.5px] lg:text-[16.5px] font-bold text-[#072622] dark:text-white leading-tight">
                      Detailed Plan Overview ({topActivePlan.planCode})
                    </h2>
                    <p className="text-[11.5px] text-[#1B4D46] dark:text-[#96C7BE]">
                      Your complete seasonal sequence at a glance
                    </p>
                  </div>
                </div>

                <div className="mt-3.5 rounded-[16px] overflow-hidden border border-white/55 dark:border-[#2DD4BF]/22 bg-white/25 dark:bg-[#031B18]/36">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#0F766E]/12 dark:bg-[#073830]/48 text-[11px] font-semibold text-[#072622] dark:text-[#C5E4DD]">
                        <th className="py-2.5 px-3">Season</th>
                        <th className="py-2.5 px-2.5">Crop</th>
                        <th className="py-2.5 px-2.5">Duration</th>
                        <th className="py-2.5 px-3">Key Benefit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#0F766E]/12 dark:divide-white/[0.07] text-[11.5px]">
                      {topActivePlan.steps.map((step) => (
                        <tr key={step.occurrenceId}>
                          <td className="py-2.5 px-3 font-mono text-[#1B4D46] dark:text-[#A8D6CD] tabular-nums">
                            {step.seasonNumber}
                          </td>
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-2">
                              <img
                                src={resolveRotationCropImage(step.cropId)}
                                alt=""
                                className="w-4 h-4 rounded-sm object-cover shrink-0"
                              />
                              <span className="font-semibold text-[#072622] dark:text-white whitespace-nowrap">
                                {step.cropName}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2.5 text-[#1B4D46] dark:text-[#C5E4DD] tabular-nums whitespace-nowrap">
                            ~{step.durationDays} days
                          </td>
                          <td className="py-2.5 px-3 text-[#1B4D46] dark:text-[#C5E4DD]">
                            {step.keyBenefit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleDownloadPdf(topActivePlan)}
                className="w-full h-10 rounded-full inline-flex items-center justify-center gap-2 text-[12px] font-semibold text-[#072622] dark:text-white bg-white/55 dark:bg-[#063831]/85 hover:bg-white dark:hover:bg-[#0A4E44] border border-[#0F766E]/35 dark:border-[#2DD4BF]/40 transition-all cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#0F766E] dark:text-[#5EEAD4]" />
                <span>Download Plan PDF</span>
              </button>
            </div>

            {/* Right: Additional Insights */}
            <div className="fs-rot-panel rounded-[26px] p-5 flex flex-col justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Lightbulb className="w-4 h-4 text-[#D97706] dark:text-[#FFAD28]" />
                <div>
                  <h2 className="text-[15.5px] lg:text-[16.5px] font-bold text-[#072622] dark:text-white leading-tight">
                    Additional Insights
                  </h2>
                  <p className="text-[11.5px] text-[#1B4D46] dark:text-[#96C7BE]">
                    Data-backed agronomic notes for your field
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 flex-1">
                {engine.additionalInsights.map((tile) => {
                  const isWater = tile.category === 'water';
                  const isLegume = tile.category === 'legume';
                  return (
                    <div
                      key={tile.id}
                      className="fs-rot-subcard rounded-[18px] p-3.5 flex items-start gap-3"
                    >
                      <span
                        className={`w-8 h-8 rounded-full grid place-items-center shrink-0 mt-0.5 ${
                          isWater
                            ? 'bg-[#0EA5E9]/18 text-[#0284C7] dark:text-[#38BDF8]'
                            : 'bg-[#10B981]/18 text-[#059669] dark:text-[#24E982]'
                        }`}
                      >
                        {isWater ? (
                          <GlossyWaterDropletIcon className="w-4 h-4" />
                        ) : isLegume ? (
                          <Sprout className="w-4 h-4" />
                        ) : (
                          <Leaf className="w-4 h-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-bold text-[#072622] dark:text-white leading-tight">
                          {tile.title}
                        </div>
                        <p className="text-[11.5px] leading-[1.4] text-[#14433C] dark:text-[#D5EEE9] mt-1">
                          {tile.summary}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* 09 — BOTTOM INFORMATION & ACTION BAR (Home-style banner) */}
        <footer className="pt-1 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3.5">
          <div className="fs-rot-panel flex-1 rounded-[24px] px-4 py-3 flex items-center gap-3 text-[12px] text-[#14433C] dark:text-[#C5E4DD]">
            <span className="w-5 h-5 rounded-full bg-[#0F766E] dark:bg-[#2DD4BF] text-white dark:text-[#042318] grid place-items-center shrink-0">
              <Info className="w-3.5 h-3.5" />
            </span>
            <span>
              <strong className="text-[#072622] dark:text-white font-semibold">Note:</strong> Selecting
              a plan requires your confirmation and preserves previous versions.
              {decisions.length > 0
                ? ` (${decisions.filter((d) => d.farmId === currentFarm.id).length} logged versions)`
                : ''}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setSaveModalOpen(true)}
              className="relative inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full text-[12.5px] font-bold text-[#031F1C] cursor-pointer transition-all hover:brightness-110 whitespace-nowrap bg-gradient-to-r from-[#5EEAD4] via-[#2DD4BF] to-[#24E982] shadow-[0_6px_18px_rgba(20,184,154,0.34)]"
            >
              <Check className="w-4 h-4" strokeWidth={3} />
              <span>Save as active plan</span>
              {hasUnsavedPlanDiff && (
                <span
                  aria-label="Unsaved plan changes pending confirmation"
                  className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#FF465A] ring-2 ring-[#C2DFD9] dark:ring-[#041513]"
                />
              )}
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="fs-rot-panel fs-rot-subcard-interactive inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full text-[12px] font-semibold text-[#072622] dark:text-[#ECF8F5] cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>Export plan</span>
            </button>

            <button
              type="button"
              onClick={() => setWizardModal({ open: true, step: 0 })}
              className="fs-rot-panel fs-rot-subcard-interactive inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-full text-[12px] font-semibold text-[#072622] dark:text-[#ECF8F5] cursor-pointer whitespace-nowrap"
            >
              <Pencil className="w-4 h-4" />
              <span>Edit inputs</span>
            </button>
          </div>
        </footer>
      </div>

      {/* =================================================================== */}
      {/* INTERACTIVE MODALS & WIZARDS                                        */}
      {/* =================================================================== */}
      <EditInputsWizardModal
        open={wizardModal.open}
        initialStep={wizardModal.step}
        draft={draft}
        farms={farms}
        fields={fields}
        onSwitchFarm={(fid) => setSelectedFarmId(fid)}
        onSaveDraftAndRun={handleSaveDraftAndRun}
        onClose={() => setWizardModal((w) => ({ ...w, open: false }))}
      />

      {detailModalPlan && (
        <PlanDetailEvidenceModal
          open={Boolean(detailModalPlan)}
          plan={detailModalPlan}
          engine={engine}
          draft={draft}
          onDownloadPdf={() => handleDownloadPdf(detailModalPlan)}
          onRequestSave={() => {
            setPreviewPlanId(detailModalPlan.id);
            setDetailModalPlan(null);
            setSaveModalOpen(true);
          }}
          onClose={() => setDetailModalPlan(null)}
        />
      )}

      <CropSuitabilityDetailModal
        open={suitabilityModal.open}
        initialTab={suitabilityModal.tab}
        selectedStep={suitabilityModal.step}
        suitabilityList={engine.cropSuitability}
        farmName={currentFarm?.name || 'Farm'}
        onClose={() => setSuitabilityModal((s) => ({ ...s, open: false }))}
      />

      {topActivePlan && currentFarm && (
        <ConfirmSavePlanModal
          open={saveModalOpen}
          farm={currentFarm}
          plan={topActivePlan}
          onConfirmSave={handleConfirmSaveActivePlan}
          onClose={() => setSaveModalOpen(false)}
        />
      )}
    </div>
  );
};
