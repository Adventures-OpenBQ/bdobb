// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Narrow V3 port of PR65's surface branch (365daf7c), without V4 worker/pivot dependencies.
import type {PlotlyFigure} from "./chartShapes";
export type SurfaceSettings = {type: "surface"; category?: string; measures: string[]};
export type SurfaceDataset = {
  columns: {id: string; label: string; dtype?: string; chartDataType?: string}[];
  rows: Record<string, unknown>[];
};
type SurfaceResult = {ok: true; figure: Omit<PlotlyFigure, "data"> & {data: Record<string, unknown>[]}; revision: string}
  | {ok: false; message: string; refused?: boolean};
const escape = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const own = (r: Record<string,unknown>, k: string) => Object.hasOwn(r,k) ? r[k] : undefined;

export function buildLinkedSurface(dataset: SurfaceDataset, settings: SurfaceSettings, theme: "light" | "dark"): SurfaceResult {
  const columns = new Map(dataset.columns.map(c => [c.id, c]));
  if (!settings.category || !columns.has(settings.category)) return {ok:false,message:"Choose an available category field."};
  if (!settings.measures.length) return {ok:false,message:"Choose chart fields: select one or more numeric measures."};
  if (new Set(settings.measures).size !== settings.measures.length) return {ok:false,message:"Choose each measure only once."};
  if (!dataset.rows.length) return {ok:false,message:"The source has no rows in this scope."};
  const category = settings.category;
  if (dataset.rows.some(r => {const v=own(r,category);return typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v));})) return {ok:false,message:"The category contains unavailable or invalid coordinates."};
  const position = new Map(dataset.columns.map((c,i) => [c.id,i]));
  const measures: {id:string; name:string; values:(number|null)[]}[] = [];
  for (const id of [...settings.measures].sort((a,b) => (position.get(a) ?? Infinity)-(position.get(b) ?? Infinity))) {
    const column=columns.get(id);
    if (!column) return {ok:false,message:`Measure ${id} is unavailable. Repair chart fields.`};
    if (column.dtype && column.dtype !== "number") return {ok:false,message:`Measure ${column.label} is not numeric.`};
    const values:(number|null)[]=[];
    for (const row of dataset.rows) {
      const raw=own(row,id);
      if (raw === null || raw === undefined) values.push(null);
      else if (typeof raw === "number" && Number.isFinite(raw)) values.push(raw);
      else return {ok:false,message:`Measure ${column.label} contains non-numeric or unsafe values.`};
    }
    measures.push({id,name:column.label,values});
  }
  if (!measures.some(m=>m.values.some(v=>v!==null))) return {ok:false,message:"The selected fields have no numeric observations."};
  const split=["pair","date"].filter(id=>id!==category && columns.has(id));
  const groups=new Map<string,{title:string;rows:number[]}>();
  dataset.rows.forEach((row,i)=>{
    const values=split.map(id=>own(row,id) ?? "");
    const key=JSON.stringify(values);
    const g=groups.get(key) ?? {title:values.map(String).join(" — "),rows:[]};
    g.rows.push(i);groups.set(key,g);
  });
  if (groups.size>6) return {ok:false,refused:true,message:`Surface draws at most 6 plots — the rows hold ${groups.size} ${split.join("/")} combinations.`};
  if ([...groups.values()].some(g=>g.rows.length<2)) return {ok:false,refused:true,message:"Surface needs at least two rows per plot."};
  const numeric=dataset.rows.every(r=>typeof own(r,category)==="number");
  const labels=dataset.rows.map(r=>String(own(r,category)));
  const revision=JSON.stringify([settings.type,category,settings.measures]);
  const background=theme==="dark" ? "#1e242e" : "#ffffff";
  const font={color:theme==="dark" ? "#dfe4ec" : "#1a1f28"};
  const axisLabel=escape(columns.get(category)!.label);
  const titles=[...groups.values()].flatMap((g,i)=>g.title ? [{text:escape(g.title),xref:"paper",yref:"paper",x:(i+.5)/groups.size,y:1,xanchor:"center",yanchor:"bottom",showarrow:false}] : []);
  const ticked=(text:string[])=>({tickmode:"array",tickvals:text.map((_,i)=>i),ticktext:text});
  if (measures.length===1) {
    const m=measures[0],axes:Record<string,unknown>={};
    const data=[...groups.values()].map((g,i)=>{
      const n=i ? String(i+1) : "";
      axes[`xaxis${n}`]={domain:[i/groups.size+(i ? .04 : 0),(i+1)/groups.size-(i < groups.size-1 ? .04 : 0)],anchor:`y${n}`,title:{text:axisLabel},...(numeric?{}:{type:"category"})};
      axes[`yaxis${n}`]={anchor:`x${n}`,title:{text:i?"":escape(m.name)}};
      return {type:"scatter",mode:"lines+markers",connectgaps:false,xaxis:`x${n}`,yaxis:`y${n}`,x:g.rows.map(r=>numeric?own(dataset.rows[r],category):labels[r]),y:g.rows.map(r=>m.values[r]),line:{color:"#4c9aff"},text:g.rows.map(r=>`${axisLabel}: ${escape(labels[r])}<br>${escape(m.name)}: ${m.values[r]??"Missing"}`),hovertemplate:"%{text}<extra></extra>"};
    });
    return {ok:true,revision,figure:{data,layout:{uirevision:revision,margin:{l:56,r:12,t:28,b:48},showlegend:false,annotations:titles,paper_bgcolor:background,plot_bgcolor:background,font,...axes}}};
  }
  const scenes:Record<string,unknown>={};
  const data=[...groups.values()].map((g,i)=>{
    const scene=i?`scene${i+1}`:"scene";
    scenes[scene]={domain:{x:[i/groups.size,(i+1)/groups.size]},bgcolor:background,camera:{eye:{x:1.6,y:1.6,z:1.4}},xaxis:{title:{text:axisLabel},...(numeric?{}:ticked(g.rows.map(r=>labels[r])))},yaxis:{title:{text:""},...ticked(measures.map(m=>m.name))},zaxis:{title:{text:""}}};
    return {type:"surface",scene,name:g.title,coloraxis:"coloraxis",x:g.rows.map((r,j)=>numeric?own(dataset.rows[r],category):j),y:measures.map((_,j)=>j),z:measures.map(m=>g.rows.map(r=>m.values[r])),text:measures.map(m=>g.rows.map(r=>`${axisLabel}: ${escape(labels[r])}<br>${escape(m.name)}: ${m.values[r]??"Missing"}`)),hovertemplate:"%{text}<extra></extra>"};
  });
  return {ok:true,revision,figure:{data,layout:{uirevision:revision,margin:{l:0,r:0,t:28,b:0},coloraxis:{colorscale:"Viridis"},annotations:titles,paper_bgcolor:background,font,...scenes}}};
}
