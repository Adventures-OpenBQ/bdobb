// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import type { RuntimeParams, ParamMatch } from './runtimeParams';
export type { RuntimeParams, RuntimeParam, ParamMatch } from './runtimeParams';
import type { Periodicity } from "../periodicity";
import type { TableCardState, AggName } from "../types";
import type { CloneSafeValue, DatasetColumn, DatasetRow, DatasetProvenance, DatasetCompleteness, DatasetFreshness, DatasetCellError, WidgetDataset } from "../widgetData/types";
export type Revision = { widgetId: string; input: number; model: number; output: number };
export type TableDefinition = { table: TableCardState; search: string; analytical?: unknown };
export type SelectionSpec = { kind: "none" } | { kind: "explicit"; ids: string[] } | { kind: "allMatching"; excludedIds: string[] };
export type SelectionAction = { kind: 'summary' | 'all' | 'clear' } | { kind: 'toggle'; rowId: string };
export type SelectionRowState = { rowId: string; selectable: boolean; checked: boolean; indeterminate: boolean };
export type SelectionSummary = { selection: SelectionSpec; selectedCount: number; eligibleCount: number; checked: boolean; indeterminate: boolean; rows: SelectionRowState[] };
export type IdentityWitness = { id: string; state: 'present' | 'absent' | 'unknown' };
export type IdentityWitnessResult = ResponseEnvelope & { kind: 'identityWitness'; identities: IdentityWitness[] };
export type SelectionResult = ResponseEnvelope & SelectionSummary & { kind: 'selection' };
/** Each path component is a stable group ID, never a display label. */
export type RowRequest = { groupPath: string[]; offset: number; limit: number };
export type ResultContext = { modelWarnings?: import('../widgetData/types').DatasetModelWarning[]; modelWarningCount?: number; completeness: DatasetCompleteness; diagnostics: Diagnostic[] };
/** Before acquisition, use unknown completeness with honest warnings. */
export type ResponseEnvelope = ResultContext & { requestId: string; revision: Revision };
export type Diagnostic = { key?:string; memberKeys?:string[]; unmatchedCount?:number; truncated?:boolean; code: string; message: string; severity: "info" | "warning" | "error" };
export type Scope = "input" | "filtered" | "selected" | "presented";
export type ScopedValues = { scope: Scope; values: Record<string, CloneSafeValue>; empty?: boolean; cellErrors?: Record<string, DatasetCellError>; members?: { key: string; label: string; value: CloneSafeValue; count: number }[] };
export type LogicalGroup = { id: string; path: string[]; rows: DatasetRow[]; children: LogicalGroup[] };
/** Internal calculated engine state; it must not be published as a snapshot. */
export type CalculatedView = ResultContext & { paramMatches?: ParamMatch[]; analytical?: import('../tableModel/calculate').CalculatedTable; selection: SelectionSpec; selectionNamespace?: string; selectionHierarchy: Map<string, string[]>; selectionIdentityRows: DatasetRow[]; inputColumns: DatasetColumn[]; inputPeriodicity: Record<string, Periodicity>; definition: TableDefinition; freshness: DatasetFreshness; presentedRows: DatasetRow[]; columns: DatasetColumn[]; chartColumns?: DatasetColumn[]; logicalRows: DatasetRow[]; groups: LogicalGroup[]; selectionEligibleRows: DatasetRow[]; facets: Record<string, ScopedValues>; totals: ScopedValues; diagnostics: Diagnostic[]; provenance: DatasetProvenance };
export type InspectionCollection = 'definitions' | 'warnings' | 'periodBounds' | 'groupDomain';
export type InspectionRequest = { collection: InspectionCollection; offset: number; limit: number; definitionId?: string; paramKey?:string; categoryId?:string; categoryRecipe?:string; groupEvidence?:{groupId:string;transportValue:string} };
export type DefinitionInspection = { kind: 'formula' | 'measure' | 'category'; id: string; name: string; referenceIds: string[]; referenceCount: number; truncatedReferences: boolean; resolvedOperators: AggName[]; scope?: 'source' | 'aggregate'; sourceFilterKind?: import('../tableFiltering').FilterKind };
export type WarningInspection = { kind: 'warning'; id: string; code: string; message: string; categoryId?: string; periodCount: number };
export type PeriodInspection = { kind: 'periodBounds'; warningId: string; categoryId?: string; companyKey: string; start: string; end: string; source: string; period: string; context: string };
export type InspectionCounts = Record<Exclude<InspectionCollection,'groupDomain'>, number>;
export type GroupMemberInspection = {kind:'groupMember';key:string;label:string;transport:string;labelTruncated:boolean;observedCount:number;eligibleCount:number;matched:boolean};
export type GroupDomainSummary = {classificationComplete:boolean;categoryErrorCount:number;omittedCount:number;scanned:number;status:'resolved'|'refused';reason?:'ambiguous'|'partial'|'budget';inputCount:number;matchedKeyCount:number;unmatched:string[];unmatchedCount:number};
export type InspectionPage = InspectionRequest & { rows: (DefinitionInspection | WarningInspection | PeriodInspection | GroupMemberInspection)[]; total: number; nextOffset?: number; truncated: boolean; domain?:GroupDomainSummary };
export type InspectionResult = ResponseEnvelope & InspectionPage & { kind: 'inspect' };
export type ViewReady = ResponseEnvelope & { kind: "viewReady"; selection?: SelectionSpec; selectionNamespace?: string; columns: DatasetColumn[]; chartColumns?: DatasetColumn[]; topLevelCount: number; diagnostics: Diagnostic[]; inspection: { inputColumns: DatasetColumn[]; inputPeriodicity: Record<string, Periodicity>; definition: TableDefinition; aggregations: Record<string, CloneSafeValue>; counts?: InspectionCounts; paramMatches?: ParamMatch[] } };
/** siblingCount counts rows under this parent only. */
export type RowBlock = ResponseEnvelope & { kind: "rows"; selection?: SelectionSummary; groupPath: string[]; offset: number; rows: DatasetRow[]; siblingCount: number; groups: { rowId: string; path: string[]; childCount: number }[] };
export type FacetResult = ResponseEnvelope & ScopedValues & { kind: "facets"; categoryId: string };
export type TotalResult = ResponseEnvelope & ScopedValues & { kind: "totals" };
export type SubsetBatch = ResponseEnvelope & { kind: "subset"; transferId: string; sequence: number; columns?: DatasetColumn[]; provenance?: DatasetProvenance; freshness?: DatasetFreshness; rows: DatasetRow[]; final: boolean };
export type ChartResult = WidgetDataset & ResponseEnvelope & { kind: "chartData" };
export type ProtocolErrorDescriptor = { code: "INVALID_REQUEST" | "INVALID_RESPONSE" | "UNBOUND_ANALYTICAL" | "REVISION_MISMATCH" | "MISSING_FIELD" | "RESOURCE_LIMIT"; message: string };
export type InputSchema = ResponseEnvelope & { kind: "inputSchema"; columns: DatasetColumn[] };
export type FormulaDraft = Omit<import('../tableModel/types').FormulaDef,'ast'>;
export type ScopedFormulaBinding = {scope:'source'|'aggregate';name:string;reference:Extract<import('../tableModel/types').FormulaAst,{kind:'reference'}>};
export type FormulaBindRequest = {definition:TableDefinition;draft:FormulaDraft;bindings:ScopedFormulaBinding[]};
export type AuthoringWarnings = {authoringWarnings:Diagnostic[];authoringWarningCount:number;authoringWarningsTruncated:boolean};
export type FormulaBindResult = ResponseEnvelope & AuthoringWarnings & {kind:'bindFormula';ast?:import('../tableModel/types').FormulaAst;bindingDiagnostics:import('../tableModel/formulaSyntax').FormulaDiagnostic[];diagnosticCount:number;truncated:boolean;resolvedOperators:AggName[]};
export type MemberDomainRequest = {definition:TableDefinition;categoryId:string;categoryRecipe:string;offset:number;limit:number;search?:string};
export type ObservedMember = {key:string;label:string;labelTruncated:boolean;value:number|string|boolean|null;observedCount:number;eligibleCount:number};
export type MemberDomainResult = ResponseEnvelope & AuthoringWarnings & {kind:'memberDomain';categoryId:string;categoryRecipe:string;offset:number;limit:number;search?:string;rows:ObservedMember[];total:number;nextOffset?:number;truncated:boolean;scanned:number;omittedCount:number;classificationComplete:boolean;categoryErrorCount:number};
export type DefinitionPreview = ResponseEnvelope & {kind: "previewDefinition"; columns: DatasetColumn[]; rows: DatasetRow[]; total: number};
export type ExecutionResponse = DefinitionPreview | FormulaBindResult | MemberDomainResult | InputSchema | InspectionResult | IdentityWitnessResult | SelectionResult | ViewReady | RowBlock | FacetResult | TotalResult | SubsetBatch | ChartResult | (ResponseEnvelope & { kind: "registered" }) | (ResponseEnvelope & { kind: "error"; error: ProtocolErrorDescriptor });
type RequestEnvelope = { requestId: string; revision: Revision };
export type ExecutionRequest = RequestEnvelope & (
  | { kind: "previewDefinition"; definition: TableDefinition }
  | ({ kind: "bindFormula" } & FormulaBindRequest)
  | ({ kind: "memberDomain" } & MemberDomainRequest)
  | { kind: "inputSchema" }
  | { kind: "registerInput"; input: WidgetDataset; inputRevision: number }
  | { kind: "importFile"; name: string; bytes: Uint8Array; inputRevision: number }
  | { kind: "nextSubset"; transferId: string; sequence: number }
  | { kind: "applyModel"; definition: TableDefinition; selection: SelectionSpec; reconcileMissing?: boolean; previousSelectionNamespace?: string; provenAbsentIds?: string[]; runtimeParams?: RuntimeParams }
  | { kind: "identityWitness"; path: TableDefinition[]; ids: string[] }
  | { kind: "selection"; action: SelectionAction; visibleIds: string[] }
  | { kind: "rows"; request: RowRequest }
  | { kind: "facets"; categoryId: string }
  | ({ kind: "inspect" } & InspectionRequest)
  | { kind: "totals" }
  | { kind: "chartData"; fields: string[] }
  | { kind: "presented"; transferId: string; ignoreSelection?: boolean }
  | { kind: "cancel"; targetRequestId: string }
  | { kind: "dispose" }
);
export interface TableExecutor {
  previewDefinition?(revision: Revision, definition: TableDefinition, signal: AbortSignal): Promise<DefinitionPreview>;
  /** Optional private existence proof capability; executors without it retain ambiguous identities. */
  identityWitness?(revision: Revision, path: TableDefinition[], ids: string[], signal: AbortSignal): Promise<IdentityWitnessResult>;
  bindFormula?(revision:Revision,request:FormulaBindRequest,signal:AbortSignal):Promise<FormulaBindResult>;
  memberDomain?(revision:Revision,request:MemberDomainRequest,signal:AbortSignal):Promise<MemberDomainResult>;
  registerInput(input: WidgetDataset, inputRevision: number, signal: AbortSignal): Promise<void>;
  applyModel(definition: TableDefinition, selection: SelectionSpec, revision: Revision, signal: AbortSignal, reconcileMissing?: boolean, previousSelectionNamespace?: string, provenAbsentIds?: string[], runtimeParams?: RuntimeParams): Promise<ViewReady>;
  selection(revision: Revision, action: SelectionAction, visibleIds: string[], signal: AbortSignal): Promise<SelectionResult>;
  rows(revision: Revision, request: RowRequest, signal: AbortSignal): Promise<RowBlock>;
  facets(revision: Revision, categoryId: string, signal: AbortSignal): Promise<FacetResult>;
  inspect?(revision: Revision, request: InspectionRequest, signal: AbortSignal): Promise<InspectionResult>;
  totals(revision: Revision, signal: AbortSignal): Promise<TotalResult>;
  chartData(revision: Revision, fields: string[], signal: AbortSignal): Promise<ChartResult>;
  /** ignoreSelection: every row the table shows (Export), not the subset linked children receive. */
  presented(revision: Revision, signal: AbortSignal, ignoreSelection?: boolean): AsyncIterable<SubsetBatch>;
  dispose(): void;
}

