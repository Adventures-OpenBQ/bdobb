// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only

import { startTransition, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartRenderer } from '../../src/components/renderers/ChartRenderer';

const figure = { data: [{
  type: 'sunburst', ids: ['fund', 'sector', 'holding'], labels: ['Delivered holdings', 'Technology', 'ALDER.US'],
  parents: ['', 'fund', 'sector'], branchvalues: 'total', values: [.35, .35, .35],
}], layout: { width: 480, height: 360 } };

function Replacement() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return ready ? <p>Replacement view is ready</p> : null;
}

function Harness({ transition }: { transition: boolean }) {
  const [showChart, setShowChart] = useState(true);
  function replace() {
    setTimeout(() => {
      if (transition) startTransition(() => setShowChart(false));
      else setShowChart(false);
    }, 0);
  }
  return <>
    <button type="button" onClick={replace}>Replace ETF plot</button>
    {showChart
      ? <div style={{ width: 480, height: 360 }}><ChartRenderer data={figure} onSunburstLevelChange={() => {}}/></div>
      : <Replacement/>}
  </>;
}

const root = document.getElementById('root')!;
createRoot(root).render(<Harness transition={root.dataset.transition === 'true'}/>);
