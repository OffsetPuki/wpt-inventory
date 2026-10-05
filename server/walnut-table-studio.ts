import type {Express} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {requireElevated} from './auth';

// Internal read-only model dimensions, never a public customer-preview option.
export function registerWalnutTableStudio(app:Express) {
  app.get('/api/design-studio/walnut-table',requireElevated,(_req,res)=>{
    const file=path.resolve('server/design-studio/walnut-table/model.json');
    if(!fs.existsSync(file)){res.status(503).json({message:'The walnut table parts are not installed.'});return;}
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.type('json').sendFile(file);
  });
}
