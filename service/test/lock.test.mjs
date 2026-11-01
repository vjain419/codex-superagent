import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {InstanceLock} from '../lock.mjs';
test('one service owns a data directory and close releases ownership',()=>{
 const dir=mkdtempSync(join(tmpdir(),'superagent-lock-'));
 try{const first=new InstanceLock(dir);assert.throws(()=>new InstanceLock(dir),/already running/);first.close();const second=new InstanceLock(dir);second.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
