// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {AGG_NAMES} from '../../types';
import type {FormulaAst,FormulaDef,TableModelV1} from '../../tableModel/types';
import type {StatementIntent} from '../../statementModel/types';
import type {ProviderCapabilities,ProviderErrorDescriptor,ProviderFeature,SelectionSpec,TableDefinition,RuntimeParams} from '../types';
import {assertUnicodeScalarGraph} from './wireCodec';
import {astChildren} from '../../tableModel/formulaSyntax';
import {validateTableModel as validateRequestModel} from '../validation';
import {validateTableModel as validateSavedTableStructure} from '../../tableModel/validation';
export class ProviderContractError extends Error {
 constructor(readonly descriptor:ProviderErrorDescriptor){super(descriptor.message);this.name='ProviderContractError';}
}
export function refusal(capability:string):never {throw new ProviderContractError({code:'UNSUPPORTED_CAPABILITY',message:`Provider does not support ${capability}`,capability});}
export function localCapabilities():ProviderCapabilities {
 return freezeCapabilities({protocolVersions:[1],definitionVersions:[1,2],aggregations:AGG_NAMES,formulaFunctions:[...AGG_NAMES,'IF'],fiscal:true,inspection:true,selection:true,identityWitness:true,remoteAcquisition:false,safeExactCountAdmission:true,
 features:['grouping','splits','sourceFormulas','aggregateFormulas','memberScope','runtimeParams','checklists','resultFilters','statement','preview','bindFormula','memberDomain','columnProfile','chart','export']});
}
export function freezeCapabilities(value:ProviderCapabilities):ProviderCapabilities {
 return Object.freeze({...value,protocolVersions:Object.freeze([...value.protocolVersions]),definitionVersions:Object.freeze([...value.definitionVersions]),aggregations:Object.freeze([...value.aggregations]),formulaFunctions:Object.freeze([...value.formulaFunctions]),features:Object.freeze([...value.features])});
}
export function requireFeature(capabilities:ProviderCapabilities,feature:ProviderFeature):void {if(!capabilities.features.includes(feature))refusal(feature);}
/** Declaration checks only: no expression evaluation, source calculation or page access. */
export function capabilityPreflight(capabilities:ProviderCapabilities,definition:TableDefinition,selection:SelectionSpec,runtimeParams?:RuntimeParams):void {
 try {
 assertUnicodeScalarGraph(definition);assertUnicodeScalarGraph(selection);assertUnicodeScalarGraph(runtimeParams);
 const rawModel=definition?.analytical;
 const version=rawModel&&typeof rawModel==='object'&&typeof (rawModel as {schemaVersion?:unknown}).schemaVersion==='number'?(rawModel as {schemaVersion:number}).schemaVersion:1;
 if(!capabilities.definitionVersions.includes(version))refusal(`definition:${version}`);
 validateRequestModel(definition,selection);
 if(rawModel&&typeof rawModel==='object'&&(rawModel as {schemaVersion?:number}).schemaVersion===1){
  const invalid=validateSavedTableStructure(rawModel).diagnostics.find(diagnostic=>diagnostic.severity==='error'&&(diagnostic.code==='invalid-structure'||diagnostic.code==='invalid-ast'));
  if(invalid)throw new ProviderContractError({code:'INVALID_REQUEST',message:`Invalid analytical model: ${invalid.message}`});
 }
 const feature=(name:ProviderFeature,needed:unknown)=>{if(needed)requireFeature(capabilities,name);};
 const agg=(operator:string|undefined)=>{if(operator&&!capabilities.aggregations.includes(operator as never))refusal(`aggregation:${operator}`);};
 const ast=(node:FormulaAst):void=>{
  // Traversed entries/AST shapes have passed structural validation; native owns semantic validation.
  if(node.kind==='call'&&!capabilities.formulaFunctions.includes(node.function))refusal(`function:${node.function}`);
  if(node.kind==='member')requireFeature(capabilities,'memberScope');
  astChildren(node).forEach(ast);
 };
 const formula=(f:FormulaDef)=>{feature(f.scope==='source'?'sourceFormulas':'aggregateFormulas',true);ast(f.ast);};
 if(selection.kind!=='none'&&!capabilities.selection)refusal('selection');
 feature('runtimeParams',runtimeParams&&Object.keys(runtimeParams).length);
 const pivot=definition.table.pivot;
 if(pivot?.enabled){feature('grouping',pivot.grouping.length);feature('splits',pivot.split.length);Object.values(pivot.aggregationFns??{}).forEach(agg);pivot.measures?.forEach(m=>agg(m.aggregation));}
 const model=rawModel as TableModelV1|StatementIntent|undefined;
 if(!model)return;
 feature('checklists',model.checklists?.length);feature('resultFilters',model.resultFilters?.length);
 if(model.schemaVersion===2){
  requireFeature(capabilities,'statement');if(!capabilities.fiscal)refusal('fiscal');
  model.template.lines.forEach(line=>{if(line.formula)formula(line.formula);});model.overrides.formulas.forEach(formula);
  // Statement compilation declares sum; stock-period policy belongs to the statement capability.
  agg('sum');requireFeature(capabilities,'grouping');requireFeature(capabilities,'splits');
 }else{
  feature('grouping',model.enabled&&model.layout.rows.length);feature('splits',model.enabled&&model.layout.columns.length);
  model.categories?.forEach(c=>{if((c.transform==='FY'||c.transform==='FQ'||c.fiscalBinding)&&!capabilities.fiscal)refusal('fiscal');});
  model.measures?.forEach(m=>agg(m.aggregation));model.formulas?.forEach(formula);
 }
 } catch(error) {
  if(error instanceof ProviderContractError)throw error;
  throw new ProviderContractError({code:'INVALID_REQUEST',message:error instanceof Error?error.message:'Invalid provider definition'});
 }
}
