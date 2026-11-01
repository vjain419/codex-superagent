import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';

// A separate SQLite transaction supplies OS-released ownership without stale PID files.
export class InstanceLock {
  constructor(directory) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    const path=join(directory,'instance.sqlite');this.db=new DatabaseSync(path);chmodSync(path,0o600);
    try{this.db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');}
    catch{this.db.close();throw new Error('A service is already running for this data directory');}
  }
  close(){this.db.close();}
}