export interface LocalWorkerExecutor extends TableExecutor {
  inputSchema?(signal: AbortSignal): Promise<InputSchema>;
  identityWitness(revision: Revision, path: TableDefinition[], ids: string[], signal: AbortSignal): Promise<IdentityWitnessResult>;
  importFile(name: string, bytes: Uint8Array, inputRevision: number, signal: AbortSignal): Promise<void>;
}

/** Acquisition is separate from the common calculated-result contract. */
export type SourceBinding =
  | { kind: 'local'; input: WidgetDataset; inputRevision: number }
  | { kind: 'remote'; sourceId: string; snapshotId: string;
      /** Managed protocol v1 opens a fresh server snapshot; snapshotId is a legacy hint only. */
      managed?: { version: 1; inputRevision: number } };
export type SessionOptions = { protocolVersion: number; widgetId: string; locale: string; signal?: AbortSignal };
/** Matches the portable core wire counts; absence is never an exact empty result. */
export type ProviderCount = { kind: 'exact' | 'estimated'; value: number } | { kind: 'unknown' | 'snapshotExpired' };
export type ProviderFeature = 'grouping' | 'splits' | 'sourceFormulas' | 'aggregateFormulas' | 'memberScope' | 'runtimeParams' | 'checklists' | 'resultFilters' | 'statement' | 'preview' | 'bindFormula' | 'memberDomain' | 'chart' | 'export';
export type ProviderApplyRequirements = { counts: 'safeExact' };
export type ProviderCapabilities = {
  readonly protocolVersions: readonly number[];
  readonly definitionVersions: readonly number[];
  readonly aggregations: readonly AggName[];
  readonly formulaFunctions: readonly (AggName | 'IF')[];
  readonly fiscal: boolean;
  readonly inspection: boolean;
  readonly selection: boolean;
  readonly identityWitness: boolean;
  readonly remoteAcquisition: boolean;
  /** Server can derive an independent transient source from a pinned selected result. */
  readonly linkedDerivation?: boolean;
  /** Implements candidate/snapshot-bound admission BEFORE apply: all top/sibling/child counts are safe exact integers. */
  readonly safeExactCountAdmission?: boolean;
  readonly features: readonly ProviderFeature[];
  /** Remote UI controls must follow declared server semantics; omission preserves local controls. */
  readonly sorting?: boolean;
  readonly filtering?: readonly ('text' | 'number')[];
};
export type ProviderErrorDescriptor = { code: 'UNSUPPORTED_PROTOCOL' | 'UNSUPPORTED_CAPABILITY' | 'COUNT_UNAVAILABLE' | 'SNAPSHOT_EXPIRED' | 'REVISION_MISMATCH' | 'SESSION_DISPOSED' | 'INVALID_REQUEST'; message: string; sourceSnapshotId?: string; capability?: string };
/** Opaque identities: consumers compare them, never parse or derive them from page contents. */
export type ProviderConsistency = { readonly kind: 'snapshot' } | { readonly kind: 'live'; readonly rowIdentity: 'ephemeral' };
/** Live providers use sourceSnapshotId only as a correlation token, never snapshot evidence.
 * Omitted consistency preserves the historical snapshot contract for existing local callers. */
