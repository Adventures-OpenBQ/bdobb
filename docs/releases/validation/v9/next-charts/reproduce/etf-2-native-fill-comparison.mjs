// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
// Compares only the four source-bound review fixtures, at the three reported sets of ring radii.
import { chromium, webkit } from '@playwright/test';
import { createRequire } from 'node:module';
const { pathAnnulus } = createRequire(import.meta.url)('plotly.js/src/lib/angles.js');
const inputs = [
  [.15614308710594246,5.236459842602384e-9,.19385690765759772],
  [.14747811893136722,6.057835021435319e-9,.20252187501079774],
  [.08726681249999999,3.899296105751436e-9,.26273318360070386],
  [.34999995,.00000005],
];
for (const engine of [chromium, webkit]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<svg width="600" height="460"><path/></svg>');
    for (const weights of inputs) {
      let total = 0, correction = 0;
      for (const v of weights) {const add=v-correction, next=total+add; correction=(next-total)-add;total=next;}
      const scale = 2*Math.PI/total, from = weights[0]*scale, to = from+weights[1]*scale;
      for (const [inner,outer] of [[128,192],[96,192],[64,128]]) {
        const path = pathAnnulus(inner,outer,from,to,300,256);
        const result = await page.evaluate(({path,inner,outer,from,to}) => {
          const s = document.querySelector('path'); s.setAttribute('d',path);
          const ctx = new OffscreenCanvas(1,1).getContext('2d'), p = new Path2D(path);
          let differences=0, filled=0, midpoint;
          for(let i=1;i<32;i++) for(let j=1;j<32;j++) {
            const r=inner+(outer-inner)*i/32, a=from+(to-from)*j/32;
            const x=300+r*Math.cos(a), y=256-r*Math.sin(a);
            const svg=s.isPointInFill(new DOMPoint(x,y)), canvas=ctx.isPointInPath(p,x,y);
            if (svg) filled++;
            if (svg!==canvas) differences++;
            if (i===16 && j===16) midpoint={svg,canvas};
          }
          return {midpoint, filled, differences};
        }, {path,inner,outer,from,to});
        console.log(JSON.stringify({engine:engine.name(),weight:weights[1],inner,outer,...result}));
      }
    }
  } finally { await browser.close(); }
}
