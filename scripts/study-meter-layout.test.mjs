// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {build} from 'esbuild';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {chromium} from '@playwright/test';
test('real study cell keeps the RSI band meter full width with its reading centered',async()=>{
 const bundle=await build({entryPoints:['src/components/renderers/StudyResultCell.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic'});
 const {StudyResultCell}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const markup=renderToStaticMarkup(React.createElement(StudyResultCell,{value:{study:'rsi',output:'rsi',status:'ok',presentation:'latest',latest:85.4,points:[]}}));
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent(`<style>${readFileSync('src/styles.css','utf8')}</style><div style="width:160px">${markup}</div>`);
  const meter=await page.locator('.cell-meter').boundingBox(),box=await page.locator('.cell-meter-box').boundingBox(),fill=await page.locator('.cell-meter-fill').boundingBox();
  assert.ok(meter&&meter.width>=90,`meter width ${meter?.width} must remain visible`);assert.ok(box&&box.width>0);assert.ok(fill&&fill.width>0);assert.ok(Math.abs(box.x+box.width/2-(meter.x+meter.width/2))<1,'reading is centered in the neutral band');
  await page.screenshot({path:'/tmp/study-meter-layout.png'});
 }finally{await browser.close();}
});
