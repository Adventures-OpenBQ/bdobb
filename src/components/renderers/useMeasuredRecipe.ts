// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChartResult, LocalWorkerExecutor, Revision } from '../../lib/tableExecution/types';
import type { DatasetColumn } from '../../lib/widgetData/types';
import type { EstimateRevisionsSurface, RecipeContext, RecipeOptions, RecipeResult } from '../../lib/widgetData/chartRecipes/types';
import { createRecipeWorker } from '../../lib/widgetData/chartRecipes/workerClient';
import type { ViewState } from '../../stores/tableExecutionStore';
import { readDrawingSurface, type DrawingSurface } from './ChartRenderer';

export function sameRecipeRevision(left: Revision | undefined, right: Revision) {
  return left?.widgetId === right.widgetId && left.input === right.input
    && left.model === right.model && left.output === right.output;
}

export function sameRecipeSurface(left: DrawingSurface | undefined, right: DrawingSurface | undefined) {
  return left?.width === right?.width && left?.height === right?.height;
}

export function recipeErrorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

type SourceState = { view: ViewState; executor?: LocalWorkerExecutor; sourceCurrent: boolean };
export type MeasuredRecipeJob<T> = {
  ready: NonNullable<ViewState['ready']>;
  revision: Revision;
  columns: DatasetColumn[];
  current: () => boolean;
  load: (signal: AbortSignal, options?: T) => Promise<ChartResult>;
};

/** A draft and its applied calculation share the same presented producer revision. */
export function useMeasuredRecipeJob<T extends RecipeOptions>(
  sourceCurrent: boolean, view: ViewState, executor: LocalWorkerExecutor | undefined, sourceId: string | undefined,
  readCurrent: () => SourceState, inputFields: (columns: DatasetColumn[], options?: T) => string[], sourceLabel: string,
): MeasuredRecipeJob<T> | undefined {
  const { ready, sourceRevision: revision } = view;
  return useMemo(() => {
    if (!sourceCurrent || !executor || !ready || !revision || revision.widgetId !== sourceId) return;
    const { columns } = ready;
    const active = revision;
    function current() {
      const current = readCurrent();
      return current.sourceCurrent && current.executor === executor && current.view.ready === ready
        && sameRecipeRevision(current.view.sourceRevision, active);
    }
    return {
      current, ready, revision, columns,
      async load(signal, options) {
        if (!current()) throw new Error(`The ${sourceLabel} source changed. Reload the selected source.`);
        const result = await executor.chartData(revision, inputFields(columns, options), signal);
        signal.throwIfAborted();
        if (!sameRecipeRevision(result.revision, revision) || result.resultRevision !== revision.model || result.outputRevision !== revision.output)
          throw new Error(`The ${sourceLabel} source revision changed. Reload the selected source.`);
        return result;
      },
    };
  }, [sourceId, sourceCurrent, ready, revision, executor, readCurrent, inputFields, sourceLabel]);
}

type Measured = { box: DrawingSurface; context: RecipeContext; baseContext: RecipeContext };
type Sequence<T> = { job: MeasuredRecipeJob<T>; options: T };
type Request<T> = Sequence<T> & { measured: Measured };

type Completed<T> = { request: Request<T>; result: RecipeResult };

export function retainsStaleMeasuredRecipe<T extends RecipeOptions>(
  completed: Completed<T> | undefined, view: ViewState, options: T, context: RecipeContext,
) {
  return completed?.result.ok === true && completed.request.options === options
    && completed.request.measured.baseContext === context && view.stale
    && (view.status === 'pending' || view.status === 'updating' || view.status === 'blocked' || view.status === 'failed')
    && completed.request.job.ready === view.ready && sameRecipeRevision(view.sourceRevision, completed.request.job.revision);
}

export function useMeasuredRecipeSurface(context: RecipeContext) {
  const element = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DrawingSurface>();
  const observe = useCallback((size: DrawingSurface) => {
    setBox(previous => sameRecipeSurface(previous, size) ? previous : size);
  }, []);
  const measured = useMemo(() => box && {
    box, baseContext: context, context: { ...context, viewportWidth: box.width, viewportHeight: box.height },
  }, [box, context]);
  const matches = useCallback((box: DrawingSurface) => {
    const surface = element.current?.querySelector('.chart-plot');
    return !!surface && sameRecipeSurface(readDrawingSurface(surface), box);
  }, []);
  return { element, measured, observe, matches };
}

export function useMeasuredRecipe<T extends RecipeOptions>(job: MeasuredRecipeJob<T> | undefined, options: T | undefined,
  measured: Measured | undefined, matches: (box: DrawingSurface) => boolean) {
  const worker = useRef<ReturnType<typeof createRecipeWorker> | null>(null);
  useEffect(() => {
    const client = createRecipeWorker();
    worker.current = client;
    return () => { worker.current = null; client.dispose(); };
  }, []);
  const sequence = useMemo(() => job && options ? { job, options } : undefined, [job, options]);
  const request = useMemo(() => sequence && measured ? { ...sequence, measured } : undefined, [sequence, measured]);
  const committedRequest = useRef<typeof request>(undefined);
  useLayoutEffect(() => {
    committedRequest.current = request;
    return () => { committedRequest.current = undefined; };
  }, [request]);
  const current = useCallback(() => Boolean(request && committedRequest.current === request
    && request.job.current() && matches(request.measured.box)), [request, matches]);
  const [completed, setCompleted] = useState<Completed<T>>();
  // A sizing reply belongs to the calculation, while each reply still has to
  // arrive for the exact current measurement. Remeasuring must retain the hint.
  const [sizing, setSizing] = useState<{ sequence: Sequence<T>; minimum: EstimateRevisionsSurface }>();
  useEffect(() => {
    const client = worker.current;
    if (!request || !sequence || !client) return;
    const activeSequence = sequence;
    const { job, options, measured } = request;
    const controller = new AbortController(), { signal } = controller;
    function finish(result: RecipeResult) {
      if (signal.aborted || !current() || !request) return;
      const minimum = result.estimateRevisionsSurface;
      if (options.kind === 'estimate-revisions' && minimum)
        setSizing({ sequence: activeSequence, minimum });
      setCompleted({ request, result });
    }
    void job.load(signal, options).then(data => {
      if (!signal.aborted && current()) return client.run(data, options, measured.context, signal).then(finish);
    }).catch(error => finish({ ok: false, message: recipeErrorText(error) }));
    return () => controller.abort();
  }, [sequence, request, current]);
  const checked = request && completed?.request === request ? completed.result : undefined;
  // Applied views can keep an admitted figure at its original size while
  // the same question is checked at a new size. Draft Apply still uses checked.
  const remeasuring = !!request && !checked && completed?.result.ok === true
    && completed.request.job === request.job && completed.request.options === request.options
    && completed.request.measured.baseContext === request.measured.baseContext;
  // Removing a draft refusal during a size-only check changes the Parameters
  // height, which changes the measured plot again. Keep that diagnostic until
  // its replacement arrives; only checked may authorize Apply.
  const pendingRefusal = request && !checked && completed?.result.ok === false
    && completed.request.job === request.job && completed.request.options === request.options
    && completed.request.measured.baseContext === request.measured.baseContext
    ? completed.result : undefined;
  return { completed, current, checked, remeasuring, pendingRefusal,
    minimum: sizing?.sequence === sequence ? sizing?.minimum : undefined };
}
