// Copyright 2026 SecretoftheUniverse.com LLC. Licensed under the GNU Affero General Public License, version 3 only.
// SPDX-License-Identifier: AGPL-3.0-only
import {expect, test} from '@playwright/test';
import {defaultSeed, seedApp} from './fixtures';

test.use({browserName: process.env.HEADER_WEBKIT ? 'webkit' : 'chromium'});

for (const {viewer,seeThrough} of [{viewer:false,seeThrough:false},{viewer:true,seeThrough:false},{viewer:false,seeThrough:true}]) {
  test(`dashboard tabs stay above the locked top band${viewer ? ' in a viewer' : seeThrough ? ' with see-through enabled' : ''}`, async ({page}) => {
    const files=defaultSeed();
    const dashboard=JSON.parse(files['dashboards/d1.json']!);
    dashboard.tabs.push({id:'t2',name:'Alternate',cards:[]});
    files['dashboards/d1.json']=JSON.stringify(dashboard);
    files['dashboards/docks.json']=JSON.stringify({id:'docks',name:'Locked widgets',hidden:true,
      dockRows:{top:8,bottom:8},dockSeeThrough:{top:seeThrough,bottom:false},tabs:[{id:'top',name:'Locked at Top',cards:[{
        id:'locked-top',widgetId:'quote',backendId:'b1',params:{symbol:'AAPL'},layout:{x:0,y:0,w:20,h:8},
      }]},{id:'bottom',name:'Locked at Bottom',cards:[]}]});
    await seedApp(page,files,viewer ? '/?viewer=d1' : '/');
    const bar=page.locator('.dashboard-area > .tab-bar');
    const band=page.getByRole('region',{name:'Locked at Top',exact:true});
    await expect(bar).toHaveCount(1);
    await expect(band).toBeVisible();
    await expect.poll(async()=>{
      const a=await bar.boundingBox(),b=await band.boundingBox();
      return a&&b ? a.y+a.height<=b.y+1 : false;
    }).toBe(true);
    await band.evaluate(el=>{(el as HTMLElement).dataset.persistenceMarker='retained';});
    await bar.getByRole('tab',{name:'Alternate',exact:true}).click();
    await expect(bar.getByRole('tab',{name:'Alternate',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(band).toHaveAttribute('data-persistence-marker','retained');
    await bar.getByRole('tab',{name:'Main',exact:true}).click();
    if(!viewer){
      const card=page.locator('[data-card-id="c-quote"]');
      await card.getByRole('button',{name:'Maximize',exact:true}).click();
      await expect.poll(async()=>{
        const a=await card.boundingBox(),b=await band.boundingBox();
        const tabs=await bar.boundingBox();
        return a&&b&&tabs ? seeThrough ? a.y>=tabs.y+tabs.height-1 && a.y<b.y+b.height : a.y>=b.y+b.height-1 : false;
      }).toBe(true);
      await expect(bar).toBeVisible();
      await expect(band).toHaveAttribute('data-persistence-marker','retained');
    }
  });
}

test('dashboard has one usable tab bar without a locked top band',async({page})=>{
  await seedApp(page,defaultSeed());
  const bar=page.locator('.dashboard-area > .tab-bar');
  await expect(bar).toHaveCount(1);
  await expect(page.locator('.dock-band-top')).toHaveCount(0);
  await expect(bar.getByRole('button',{name:'Refresh all',exact:true})).toBeVisible();
  await expect(bar.getByRole('button',{name:'Add widget',exact:true})).toBeVisible();
});
