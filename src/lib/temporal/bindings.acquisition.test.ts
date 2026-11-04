import {expect,it} from 'vitest';
import {parseQueryBinding} from './bindings';
import {queryId,executionId} from './fixtures';
const binding={kind:'query',queryId,revisionPolicy:'fixed',revision:2,params:{},context:{mode:'current_corrected'}};
it('retains explicit versioned policy intent while preserving cache-only bindings',()=>{
 expect(parseQueryBinding(binding)).toEqual(binding);
 const acquisition={version:1,policyId:executionId,policyRevision:3};
 expect(parseQueryBinding({...binding,acquisition})).toEqual({...binding,acquisition});
 for(const bad of [{...acquisition,version:2},{...acquisition,policyRevision:0},{...acquisition,account:'secret'},{...acquisition,policyId:'bad'}])expect(()=>parseQueryBinding({...binding,acquisition:bad})).toThrow();
 expect(()=>parseQueryBinding({...binding,context:{mode:'snapshot'},acquisition})).toThrow();
 expect(()=>parseQueryBinding({kind:'execution',executionId,acquisition})).toThrow();
});