export type ProviderSourceIdentity = { sessionId: string; sourceSnapshotId: string; consistency?: ProviderConsistency };
export type ProviderResultIdentity = ProviderSourceIdentity & { resultId: string };
export type ProviderViewReady = Omit<ViewReady, 'topLevelCount'> & ProviderResultIdentity & { topLevelCount: ProviderCount };
export type ProviderRowBlock = Omit<RowBlock, 'siblingCount' | 'groups'> & ProviderResultIdentity & {
  siblingCount: ProviderCount;
  groups: (Omit<RowBlock['groups'][number], 'childCount'> & { childCount: ProviderCount })[];
};
/** Numeric evidence/selection counts remain exact; providers that cannot supply them refuse those operations. */
export interface ProviderResultExecutor extends Omit<TableExecutor, 'registerInput' | 'applyModel' | 'rows' | 'presented'> {
  previewDefinition?(...args: Parameters<NonNullable<TableExecutor['previewDefinition']>>): Promise<DefinitionPreview & ProviderSourceIdentity>;
  bindFormula?(...args: Parameters<NonNullable<TableExecutor['bindFormula']>>): Promise<FormulaBindResult & ProviderSourceIdentity>;
  memberDomain?(...args: Parameters<NonNullable<TableExecutor['memberDomain']>>): Promise<MemberDomainResult & ProviderSourceIdentity>;
  inspect?(...args: Parameters<NonNullable<TableExecutor['inspect']>>): Promise<InspectionResult & ProviderResultIdentity>;
  identityWitness?(...args: Parameters<NonNullable<TableExecutor['identityWitness']>>): Promise<IdentityWitnessResult & ProviderResultIdentity>;
  /** Providers must honor requirements before publication; unsupported requirements refuse without replacing the active result. */
  applyModel(...args: [...Parameters<TableExecutor['applyModel']>, requirements?: ProviderApplyRequirements]): Promise<ProviderViewReady>;
  rows(...args: Parameters<TableExecutor['rows']>): Promise<ProviderRowBlock>;
  selection(...args: Parameters<TableExecutor['selection']>): Promise<SelectionResult & ProviderResultIdentity>;
  facets(...args: Parameters<TableExecutor['facets']>): Promise<FacetResult & ProviderResultIdentity>;
  totals(...args: Parameters<TableExecutor['totals']>): Promise<TotalResult & ProviderResultIdentity>;
  chartData(...args: Parameters<TableExecutor['chartData']>): Promise<ChartResult & ProviderResultIdentity>;
  presented(...args: Parameters<TableExecutor['presented']>): AsyncIterable<SubsetBatch & ProviderResultIdentity>;
}
export type LinkedSessionOptions = SessionOptions & { inputRevision: number };
export type ProviderSession = { /** Optional snapshot-only server derivation; LIVE/local providers omit this. */ readonly deriveLinked?: (revision: Revision, options: LinkedSessionOptions) => Promise<ProviderSession>; /** Negotiated maximum rows per transport read; adapters may assemble a bounded logical block. */ readonly rowBlockLimit?: number; readonly sessionId: string; readonly protocolVersion: 1; readonly sourceSnapshotId: string; readonly consistency?: ProviderConsistency; readonly capabilities: ProviderCapabilities; readonly result: ProviderResultExecutor };
export interface ExecutionProvider { open(source: SourceBinding, options: SessionOptions): Promise<ProviderSession> }
